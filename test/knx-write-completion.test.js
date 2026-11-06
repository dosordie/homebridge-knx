'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const access = require('../lib/knxaccess');
const knx = require('knx');
const knxd = require('eibd');

function fixture(t, backend, callback) {
    const writes = [], logs = [], completions = [];
    const globs = {
        knxconnection: backend, knxd_ip: '127.0.0.1', knxd_port: 6720,
        debug() {}, errorlog: message => logs.push(message), log: message => logs.push(message),
    };
    access.setGlobs(globs);
    // Exercise the transport directly, bypassing customServiceAPI entirely.
    const done = callback === null ? undefined : callback || (error => completions.push(error));
    let handlers, socket, open, send;
    t.mock.method(knx, 'Connection', options => {
        assert.equal(backend, 'knxjs');
        handlers = options.handlers;
        return { write(address, value, dpt, ack) { writes.push({ address, value, dpt }); send = ack; } };
    });
    t.mock.method(knxd, 'Connection', function () {
        assert.equal(backend, 'knxd');
        this.socketRemote = (options, ack) => { socket = ack; };
        this.openTGroup = (address, mode, ack) => { open = ack; };
        this.sendAPDU = (message, ack) => { writes.push(message); send = ack; };
    });
    access.knxwrite(done, '3/0/6', 'DPT5.001', backend === 'knxjs' ? 40 : 102);
    return {
        writes, logs, completions,
        connect() {
            if (backend === 'knxjs') handlers.connected();
            else { socket(); if (open) open(); }
        },
        ack(error) { send(error); },
        connectionError(error) {
            if (backend === 'knxjs') handlers.error(error);
            else socket(error);
        },
        socketSuccess() { socket(); },
        openResult(error) { open(error); },
    };
}

for (const backend of ['knxjs', 'knxd']) {
    test(`${backend}: successful ack then connection errors completes direct callback successfully once`, t => {
        const f = fixture(t, backend);
        f.connect();
        f.ack();
        f.connectionError(new Error('late connection error'));
        f.connectionError(new Error('another connection error'));
        f.ack(new Error('late acknowledgement'));
        assert.deepEqual(f.completions, [undefined]);
    });

    test(`${backend}: connection error then late write ack reports only the first error`, t => {
        const f = fixture(t, backend);
        f.connect();
        const error = new Error('connection failed');
        f.connectionError(error);
        f.ack();
        f.ack(new Error('late write failure'));
        assert.deepEqual(f.completions, [error]);
    });

    test(`${backend}: repeated connection errors complete only once before any write`, t => {
        const f = fixture(t, backend);
        const error = new Error('offline');
        f.connectionError(error);
        f.connectionError(new Error('still offline'));
        assert.deepEqual(f.completions, [error]);
        assert.equal(f.writes.length, 0);
    });

    test(`${backend}: failed write ack then more errors completes only once`, t => {
        const f = fixture(t, backend);
        f.connect();
        const error = new Error('write failed');
        f.ack(error);
        f.connectionError(new Error('connection failed later'));
        f.ack();
        assert.deepEqual(f.completions, [error]);
    });

    test(`${backend}: reconnect after a failed in-flight write never resends`, t => {
        const f = fixture(t, backend);
        f.connect();
        f.ack(new Error('write failed'));
        f.connect();
        assert.equal(f.writes.length, 1);
        assert.equal(f.completions.length, 1);
    });

    test(`${backend}: connection error before first connect prevents sending the failed request later`, t => {
        const f = fixture(t, backend);
        f.connectionError(new Error('offline'));
        f.connect();
        assert.equal(f.writes.length, 0);
        assert.equal(f.completions.length, 1);
    });

    test(`${backend}: duplicate successful acks and a throwing caller still complete once`, t => {
        let calls = 0;
        const f = fixture(t, backend, () => { calls++; throw new Error('caller failed'); });
        f.connect();
        assert.doesNotThrow(() => f.ack());
        assert.doesNotThrow(() => f.ack());
        assert.doesNotThrow(() => f.connectionError(new Error('late error')));
        assert.equal(calls, 1);
        assert.equal(f.logs.filter(message => message.includes('Caught error')).length, 1);
    });

    test(`${backend}: no-callback writes retain their send and reconnect behavior`, t => {
        const f = fixture(t, backend, null);
        f.connect();
        f.ack();
        // Existing fire-and-forget calls are not made one-shot by this change.
        f.connect();
        f.ack(new Error('unobserved write error'));
        assert.equal(f.writes.length, 2);
        assert.deepEqual(f.completions, []);
        if (backend === 'knxjs') {
            assert.doesNotThrow(() => f.connectionError(new Error('offline')));
            f.connect();
            assert.equal(f.writes.length, 3);
        }
    });
}

test('knxd: open-group failure is terminal even with delayed open and socket success callbacks', t => {
    const f = fixture(t, 'knxd');
    f.socketSuccess();
    const error = new Error('open failed');
    f.openResult(error);
    f.openResult();
    f.socketSuccess();
    assert.deepEqual(f.completions, [error]);
    assert.equal(f.writes.length, 0);
});

for (const backend of ['knxjs', 'knxd']) {
    test(`${backend}: completion belongs to each write request, not the shared transport module`, t => {
        const first = fixture(t, backend);
        first.connect();
        const second = fixture(t, backend);
        second.connect();
        const error = new Error('first request failed');
        first.connectionError(error);
        second.ack();
        first.ack();
        second.connectionError(new Error('late error on second request'));
        assert.deepEqual(first.completions, [error]);
        assert.deepEqual(second.completions, [undefined]);
        assert.equal(first.writes.length, 1);
        assert.equal(second.writes.length, 1);
    });
}

test('knxd: no-callback socket failure retains the existing thrown error', t => {
    const f = fixture(t, 'knxd', null);
    const logged = [];
    t.mock.method(console, 'error', message => logged.push(message));
    assert.throws(() => f.connectionError(new Error('offline')), /Cannot reach knxd or eibd service/);
    assert.match(logged[0], /offline/);
    assert.equal(f.writes.length, 0);
});
