const { EventEmitter } = require('events');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
let Redis = null;
try {
  Redis = require('ioredis');
} catch (err) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[bus] ioredis not available, falling back to in-memory pub/sub');
  }
}

class LocalSocketBus {
  constructor(options = {}) {
    this.emitter = new EventEmitter();
    this.id = randomUUID();
    this.options = {
      port: Number(process.env.LOCAL_EVENT_BUS_PORT || options.port || 4455),
      host: process.env.LOCAL_EVENT_BUS_HOST || options.host || '127.0.0.1',
      reconnectDelayMs: Number(process.env.LOCAL_EVENT_BUS_RETRY_MS || options.reconnectDelayMs || 500),
    };

    this.server = null;
    this.serverSockets = new Set();
    this.client = null;
    this.clientBuffer = '';
    this.pending = [];
    this.connecting = false;
    this._ensureClient();
  }

  _log(...args) {
    if (process.env.NODE_ENV === 'test') return;
    console.log('[bus:fallback]', ...args);
  }

  _ensureClient() {
    if (this.connecting || (this.client && !this.client.destroyed)) {
      return;
    }
    this.connecting = true;
    const attemptConnection = () => {
      const socket = net.createConnection(this.options);

      const handleError = (err) => {
        socket.removeAllListeners();
        socket.destroy();
        if (err && err.code === 'ECONNREFUSED') {
          this._startServer()
            .then(() => this._ensureClient())
            .catch(() => setTimeout(() => this._ensureClient(), this.options.reconnectDelayMs));
          return;
        }
        setTimeout(() => this._ensureClient(), this.options.reconnectDelayMs);
      };

      socket.once('error', handleError);
      socket.once('connect', () => {
        socket.off('error', handleError);
        this.connecting = false;
        this.client = socket;
        this.client.setEncoding('utf8');
        this.client.on('data', (chunk) => this._handleClientData(chunk));
        this.client.on('close', () => {
          this.client = null;
          this.clientBuffer = '';
          setTimeout(() => this._ensureClient(), this.options.reconnectDelayMs);
        });
        this.client.on('error', () => {
          if (this.client) {
            this.client.destroy();
          }
        });
        this._flushPending();
      });
    };

    attemptConnection();
  }

  _startServer() {
    if (this.server) {
      return Promise.resolve();
    }
    if (this.serverStarting) {
      return this.serverStarting;
    }
    this.serverStarting = new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this._handleServerConnection(socket));
      server.once('error', (err) => {
        server.close(() => {
          this.server = null;
          this.serverStarting = null;
          if (err.code === 'EADDRINUSE') {
            return reject(err);
          }
          console.warn('[bus] Local fallback server error:', err?.message || err);
          reject(err);
        });
      });
      server.on('close', () => {
        this.server = null;
        this.serverSockets.clear();
      });
      server.listen(this.options.port, this.options.host, () => {
        this.server = server;
        this.serverStarting = null;
        this._log(`local bus listening on ${this.options.host}:${this.options.port}`);
        resolve();
      });
    });
    return this.serverStarting;
  }

  _handleServerConnection(socket) {
    socket.setEncoding('utf8');
    socket.buffer = '';
    this.serverSockets.add(socket);
    socket.on('data', (chunk) => this._handleServerData(socket, chunk));
    socket.on('close', () => this.serverSockets.delete(socket));
    socket.on('error', () => {
      socket.destroy();
      this.serverSockets.delete(socket);
    });
  }

  _handleServerData(originSocket, chunk) {
    originSocket.buffer += chunk;
    let newlineIndex = originSocket.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = originSocket.buffer.slice(0, newlineIndex);
      originSocket.buffer = originSocket.buffer.slice(newlineIndex + 1);
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          const payload = `${JSON.stringify(message)}\n`;
          for (const socket of this.serverSockets) {
            if (socket === originSocket) continue;
            socket.write(payload);
          }
          this.emitter.emit(message.event, message.payload);
        } catch (err) {
          console.warn('[bus] Failed to parse local bus payload:', err?.message || err);
        }
      }
      newlineIndex = originSocket.buffer.indexOf('\n');
    }
  }

  _handleClientData(chunk) {
    this.clientBuffer += chunk;
    let newlineIndex = this.clientBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.clientBuffer.slice(0, newlineIndex);
      this.clientBuffer = this.clientBuffer.slice(newlineIndex + 1);
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.emitter.emit(message.event, message.payload);
        } catch (err) {
          console.warn('[bus] Failed to parse client payload:', err?.message || err);
        }
      }
      newlineIndex = this.clientBuffer.indexOf('\n');
    }
  }

  _flushPending() {
    if (!this.client || this.client.destroyed || !this.pending.length) {
      return;
    }
    for (const payload of this.pending.splice(0)) {
      this.client.write(payload);
    }
  }

  publish(event, payload) {
    const envelope = `${JSON.stringify({ event, payload, origin: this.id })}\n`;
    this.emitter.emit(event, payload);
    if (this.client && !this.client.destroyed) {
      this.client.write(envelope);
    } else {
      this.pending.push(envelope);
      this._ensureClient();
    }
  }

  subscribe(event, handler) {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }
}

class RedisBus {
  constructor(url) {
    this.emitter = new EventEmitter();
    this.url = url;
    this.channels = new Set();
    this.processId = `${process.pid}-${Math.random().toString(36).slice(2)}`;

    const redisOptions = { lazyConnect: true, maxRetriesPerRequest: 3 };
    this.pub = new Redis(url, redisOptions);
    this.sub = new Redis(url, redisOptions);

    this.sub.on('message', (channel, message) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.meta && parsed.meta.origin === this.processId) {
          // Ignore events that originated from this process; we already emit locally
          return;
        }
        this.emitter.emit(channel, parsed.payload);
      } catch (err) {
        console.warn('[bus] Failed to parse payload:', err?.message || err);
      }
    });

    this.connected = Promise.allSettled([
      this.pub.connect(),
      this.sub.connect()
    ]).then((results) => {
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected) {
        throw rejected.reason;
      }
      if (process.env.NODE_ENV !== 'test') {
        console.log('[bus] Redis pub/sub connected');
      }
    }).catch((err) => {
      console.warn('[bus] Redis connection failed, reverting to in-memory bus:', err?.message || err);
      this.dispose();
      this.fallback = new LocalSocketBus();
    });
  }

  dispose() {
    if (this.pub) {
      this.pub.disconnect();
    }
    if (this.sub) {
      this.sub.disconnect();
    }
  }

  publish(event, payload) {
    if (this.fallback) {
      this.fallback.publish(event, payload);
      return;
    }

    this.emitter.emit(event, payload);
    const envelope = JSON.stringify({ payload, meta: { origin: this.processId } });
    this.pub.publish(event, envelope).catch((err) => {
      console.warn('[bus] Failed to publish event', event, err?.message || err);
    });
  }

  subscribe(event, handler) {
    if (this.fallback) {
      return this.fallback.subscribe(event, handler);
    }

    this.emitter.on(event, handler);
    if (!this.channels.has(event)) {
      this.channels.add(event);
      this.sub.subscribe(event).catch((err) => {
        console.warn('[bus] Failed to subscribe to', event, err?.message || err);
      });
    }

    return () => this.emitter.off(event, handler);
  }
}

function createBus() {
  const url = process.env.MESSAGE_BUS_URL || process.env.REDIS_URL || null;
  if (url && Redis) {
    try {
      return new RedisBus(url);
    } catch (err) {
      console.warn('[bus] Unable to initialize Redis bus, falling back to memory:', err?.message || err);
    }
  }
  return new LocalSocketBus();
}

module.exports = createBus();
