'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const hap = require('@homebridge/hap-nodejs');
const KNXDevice = require('../lib/knxdevice');
const access = require('../lib/knxaccess');
const realKnxwrite = access.knxwrite;
const realKnxread = access.knxread;
const example = require('../examples/rollo-buero.json');

beforeEach(t => {
    for (const transport of [require('knx'), require('eibd')]) {
        t.mock.method(transport, 'Connection', () => assert.fail('Unexpected real KNX connection'));
    }
});

// Controlled elapsed time, including a blocked event loop and cancelled callbacks.
class Clock {
    constructor(t) {
        this.now = 100000;
        this.next = 0;
        this.tasks = new Map();
        this.cancelled = [];
        t.mock.method(Date, 'now', () => this.now);
        t.mock.method(global, 'setTimeout', (fn, delay) => {
            const task = { fn, at: this.now + delay, unreferenced: false };
            const id = { number: ++this.next, unref() { task.unreferenced = true; return this; } };
            this.tasks.set(id, task);
            return id;
        });
        t.mock.method(global, 'clearTimeout', id => {
            if (this.tasks.has(id) && !this.tasks.get(id).unreferenced) this.cancelled.push(this.tasks.get(id).fn);
            this.tasks.delete(id);
        });
    }
    get pending() {
        return [...this.tasks.values()].filter(task => !task.unreferenced).length;
    }
    advance(ms) {
        const target = this.now + ms;
        while (true) {
            const next = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > target) break;
            this.now = Math.max(this.now, next[1].at);
            this.tasks.delete(next[0]);
            next[1].fn();
        }
        this.now = target;
    }
    stall(ms) {
        this.now += ms;
        this.advance(0);
    }
}

function fixture(t, { constants = {}, backend = 'knxjs', cached } = {}) {
    const clock = new Clock(t);
    const writes = [], reads = [], warnings = [], updates = [], registrations = [], listeners = new Map();
    t.mock.method(access, 'knxwrite', (callback, address, dpt, value) => {
        writes.push({ address, dpt, value });
        if (callback) callback();
    });
    t.mock.method(access, 'knxread', address => reads.push(address));
    const api = Object.assign(new EventEmitter(), {
        hap,
        platformAccessory: class extends hap.Accessory {
            constructor(name, uuid, category) {
                super(name, uuid);
                if (category !== undefined) this.category = category;
            }
        },
        registerPlatformAccessories: (...args) => registrations.push(args),
    });
    const noop = () => {};
    const globs = {
        API: api, Service: hap.Service, Characteristic: hap.Characteristic,
        info: noop, debug: noop, errorlog: noop,
        log: Object.assign(() => {}, { warn: message => warnings.push(message) }),
        knxconnection: backend, readRequests: {},
        knxmonitor: { registerGA: (address, dpt, callback) => listeners.set(address, callback) },
    };
    access.setGlobs(globs);
    const config = structuredClone(example.Devices[0]);
    config.UUID = hap.uuid.generate('rollo-test');
    config.SerialNumber = 'preserved-rollo-serial';
    config.Services[0].subtype = 'preserved-rollo-service';
    // Original immediate-send scenarios explicitly opt out of batching.
    Object.assign(config.Services[0].LocalConstants, { CommandDebounceMs: 0 }, constants);
    const device = new KNXDevice(globs, config, cached);
    const service = device.services[0];
    const customAPI = service.customServiceAPI;
    const handler = customAPI.handler;
    for (const wrapper of service.myCharacteristics) {
        wrapper.chr.on('change', event => updates.push({ field: wrapper.name, ...event }));
    }
    t.after(() => api.emit('shutdown'));
    return {
        clock, writes, reads, warnings, updates, registrations, globs, api,
        device, service, handler, customAPI, config,
        get: field => customAPI.getValue(field),
        command(value) {
            let acknowledged = false;
            customAPI.homekitEventCatcher('TargetPosition', value, () => { acknowledged = true; });
            assert.equal(acknowledged, true, 'HomeKit write must be acknowledged synchronously');
        },
        bus(field, homekitPosition, metadata) {
            const knxPercent = handler.invert ? 100 - homekitPosition : homekitPosition;
            const wireValue = backend === 'knxjs' ? knxPercent : Math.round(knxPercent * 255 / 100);
            listeners.get(field === 'CurrentPosition' ? '3/0/7' : '3/0/6')(wireValue, '1.1.1', '', metadata);
        },
    };
}

for (const backend of ['knxjs', 'knxd']) {
    for (const invert of [true, false]) {
        test(`${backend}: percentage normalization and inversion=${invert} for open, closed and partial targets`, t => {
            const f = fixture(t, { backend, constants: { InvertPosition: invert } });
            for (const [start, target, state] of [[0, 100, 1], [100, 0, 0], [0, 40, 1], [80, 25, 0]]) {
                f.bus('CurrentPosition', start);
                f.command(target);
                const percent = invert ? 100 - target : target;
                assert.deepEqual(f.writes.at(-1), {
                    address: '3/0/6', dpt: 'DPT5.001',
                    value: backend === 'knxjs' ? percent : Math.round(percent * 255 / 100),
                });
                assert.equal(f.get('PositionState'), state);
                f.bus('CurrentPosition', target);
                assert.equal(f.get('CurrentPosition'), target);
                assert.equal(f.get('TargetPosition'), target);
                assert.equal(f.get('PositionState'), 2);
            }
            assert.equal(f.writes.length, 4, 'status synchronization must not write KNX');
            assert.equal(f.clock.pending, 0);
        });
    }
}

