'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hap = require('@homebridge/hap-nodejs');
const KNXDevice = require('../lib/knxdevice');
const CustomServiceAPI = require('../lib/customServiceAPI');
const access = require('../lib/knxaccess');
const noop = () => {};

beforeEach(t => {
    // An unexpected bus access fails locally instead of reaching a real network.
    for (const transport of [require('knx'), require('eibd')]) {
        t.mock.method(transport, 'Connection', () => assert.fail('Unexpected KNX network connection'));
    }
});

// Only the Homebridge host boundary is doubled. Accessories, services,
// characteristics and cache serialization use the real public HAP classes.
function fixture() {
    const registrations = [];
    const api = {
        hap,
        platformAccessory: class extends hap.Accessory {
            constructor(name, uuid, category) {
                super(name, uuid);
                // Match the public PlatformAccessory constructor contract.
                if (category !== undefined) this.category = category;
            }
        },
        registerPlatformAccessories(plugin, platform, accessories) {
            registrations.push({ plugin, platform, accessories });
        },
    };
    const globs = {
        API: api, Service: hap.Service, Characteristic: hap.Characteristic,
        log: Object.assign(noop, { warn: noop }), info: noop, debug: noop,
        errorlog: noop, readRequests: {}, knxconnection: 'knxjs',
        knxmonitor: { registerGA: noop },
    };
    const config = {
        DeviceName: 'Test Device', UUID: hap.uuid.generate('persistent-device'),
        HKCategory: 'LIGHTBULB', SerialNumber: 'existing-serial',
        Services: [{
            ServiceName: 'Test Light', ServiceType: 'Lightbulb', subtype: 'persistent-subtype',
            Characteristics: [{ Type: 'On', Set: '1/1/1', Listen: '1/1/2', DPT: 'DPT1' }],
        }],
    };
    access.setGlobs(globs);
    return { api, globs, config, registrations };
}

test('plugin initializes and registers the dynamic KNX platform', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knx-register-'));
    try {
        const calls = [];
        require('../index')({
            hap, version: 2.0, user: { storagePath: () => dir },
            registerPlatform: (...args) => calls.push(args),
        });
        assert.equal(calls.length, 1);
        assert.deepEqual([calls[0][0], calls[0][1], calls[0][3]], ['homebridge-knx', 'KNX', true]);
        assert.equal(typeof calls[0][2], 'function');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('new device uses public Categories and registers its persistent identity', () => {
    const f = fixture();
    const device = new KNXDevice(f.globs, f.config);
    assert.equal(device.platformAccessory.category, hap.Categories.LIGHTBULB);
    assert.equal(device.platformAccessory.UUID, f.config.UUID);
    assert.equal(f.registrations.length, 1);
    assert.deepEqual(f.registrations[0], {
        plugin: 'homebridge-knx', platform: 'KNX', accessories: [device.platformAccessory],
    });
});

test('cached device and existing service are reused by getServiceById', () => {
    const f = fixture();
    const first = new KNXDevice(f.globs, f.config);
    const cached = hap.Accessory.deserialize(hap.Accessory.serialize(first.platformAccessory));
    // HAP Accessory uses getServiceById too, just like Homebridge PlatformAccessory.
    const service = cached.getServiceById(hap.Service.Lightbulb, 'persistent-subtype');
    const count = cached.services.length;
    const restored = new KNXDevice(f.globs, f.config, cached);
    assert.equal(restored.platformAccessory, cached);
    assert.equal(restored.services[0].getHomeKitService(), service);
    assert.equal(cached.services.length, count);
    assert.equal(f.registrations.length, 1, 'restoration must not register again');
    assert.equal(cached.UUID, f.config.UUID);
    assert.equal(service.subtype, 'persistent-subtype');
    assert.equal(cached.getService(hap.Service.AccessoryInformation)
        .getCharacteristic(hap.Characteristic.SerialNumber).value, 'existing-serial');
});

test('custom thermostat characteristic uses HAP 2 enums and unchanged UUID', () => {
    require('../lib/customtypes/knxthermostat')({ hap });
    const characteristic = new hap.Characteristic.KNXThermAtHome();
    assert.ok(characteristic instanceof hap.Characteristic);
    assert.equal(characteristic.UUID, '00001025-0000-1000-8000-0026BB765292');
    assert.equal(characteristic.props.format, hap.Formats.BOOL);
    assert.deepEqual(characteristic.props.perms, [hap.Perms.PAIRED_READ, hap.Perms.PAIRED_WRITE, hap.Perms.NOTIFY]);
    assert.equal(characteristic.value, false);
});

test('existing handler write path updates HAP, emits change and never writes KNX', t => {
    const f = fixture();
    const device = new KNXDevice(f.globs, f.config);
    const wrapper = device.services[0].myCharacteristics[0];
    const characteristic = wrapper.getHomekitCharacteristic();
    let writes = 0;
    t.mock.method(access, 'knxwrite', () => { writes++; });
    let sets = 0;
    characteristic.on('set', () => { sets++; });
    const events = [];
    characteristic.on('change', event => events.push(event));
    // Exercise the existing API method without loading an unrelated add-in.
    const handlerAPI = Object.assign(Object.create(CustomServiceAPI.prototype), {
        serviceKNX: device.services[0], handlerName: 'Test',
        characteristicsList: { On: wrapper }, charValueList: {},
    });
    handlerAPI.setValue('On', true);
    assert.equal(characteristic.value, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].oldValue, false);
    assert.equal(events[0].newValue, true);
    assert.equal(events[0].context, 'fromKNXBus');
    assert.equal(sets, 0);
    assert.equal(writes, 0);
    assert.equal(handlerAPI.getValue('On'), true);
    f.globs.devices = [device];
    assert.equal(handlerAPI.getGlobalValue('Test Device', 'Test Light', 'On'), true);
});

test('exported group-address completion accepts real HAP characteristic formats', () => {
    const f = fixture();
    const { gaComplete } = require('../lib/groupaddress');
    for (const Type of [hap.Characteristic.On, hap.Characteristic.Brightness, hap.Characteristic.CurrentTemperature]) {
        const result = gaComplete('1/2/3', f.globs, new Type());
        assert.equal(result.address, '1/2/3');
    }
});
