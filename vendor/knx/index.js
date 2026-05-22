'use strict';

const EventEmitter = require('events');

function Connection(options = {}) {
  const handlers = options.handlers || {};
  const conn = new EventEmitter();

  const host = options.ipAddr || options.host || '127.0.0.1';
  const port = options.ipPort || options.port || 6720;

  process.nextTick(() => {
    if (typeof handlers.connected === 'function') handlers.connected();
    conn.emit('connected');
  });

  conn.write = function write(groupAddress, value, dpt, callback) {
    const knxd = require('eibd');
    const c = new knxd.Connection();
    c.socketRemote({ host, port }, (err) => {
      if (err) return callback && callback(err);
      const dest = knxd.str2addr(groupAddress);
      c.openTGroup(dest, 1, (openErr) => {
        if (openErr) return callback && callback(openErr);
        const msg = knxd.createMessage('write', dpt, value);
        c.sendAPDU(msg, callback || (() => {}));
      });
    });
  };

  conn.read = function read(groupAddress, callback) {
    const knxd = require('eibd');
    const c = new knxd.Connection();
    c.socketRemote({ host, port }, (err) => {
      if (err) return callback && callback(err);
      const dest = knxd.str2addr(groupAddress);
      c.openTGroup(dest, 1, (openErr) => {
        if (openErr) return callback && callback(openErr);
        const msg = knxd.createMessage('read', 'DPT1', 0);
        c.sendAPDU(msg, callback || (() => {}));
      });
    });
  };

  return conn;
}

class Datapoint extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
  }

  bind(connection) {
    if (this.options.autoread && this.options.ga) connection.read(this.options.ga, () => {});
    return this;
  }
}

module.exports = { Connection, Datapoint };