test('new WINDOW_COVERING and cached service preserve identities and never trust cached position', t => {
    const f = fixture(t);
    assert.equal(f.device.platformAccessory.category, hap.Categories.WINDOW_COVERING);
    assert.equal(f.registrations.length, 1);
    assert.deepEqual(f.globs.readRequests, { '3/0/7': 1 });
    assert.equal(f.writes.length, 0);
    f.bus('CurrentPosition', 65);
    const cached = hap.Accessory.deserialize(hap.Accessory.serialize(f.device.platformAccessory));
    f.api.emit('shutdown');
    const service = cached.getServiceById(hap.Service.WindowCovering, 'preserved-rollo-service');
    const count = cached.services.length;
    const restored = new KNXDevice(f.globs, f.config, cached);
    const handler = restored.services[0].customServiceAPI.handler;
    assert.equal(restored.platformAccessory, cached);
    assert.equal(restored.services[0].serviceHK, service);
    assert.equal(cached.services.length, count);
    assert.equal(cached.UUID, f.config.UUID);
    assert.equal(service.subtype, 'preserved-rollo-service');
    assert.equal(cached.getService(hap.Service.AccessoryInformation).getCharacteristic(hap.Characteristic.SerialNumber).value, 'preserved-rollo-serial');
    assert.equal(f.registrations.length, 1);
    assert.equal(handler.confirmedPosition, undefined);
    assert.equal(handler.positionKnown, false);
    assert.equal(f.writes.length, 0);
});

test('no estimates by default; feedback synchronizes target and accepts differing end position', t => {
    const f = fixture(t);
    f.bus('CurrentPosition', 10);
    f.command(80);
    f.clock.advance(4000);
    assert.equal(f.get('CurrentPosition'), 10);
    f.bus('CurrentPosition', 55);
    assert.equal(f.get('CurrentPosition'), 55);
    assert.equal(f.get('TargetPosition'), 55);
    assert.equal(f.get('PositionState'), 2);
    assert.match(f.warnings[0], /55%.*80%/);
    f.bus('CurrentPosition', 55);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.clock.pending, 0);
    assert.equal(f.writes.length, 1);
});

test('external targets start monitoring but repeated commands and own echoes never restart it', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 0);
    f.bus('TargetPosition', 60);
    const external = f.handler.motion;
    f.clock.advance(3000);
    f.bus('TargetPosition', 60);
    assert.equal(f.handler.motion, external);
    assert.equal(f.writes.length, 0);
    f.command(80);
    const own = f.handler.motion;
    f.bus('TargetPosition', 80);
    assert.equal(f.handler.motion, own);
    f.command(20);
    const newer = f.handler.motion;
    f.bus('TargetPosition', 80); // Delayed echo from the superseded local command.
    assert.equal(f.handler.motion, newer);
    f.bus('TargetPosition', 20);
    f.command(20);
    assert.equal(f.handler.motion, newer);
    assert.equal(f.writes.length, 2);
    f.bus('CurrentPosition', 20);
    f.bus('TargetPosition', 20); // Echo after the end-position response.
    assert.equal(f.handler.motion, undefined);
    assert.equal(f.clock.pending, 0);
});

test('estimates use actual elapsed time, integer updates and target bounds, not timer counts', t => {
    const f = fixture(t, { constants: { EstimatePosition: true, TravelTimeUpMs: 100000 } });
    f.bus('CurrentPosition', 0);
    f.command(7);
    f.clock.stall(3500);
    assert.equal(f.get('CurrentPosition'), 4);
    assert.equal(f.handler.confirmedPosition, 0);
    assert.equal(f.handler.estimatedPosition, 3.5);
    f.clock.stall(6000);
    assert.equal(f.get('CurrentPosition'), 7);
    assert.equal(f.get('PositionState'), 1, 'computed arrival is not confirmed');
    assert.equal(f.handler.confirmedPosition, 0);
    const updates = f.updates.filter(event => event.field === 'CurrentPosition').map(event => event.newValue);
    assert.deepEqual(updates, [4, 7]);
    assert.equal(f.writes.length, 1);
    f.bus('CurrentPosition', 5);
    assert.equal(f.get('CurrentPosition'), 5);
    assert.equal(f.handler.confirmedPosition, 5);
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.clock.pending, 0);
});

test('only changed integer estimates publish; downward estimates stay within target', t => {
    const f = fixture(t, { constants: { EstimatePosition: true, TravelTimeDownMs: 1000000 } });
    f.bus('CurrentPosition', 80);
    f.command(79);
    f.clock.advance(4000);
    assert.equal(f.get('CurrentPosition'), 80);
    assert.equal(f.updates.filter(e => e.field === 'CurrentPosition').length, 1); // initial feedback only
    f.clock.advance(6000);
    assert.equal(f.get('CurrentPosition'), 79);
    f.clock.advance(1000);
    assert.equal(f.handler.confirmedPosition, 80);
    assert.equal(f.writes.length, 1);
});

