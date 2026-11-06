'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const knx = require('knx');
const knxd = require('eibd');

function monitorFor(t, backend) {
    const modulePath = require.resolve('../lib/knxmonitor');
    const cached = require.cache[modulePath];
    delete require.cache[modulePath];
    const monitor = require(modulePath);
    t.after(() => {
        delete require.cache[modulePath];
        if (cached) require.cache[modulePath] = cached;
    });
    const datapoints = [];
    const parser = new EventEmitter();
    let options;
    t.mock.method(knx, 'Datapoint', function (config) {
        assert.equal(backend, 'knxjs');
        const point = new EventEmitter();
        point.bind = () => {};
        assert.equal(config.autoread, false);
        datapoints.push(point);
        return point;
    });
    t.mock.method(knx, 'Connection', opts => {
        assert.equal(backend, 'knxjs');
        options = opts;
        return {};
    });
    t.mock.method(knxd, 'Connection', function () {
        assert.equal(backend, 'knxd');
        const connection = new EventEmitter();
        connection.socketRemote = (opts, callback) => callback();
        connection.openGroupSocket = (flag, callback) => callback(parser);
        return connection;
    });
    monitor.setGlobs({ knxconnection: backend, debug() {}, log() {} });
    return { monitor, datapoints, parser, connect() {
        monitor.startMonitor({ host: '127.0.0.1', port: 6720 });
        if (options) options.handlers.connected();
    } };
}

for (const backend of ['knxjs', 'knxd']) {
    test(`${backend}: monitor preserves write/response identity in optional fourth callback argument`, t => {
        const f = monitorFor(t, backend);
        const received = [];
        const legacy = [];
        f.monitor.registerGA('3/0/7', 'DPT5.001', (...args) => received.push(args));
        f.monitor.registerGA('3/0/7', 'DPT5.001', (value, src, dest) => legacy.push([value, src, dest]));
        f.connect();
        if (backend === 'knxjs') {
            for (const point of f.datapoints) {
                point.emit('event', 'GroupValue_Write', 42, '1.1.2');
                point.emit('event', 'GroupValue_Response', 58, '1.1.2');
                point.emit('event', 'GroupValue_Read', 0, '1.1.2');
            }
        } else {
            f.parser.emit('write', '1.1.2', '3/0/7', 'DPT5.001', 42);
            f.parser.emit('response', '1.1.2', '3/0/7', 'DPT5.001', 58);
        }
        assert.deepEqual(received, [
            [42, '1.1.2', '3/0/7', { event: 'GroupValue_Write' }],
            [58, '1.1.2', '3/0/7', { event: 'GroupValue_Response' }],
        ]);
        assert.deepEqual(legacy, received.map(args => args.slice(0, 3)));
    });
}
