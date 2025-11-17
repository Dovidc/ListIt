const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const eventBus = require('../infrastructure/event-bus');
const { EVENTS } = require('../infrastructure/events');
const { getJwtSecret } = require('../config/security');

function parseToken(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    return url.searchParams.get('token') || req.headers.cookie?.match(/token=([^;]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function startRealtimeServer(options = {}) {
  const port = Number(options.port || process.env.REALTIME_PORT || 4000);
  const path = options.path || process.env.WS_PATH || '/ws';
  const jwtSecret = options.jwtSecret || getJwtSecret();
  const heartbeatMs = Number(process.env.WS_HEARTBEAT_MS || 30000);

  const server = http.createServer((_req, res) => {
    res.writeHead(204);
    res.end();
  });
  const wss = new WebSocket.Server({ server, path });

  const unsubscribe = eventBus.subscribe(EVENTS.REALTIME_MESSAGE, (message) => {
    if (!message) return;
    wss.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        (client.userId === message.recipient_id || client.userId === message.sender_id)
      ) {
        try {
          client.send(JSON.stringify(message));
        } catch (err) {
          console.warn('[realtime] Failed to send message:', err?.message || err);
        }
      }
    });
  });

  wss.on('connection', (ws, req) => {
    const token = parseToken(req);
    if (!token) {
      ws.close(1008, 'No token provided');
      return;
    }

    try {
      const user = jwt.verify(token, jwtSecret);
      ws.userId = user.id;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {}
      });
      ws.send(JSON.stringify({ type: 'connected', userId: user.id }));
    } catch (err) {
      ws.close(1008, 'Invalid token');
      console.warn('[realtime] Invalid token rejected:', err?.message || err);
    }
  });

  let heartbeat = null;
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      wss.clients.forEach((client) => {
        if (client.isAlive === false) {
          client.terminate();
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, heartbeatMs);

    if (heartbeat && typeof heartbeat.unref === 'function') {
      heartbeat.unref();
    }
  }

  server.listen(port, () => {
    console.log(`[realtime] listening on port ${port}${path}`);
  });

  return {
    close: () => {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      wss.close();
      server.close();
    }
  };
}

module.exports = { startRealtimeServer };