test('retarget and reverse from the continuous model, with direction-specific full travel times', t => {
    const f = fixture(t, { constants: { EstimatePosition: true, TravelTimeUpMs: 20000, TravelTimeDownMs: 10000 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    f.clock.advance(5500);
    f.command(20);
    assert.equal(f.handler.motion.start, 27.5);
    assert.equal(f.get('PositionState'), 0);
    const stale = [...f.clock.cancelled];
    f.clock.advance(500);
    assert.equal(f.handler.positionAt(Date.now()), 22.5);
    const motion = f.handler.motion;
    for (const callback of stale) callback();
    assert.equal(f.handler.motion, motion);
    assert.equal(f.get('TargetPosition'), 20);
    f.clock.advance(500);
    assert.equal(f.get('CurrentPosition'), 20);
    assert.equal(f.handler.confirmedPosition, 0);
    f.bus('CurrentPosition', 20);
    assert.equal(f.clock.pending, 0);
});

test('startup with unknown position never estimates from HAP defaults or cache', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    assert.equal(f.handler.confirmedPosition, undefined);
    assert.equal(f.reads.length, 0, 'startup read is queued by KNXReadRequests, not duplicated here');
    f.command(40);
    assert.equal(f.handler.motion.start, undefined);
    assert.equal(f.get('PositionState'), 2, 'direction for an unknown partial position is unknown');
    f.clock.advance(17000);
    assert.equal(f.handler.estimatedPosition, undefined);
    assert.equal(f.reads.length, 0);
    f.clock.advance(5000);
    assert.deepEqual(f.reads, ['3/0/7']);
    f.bus('CurrentPosition', 35);
    assert.equal(f.get('TargetPosition'), 35);
    assert.equal(f.get('CurrentPosition'), 35);
    assert.equal(f.handler.confirmedPosition, 35);
    assert.equal(f.clock.pending, 0);
});

test('timeout reads once, stops estimates, retains only actual confirmation; late response wins', t => {
    const f = fixture(t, { constants: { EstimatePosition: true, TravelTimeUpMs: 10000, FeedbackTimeoutMs: 2000 } });
    f.bus('CurrentPosition', 20);
    f.command(80); // Supervision uses a full 10 seconds + 2 seconds reserve.
    f.clock.advance(6000);
    assert.equal(f.get('CurrentPosition'), 80);
    assert.equal(f.handler.confirmedPosition, 20);
    f.clock.advance(5999);
    assert.equal(f.reads.length, 0);
    f.clock.advance(1);
    assert.deepEqual(f.reads, ['3/0/7']);
    f.clock.advance(2000);
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.get('CurrentPosition'), 80, 'unconfirmed display estimate is frozen, not rolled back');
    assert.equal(f.get('TargetPosition'), 80);
    assert.equal(f.handler.confirmedPosition, 20);
    assert.equal(f.handler.positionKnown, false);
    assert.match(f.warnings.at(-1), /No end-position feedback/);
    f.clock.advance(100000);
    assert.equal(f.reads.length, 1);
    assert.equal(f.writes.length, 1);
    f.command(50);
    assert.equal(f.handler.motion.start, undefined, 'old feedback is not a reliable start after timeout');
    f.bus('CurrentPosition', 45);
    assert.equal(f.get('CurrentPosition'), 45);
    assert.equal(f.get('TargetPosition'), 45);
    assert.equal(f.handler.confirmedPosition, 45);
    assert.equal(f.clock.pending, 0);
});

test('unknown-origin timeout leaves HAP values unconfirmed; no fabricated arrival', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    const displayed = f.get('CurrentPosition');
    f.command(100);
    assert.equal(f.get('PositionState'), 1);
    f.clock.advance(27000);
    assert.equal(f.handler.confirmedPosition, undefined);
    assert.equal(f.get('CurrentPosition'), displayed);
    assert.equal(f.get('TargetPosition'), 100);
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.reads.length, 1);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.clock.pending, 0);
});

test('new target cancels both estimation and pending read-response deadline', t => {
    const f = fixture(t, { constants: { EstimatePosition: true, TravelTimeUpMs: 1000, FeedbackTimeoutMs: 1000 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    f.clock.advance(2000);
    assert.equal(f.reads.length, 1);
    f.command(50);
    const current = f.handler.motion;
    for (const callback of f.clock.cancelled) callback();
    assert.equal(f.handler.motion, current);
    assert.equal(f.warnings.length, 0);
    f.bus('CurrentPosition', 50);
    f.clock.advance(50000);
    assert.equal(f.warnings.length, 0);
    assert.equal(f.reads.length, 1);
});

test('shutdown clears timers and prevents stale callbacks and subsequent bus/HK events', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 10);
    f.command(90);
    const pending = [...f.clock.tasks.values()].map(task => task.fn);
    f.api.emit('shutdown');
    assert.equal(f.clock.pending, 0);
    for (const callback of pending) callback();
    f.command(20);
    f.bus('CurrentPosition', 50);
    f.bus('TargetPosition', 80);
    assert.equal(f.get('CurrentPosition'), 10);
    assert.equal(f.writes.length, 1);
    assert.equal(f.reads.length, 0);
    assert.equal(f.clock.pending, 0);
});

test('invalid values are ignored and invalid constants fail clearly', t => {
    const f = fixture(t);
    for (const value of [NaN, Infinity, -1, 101, '30', null]) {
        f.command(value);
        f.handler.onKNXValueChange('CurrentPosition', null, value);
    }
    assert.equal(f.writes.length, 0);
    assert.equal(f.clock.pending, 0);
    assert.equal(f.handler.confirmedPosition, undefined);
    assert.equal(f.warnings.length, 12);
    const RolloHandler = require('../lib/addins/RolloHandler');
    for (const [name, value] of [['EstimatePosition', 'true'], ['TravelTimeUpMs', 0], ['TravelTimeDownMs', Infinity], ['FeedbackTimeoutMs', -1]]) {
        const handler = new RolloHandler({ getLocalConstant: key => key === name ? value : undefined });
        assert.throws(() => handler.onServiceInit(), new RegExp(name));
    }
});

test('write exceptions and asynchronous errors stop supervision without re-driving', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 10);
    let done;
    t.mock.method(access, 'knxwrite', callback => { done = callback; });
    f.command(80);
    done(new Error('bus unavailable'));
    assert.match(f.warnings.at(-1), /write failed: bus unavailable/);
    assert.equal(f.clock.pending, 0);
    assert.equal(f.get('PositionState'), 2);
    f.clock.advance(50000);
    assert.equal(f.reads.length, 0);
    t.mock.method(access, 'knxwrite', () => { throw new Error('send failed'); });
    f.command(50);
    assert.match(f.warnings.at(-1), /send failed/);
    assert.equal(f.clock.pending, 0);
});

test('stale asynchronous write errors cannot cancel a newer journey or a confirmed arrival', t => {
    const f = fixture(t);
    f.bus('CurrentPosition', 0);
    const callbacks = [];
    t.mock.method(access, 'knxwrite', callback => callbacks.push(callback));
    f.command(100);
    f.command(50);
    const motion = f.handler.motion;
    callbacks[0](new Error('old write'));
    assert.equal(f.handler.motion, motion);
    f.bus('CurrentPosition', 50);
    callbacks[1](new Error('late write error'));
    assert.equal(f.get('CurrentPosition'), 50);
    assert.equal(f.warnings.length, 0);
});

test('real HAP write is acknowledged without waiting for travel; position updates do not re-enter KNX writes', async t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 0);
    const target = f.service.serviceHK.getCharacteristic(hap.Characteristic.TargetPosition);
    await target.handleSetRequest(100);
    assert.equal(f.clock.now, 100000);
    assert.equal(f.writes.length, 1);
    assert.equal(target.value, 100);
    f.clock.advance(2000);
    f.bus('CurrentPosition', 12);
    assert.equal(f.writes.length, 1);
    assert.equal(target.value, 12);
});

test('an immediate read response cancels the armed feedback wait and no warning follows', t => {
    const f = fixture(t, { constants: { EstimatePosition: true, TravelTimeUpMs: 1000, FeedbackTimeoutMs: 1000 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    t.mock.method(access, 'knxread', () => f.bus('CurrentPosition', 90));
    f.clock.advance(2000);
    assert.equal(f.get('CurrentPosition'), 90);
    assert.equal(f.clock.pending, 0);
    f.clock.advance(5000);
    assert.equal(f.warnings.length, 1, 'only the deviating position warning is emitted');
    assert.match(f.warnings[0], /90%.*100%/);
});

test('failed read is reported and supervision still ends without automatic driving', t => {
    const f = fixture(t, { constants: { TravelTimeUpMs: 1000, FeedbackTimeoutMs: 1000 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    t.mock.method(access, 'knxread', (address, onError) => onError(new Error('read socket failed')));
    f.clock.advance(2000);
    assert.match(f.warnings[0], /read socket failed/);
    f.clock.advance(1000);
    assert.match(f.warnings[1], /No end-position feedback/);
    assert.equal(f.writes.length, 1);
    assert.equal(f.clock.pending, 0);
});

test('knxjs propagates transport write errors and does not repeat a completion-aware command on reconnect', t => {
    const f = fixture(t);
    let options, attempts = 0, finish;
    t.mock.method(access, 'knxwrite', realKnxwrite);
    t.mock.method(require('knx'), 'Connection', opts => {
        options = opts;
        return { write(address, value, dpt, callback) {
            assert.equal(address, '3/0/6');
            assert.equal(value, 20);
            assert.equal(dpt, 'DPT5.001');
            attempts++;
            finish = callback;
        } };
    });
    f.bus('CurrentPosition', 10);
    f.command(80);
    options.handlers.connected();
    finish(new Error('routing write failed'));
    assert.match(f.warnings.at(-1), /routing write failed/);
    assert.equal(f.clock.pending, 0);
    options.handlers.connected();
    assert.equal(attempts, 1);
});

test('knxjs connection error is reported, not retried when connected later', t => {
    const f = fixture(t);
    let options;
    t.mock.method(access, 'knxwrite', realKnxwrite);
    t.mock.method(require('knx'), 'Connection', opts => {
        options = opts;
        return { write: () => assert.fail('command must not retry after connection error') };
    });
    f.command(50);
    options.handlers.error(new Error('offline'));
    assert.match(f.warnings.at(-1), /offline/);
    options.handlers.connected();
    assert.equal(f.clock.pending, 0);
});

for (const stage of ['socketRemote', 'openTGroup', 'sendAPDU']) {
    test(`knxd propagates ${stage} write errors to the handler`, t => {
        const f = fixture(t, { backend: 'knxd' });
        t.mock.method(access, 'knxwrite', realKnxwrite);
        t.mock.method(require('eibd'), 'Connection', function () {
            this.socketRemote = (opts, callback) => callback(stage === 'socketRemote' ? new Error(stage) : undefined);
            this.openTGroup = (dest, mode, callback) => callback(stage === 'openTGroup' ? new Error(stage) : undefined);
            this.sendAPDU = (msg, callback) => callback(stage === 'sendAPDU' ? new Error(stage) : undefined);
        });
        f.bus('CurrentPosition', 10);
        f.command(80);
        assert.match(f.warnings.at(-1), new RegExp(stage));
        assert.equal(f.get('PositionState'), 2);
        assert.equal(f.clock.pending, 0);
    });
    test(`knxd propagates ${stage} read errors without throwing out of the timer`, t => {
        const f = fixture(t, { backend: 'knxd', constants: { TravelTimeUpMs: 1000, FeedbackTimeoutMs: 1000 } });
        t.mock.method(access, 'knxread', realKnxread);
        t.mock.method(require('eibd'), 'Connection', function () {
            this.socketRemote = (opts, callback) => callback(stage === 'socketRemote' ? new Error(stage) : undefined);
            this.openTGroup = (dest, mode, callback) => callback(stage === 'openTGroup' ? new Error(stage) : undefined);
            this.sendAPDU = (msg, callback) => callback(stage === 'sendAPDU' ? new Error(stage) : undefined);
        });
        f.bus('CurrentPosition', 0);
        f.command(100);
        f.clock.advance(2000);
        assert.match(f.warnings.at(-1), new RegExp(stage));
        f.clock.advance(1000);
        assert.equal(f.get('PositionState'), 2);
        assert.equal(f.clock.pending, 0);
    });
}

test('startup uses the existing paced KNXReadRequests queue, with no movement', t => {
    const f = fixture(t);
    access.knxreadhash(f.globs.readRequests);
    f.clock.advance(2999);
    assert.equal(f.reads.length, 0);
    f.clock.advance(1);
    assert.deepEqual(f.reads, ['3/0/7']);
    f.clock.advance(80);
    assert.equal(f.writes.length, 0);
    assert.equal(f.handler.confirmedPosition, undefined);
    f.bus('CurrentPosition', 75);
    assert.equal(f.get('CurrentPosition'), 75);
    assert.equal(f.get('TargetPosition'), 75);
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.clock.pending, 0);
});

test('fractional values are rounded after inversion and unchanged targets remain idempotent', t => {
    const f = fixture(t);
    f.handler.onKNXValueChange('CurrentPosition', null, 50.5);
    assert.equal(f.get('CurrentPosition'), 50);
    f.clock.advance(3000); // no echo history involved
    f.bus('TargetPosition', 50);
    assert.equal(f.handler.motion, undefined);
    f.command(42.6);
    assert.equal(f.get('TargetPosition'), 43);
    assert.equal(f.writes.at(-1).value, 57);
});

test('with estimates disabled, retargeting still uses elapsed motion for direction and deadline', t => {
    const f = fixture(t, { constants: { TravelTimeUpMs: 20000, TravelTimeDownMs: 10000 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    f.clock.advance(6000);
    assert.equal(f.get('CurrentPosition'), 0);
    f.command(20);
    assert.equal(f.handler.motion.start, 30);
    assert.equal(f.get('PositionState'), 0);
    f.clock.advance(14999); // Full down time 10s + 5s reserve
    assert.equal(f.reads.length, 0);
    f.clock.advance(1);
    assert.equal(f.reads.length, 1);
});

test('optional API write callback waits for all addresses, reports one error and preserves three-argument calls', t => {
    const f = fixture(t);
    const wrapper = f.service.myCharacteristics.find(characteristic => characteristic.name === 'TargetPosition');
    wrapper.setGroupAddressList.push({ address: '3/0/8', dptype: 'DPT5.001', reversed: false });
    const completions = [];
    t.mock.method(access, 'knxwrite', callback => completions.push(callback));
    let calls = 0, result;
    f.customAPI.knxWrite('TargetPosition', 60, 'DPT5.001', error => { calls++; result = error; });
    completions[0]();
    assert.equal(calls, 0);
    completions[1]();
    assert.equal(calls, 1);
    assert.equal(result, undefined);
    f.customAPI.knxWrite('TargetPosition', 60, 'DPT5.001', error => { calls++; result = error; });
    completions[2](new Error('one destination failed'));
    completions[3]();
    assert.equal(calls, 2);
    assert.match(result.message, /destination failed/);
    f.customAPI.knxWrite('TargetPosition', 60, 'DPT5.001');
    assert.equal(completions[4], undefined);
    assert.equal(completions[5], undefined);
    wrapper.setGroupAddressList = undefined;
    f.customAPI.knxWrite('TargetPosition', 60, 'DPT5.001', error => { result = error; });
    assert.match(result.message, /No Set address/);
});

test('default debounce coalesces a slider burst and starts the journey only when sending', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: undefined, EstimatePosition: true } });
    assert.equal(f.handler.debounceMs, 500);
    f.bus('CurrentPosition', 0);
    f.command(58);
    f.clock.advance(200);
    f.command(75);
    f.clock.advance(200);
    f.command(72);
    f.clock.advance(499);
    assert.equal(f.writes.length, 0);
    assert.equal(f.handler.motion, undefined);
    assert.equal(f.handler.ownCommands.length, 0);
    assert.equal(f.get('CurrentPosition'), 0);
    f.clock.advance(1);
    assert.deepEqual(f.writes, [{ address: '3/0/6', dpt: 'DPT5.001', value: 28 }]);
    assert.equal(f.handler.motion.startedAt, f.clock.now);
    assert.equal(f.handler.motion.target, 72);
    assert.equal(f.handler.ownCommands.length, 1);
    assert.equal(f.get('PositionState'), 1);
});

test('configurable debounce restarts for identical valid targets; invalid input does not replace pending target', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 1200 } });
    f.command(70);
    f.clock.advance(1100);
    f.command(70);
    f.clock.advance(1100);
    f.command(NaN);
    assert.equal(f.writes.length, 0);
    f.clock.advance(100);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value, 30);
    assert.equal(f.handler.motion.startedAt, f.clock.now);
    assert.equal(f.warnings.length, 1);
});

test('CommandDebounceMs zero preserves immediate sending and rejects invalid delay settings', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 0 } });
    f.command(50);
    assert.equal(f.writes.length, 1);
    assert.equal(f.handler.pendingCommand, undefined);
    const RolloHandler = require('../lib/addins/RolloHandler');
    for (const value of [-1, NaN, Infinity, '500', null, 86400001]) {
        const handler = new RolloHandler({ getLocalConstant: key => key === 'CommandDebounceMs' ? value : undefined });
        assert.throws(() => handler.onServiceInit(), /CommandDebounceMs/);
    }
});

test('old journey continues through the debounce window; reversal uses position at actual send time', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 500, EstimatePosition: true, TravelTimeUpMs: 20000 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    f.clock.advance(500);
    const old = f.handler.motion;
    f.clock.advance(5500);
    f.command(20);
    assert.equal(f.handler.motion, old);
    assert.equal(f.get('PositionState'), 1);
    f.clock.advance(499);
    assert.equal(f.handler.motion, old);
    assert.equal(f.writes.length, 1);
    f.clock.advance(1);
    assert.equal(f.handler.motion.start, 30);
    assert.equal(f.get('PositionState'), 0);
    assert.equal(f.writes.length, 2);
    assert.equal(f.get('CurrentPosition'), 30);
});

test('old end-position feedback preserves a newly queued local target', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 500 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    f.clock.advance(500);
    f.command(40);
    const pending = f.handler.pendingCommand;
    f.clock.advance(200);
    f.bus('CurrentPosition', 100, { event: 'GroupValue_Write' });
    assert.equal(f.handler.pendingCommand, pending);
    assert.equal(f.get('CurrentPosition'), 100);
    assert.equal(f.get('TargetPosition'), 40);
    assert.equal(f.get('PositionState'), 2);
    f.clock.advance(300);
    assert.equal(f.writes.length, 2);
    assert.equal(f.handler.motion.start, 100);
    assert.equal(f.handler.motion.target, 40);
    assert.equal(f.get('PositionState'), 0);
});

test('external target discards a queued local command without transmitting the external command', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 500 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    f.clock.advance(200);
    f.bus('TargetPosition', 60, { event: 'GroupValue_Write' });
    assert.equal(f.handler.pendingCommand, undefined);
    assert.equal(f.get('TargetPosition'), 60);
    assert.equal(f.handler.motion.target, 60);
    f.clock.advance(1000);
    assert.equal(f.writes.length, 0);
});

test('own echoes preserve pending commands; only commands actually sent enter echo history', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 500 } });
    f.bus('CurrentPosition', 0);
    f.command(100);
    f.clock.advance(500);
    f.command(50);
    f.bus('TargetPosition', 100, { event: 'GroupValue_Write' });
    assert.equal(f.handler.pendingCommand.target, 50);
    assert.equal(f.handler.ownCommands.length, 1);
    f.bus('TargetPosition', 50, { event: 'GroupValue_Write' });
    assert.equal(f.handler.pendingCommand, undefined, 'unsent queued value is an external target, not an own echo');
    f.clock.advance(500);
    assert.equal(f.writes.length, 1);
    assert.equal(f.handler.motion.target, 50);
});

test('eight independent handlers debounce a group command concurrently, not sequentially', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 500 } });
    const handlers = [f.handler];
    for (let i = 1; i < 8; i++) {
        const config = structuredClone(f.config);
        config.UUID = hap.uuid.generate(`rollo-group-${i}`);
        config.DeviceName = `Rollo ${i}`;
        const device = new KNXDevice(f.globs, config);
        handlers.push(device.services[0].customServiceAPI.handler);
    }
    const sentAt = [];
    t.mock.method(access, 'knxwrite', callback => { sentAt.push(f.clock.now); callback(); });
    for (const handler of handlers) handler.onHKValueChange('TargetPosition', 0, 80);
    f.clock.advance(499);
    assert.equal(sentAt.length, 0);
    f.clock.advance(1);
    assert.deepEqual(sentAt, Array(8).fill(100500));
    assert.equal(f.api.listenerCount('shutdown'), 1);
    f.api.emit('shutdown');
    assert.equal(f.clock.pending, 0);
});

test('shutdown and stale debounce timers cannot transmit queued commands', t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 500 } });
    f.command(100);
    f.command(50);
    f.api.emit('shutdown');
    for (const callback of f.clock.cancelled) callback();
    f.clock.advance(5000);
    assert.equal(f.writes.length, 0);
    assert.equal(f.handler.pendingCommand, undefined);
    assert.equal(f.clock.pending, 0);
});

for (const backend of ['knxjs', 'knxd']) {
    test(`${backend}: 58% to closed uses full supervision time; stale query response cannot end the drive`, t => {
        const f = fixture(t, { backend, constants: { EstimatePosition: true } });
        f.bus('CurrentPosition', 58);
        f.command(0);
        f.clock.advance(10000);
        assert.equal(f.get('CurrentPosition'), 0);
        assert.equal(f.get('PositionState'), 0);
        f.clock.advance(5000);
        assert.equal(f.reads.length, 0, 'no premature partial-way read after 15 seconds');
        f.clock.advance(6999);
        assert.equal(f.reads.length, 0);
        f.clock.advance(1);
        assert.equal(f.reads.length, 1, '17 seconds full closing time plus 5 seconds reserve');
        const motion = f.handler.motion;
        f.bus('CurrentPosition', 58, { event: 'GroupValue_Response' });
        assert.equal(f.handler.motion, motion);
        assert.equal(f.get('CurrentPosition'), 0);
        assert.equal(f.get('PositionState'), 0);
        assert.equal(f.handler.confirmedPosition, 58);
        f.clock.advance(4000);
        f.bus('CurrentPosition', 0, { event: 'GroupValue_Write' });
        assert.equal(f.handler.motion, undefined);
        assert.equal(f.get('CurrentPosition'), 0);
        assert.equal(f.get('TargetPosition'), 0);
        assert.equal(f.get('PositionState'), 2);
        assert.equal(f.handler.confirmedPosition, 0);
        assert.equal(f.clock.pending, 0);
        assert.equal(f.writes.length, 1);
    });
}

test('actual final write after 19 seconds cancels the later full-time read; no new calibration is assumed', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 58);
    f.command(0);
    f.clock.advance(19000);
    f.bus('CurrentPosition', 0, { event: 'GroupValue_Write' });
    f.clock.advance(10000);
    assert.equal(f.reads.length, 0);
    assert.equal(f.handler.downMs, 17000);
    assert.equal(f.get('PositionState'), 2);
});

test('spontaneous writes remain authoritative, including unchanged and differing final positions', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 58);
    f.command(0);
    f.clock.advance(22000);
    f.bus('CurrentPosition', 58, { event: 'GroupValue_Write' });
    assert.equal(f.handler.motion, undefined, 'same starting position can be a genuine failed drive');
    assert.equal(f.get('CurrentPosition'), 58);
    assert.equal(f.get('TargetPosition'), 58);
    f.command(0);
    f.clock.advance(5000);
    f.bus('CurrentPosition', 30, { event: 'GroupValue_Write' });
    assert.equal(f.get('CurrentPosition'), 30);
    assert.equal(f.get('TargetPosition'), 30);
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.writes.length, 2);
});

test('read responses near the target can confirm arrival; missing metadata uses only a bounded old-value rule', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 58);
    f.command(0);
    f.clock.advance(22000);
    f.bus('CurrentPosition', 30, { event: 'GroupValue_Response' });
    assert.equal(f.handler.motion.queryPending, true, 'partial read response is not an end notification');
    f.bus('CurrentPosition', 58);
    assert.equal(f.handler.motion.queryPending, true, 'untyped old value during our query window is ambiguous');
    f.bus('CurrentPosition', 1, { event: 'GroupValue_Response' });
    assert.equal(f.handler.motion, undefined);
    assert.equal(f.get('CurrentPosition'), 1);
    assert.equal(f.get('TargetPosition'), 1);
    f.command(0);
    f.bus('CurrentPosition', 1); // outside the query window, identical values are accepted
    assert.equal(f.handler.motion, undefined);
});

test('stale responses cannot extend supervision indefinitely or roll back the displayed estimate', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 58);
    f.command(0);
    f.clock.advance(22000);
    for (let i = 0; i < 5; i++) {
        f.bus('CurrentPosition', 58, { event: 'GroupValue_Response' });
        f.clock.advance(1000);
    }
    assert.equal(f.handler.motion, undefined);
    assert.equal(f.handler.positionKnown, false);
    assert.equal(f.handler.confirmedPosition, 58);
    assert.equal(f.get('CurrentPosition'), 0, 'display is frozen; the old response is not manufactured into a new position');
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.reads.length, 1);
    assert.equal(f.clock.pending, 0);
    f.bus('CurrentPosition', 5, { event: 'GroupValue_Write' });
    assert.equal(f.get('CurrentPosition'), 5);
    assert.equal(f.get('TargetPosition'), 5);
    assert.equal(f.handler.positionKnown, true);
});

test('unknown direction waits for the longer full travel time', t => {
    const f = fixture(t, { constants: { TravelTimeUpMs: 1000, TravelTimeDownMs: 3000, FeedbackTimeoutMs: 500 } });
    f.command(50);
    f.clock.advance(3499);
    assert.equal(f.reads.length, 0);
    f.clock.advance(1);
    assert.equal(f.reads.length, 1);
});

test('real HAP values, change order and handler caches keep target separate from current while closing', async t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 58);
    f.updates.length = 0;
    const target = f.service.serviceHK.getCharacteristic(hap.Characteristic.TargetPosition);
    await target.handleSetRequest(0);
    assert.equal(f.clock.now, 100000, 'write acknowledgement does not wait for travel');
    assert.equal(f.get('CurrentPosition'), 58);
    assert.equal(f.customAPI.charValueList.CurrentPosition, 58);
    assert.equal(f.get('TargetPosition'), 0);
    assert.equal(f.customAPI.charValueList.TargetPosition, 0);
    assert.equal(f.get('PositionState'), 0);
    const stateIndex = f.updates.findIndex(event => event.field === 'PositionState');
    const targetIndex = f.updates.findIndex(event => event.field === 'TargetPosition');
    assert.ok(stateIndex >= 0 && stateIndex < targetIndex, 'sent movement state precedes target change');
    assert.equal(f.updates.some(event => event.field === 'CurrentPosition'), false);
    f.clock.advance(1000);
    assert.equal(f.get('CurrentPosition'), 52);
    assert.equal(f.customAPI.charValueList.CurrentPosition, 52);
    f.clock.advance(9000);
    assert.equal(f.get('CurrentPosition'), 0);
    assert.equal(f.get('PositionState'), 0, 'a modeled closed position does not set STOPPED');
    assert.equal(f.updates.filter(event => event.field === 'CurrentPosition').every(event => event.context === 'fromKNXBus'), true);
    f.clock.advance(9000);
    f.bus('CurrentPosition', 0, { event: 'GroupValue_Write' });
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.writes.length, 1);
});

test('real HAP write acknowledges immediately while debounce keeps the physical journey pending', async t => {
    const f = fixture(t, { constants: { CommandDebounceMs: 500, EstimatePosition: true } });
    f.bus('CurrentPosition', 58);
    const target = f.service.serviceHK.getCharacteristic(hap.Characteristic.TargetPosition);
    await target.handleSetRequest(0);
    assert.equal(f.clock.now, 100000);
    assert.equal(f.get('CurrentPosition'), 58);
    assert.equal(f.get('TargetPosition'), 0);
    assert.equal(f.get('PositionState'), 2);
    assert.equal(f.handler.motion, undefined);
    assert.equal(f.writes.length, 0);
    f.clock.advance(500);
    assert.equal(f.get('PositionState'), 0);
    assert.equal(f.get('CurrentPosition'), 58);
    assert.equal(f.writes.length, 1);
});

test('handlers without the new acknowledgement opt-in retain the existing callback order', () => {
    const CustomServiceAPI = require('../lib/customServiceAPI');
    const order = [];
    const customAPI = Object.assign(Object.create(CustomServiceAPI.prototype), {
        handler: { onHKValueChange() { order.push('handler'); } }, charValueList: { On: false },
    });
    customAPI.homekitEventCatcher('On', true, () => order.push('ack'));
    assert.deepEqual(order, ['ack', 'handler']);
    assert.equal(customAPI.charValueList.On, true);
});

test('metadata also reaches handlers through pseudo KNX objects without changing values', t => {
    const f = fixture(t);
    f.customAPI.addPseudoCharacteristic('ExtraPosition', undefined, '3/0/8', 'DPT5.001');
    const received = [];
    t.mock.method(f.handler, 'onKNXValueChange', (...args) => received.push(args));
    f.customAPI.knxbusEventCatcher('ExtraPosition', 25, '1.1.2', '3/0/8', { event: 'GroupValue_Response' });
    assert.deepEqual(received, [['ExtraPosition', null, 25, { event: 'GroupValue_Response' }]]);
    assert.equal(f.customAPI.charValueList.ExtraPosition, 25);
});

test('typed stale responses from startup or another reader cannot prematurely confirm an active journey', t => {
    const f = fixture(t, { constants: { EstimatePosition: true } });
    f.bus('CurrentPosition', 58, { event: 'GroupValue_Response' });
    f.command(0);
    f.clock.advance(3000);
    const motion = f.handler.motion;
    const displayed = f.get('CurrentPosition');
    f.bus('CurrentPosition', 58, { event: 'GroupValue_Response' });
    assert.equal(f.handler.motion, motion);
    assert.equal(f.get('CurrentPosition'), displayed);
    assert.equal(f.get('PositionState'), 0);
    f.bus('CurrentPosition', 58, { event: 'GroupValue_Write' });
    assert.equal(f.handler.motion, undefined);
    assert.equal(f.get('CurrentPosition'), 58);
});

for (const active of [false, true]) {
    test(`external repeated ${active ? 'active' : 'confirmed idle'} target still cancels a newer unsent local command`, t => {
        const f = fixture(t, { constants: { CommandDebounceMs: 500 } });
        f.bus('CurrentPosition', active ? 0 : 80);
        if (active) f.bus('TargetPosition', 80, { event: 'GroupValue_Write' });
        const motion = f.handler.motion;
        f.command(40);
        f.bus('TargetPosition', 80, { event: 'GroupValue_Write' });
        assert.equal(f.handler.pendingCommand, undefined);
        assert.equal(f.handler.motion, motion);
        assert.equal(f.get('TargetPosition'), 80);
        f.clock.advance(1000);
        assert.equal(f.writes.length, 0);
    });
}
