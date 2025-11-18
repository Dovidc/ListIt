/**
 * WebSocket/Real-Time Service
 *
 * Handles:
 * - WebSocket connections and authentication
 * - Chat message relay and presence
 * - Real-time notifications
 * - Heartbeat and connection health
 */

const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { MessageBus, TOPICS } = require('../lib/message-bus');

class WebSocketService {
  constructor(config, messageBus, options = {}) {
    this.config = config;
    this.messageBus = messageBus;

    // Store for user sessions (userId -> Set of WebSocket connections)
    this.userSessions = new Map();

    // WebSocket server instance
    this.wss = null;
    this.server = null;
    this.externalServer = options?.server || null;
    this.ownsServer = !this.externalServer;
    this.heartbeatInterval = null;
    this.subscriptions = [];

    // Bind methods
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.broadcast = this.broadcast.bind(this);
    this.sendToUser = this.sendToUser.bind(this);
    this.handleConnection = this.handleConnection.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleMessageEvent = this.handleMessageEvent.bind(this);
  }

  /**
   * Start the WebSocket service
   */
  async start() {
    return new Promise((resolve, reject) => {
      const initialize = () => {
        try {
          this.wss = new WebSocket.Server({
            server: this.server,
            path: '/ws'
          });

          // Setup error handler
          this.wss.on('error', (error) => {
            console.error('[WebSocket] Server error:', error);
          });

          // Setup connection handler
          this.wss.on('connection', this.handleConnection);

          const port = this.config.WEBSOCKET_PORT || 3002;
          if (this.ownsServer) {
            console.log(`[WebSocket] Service listening on port ${port}`);
          } else {
            console.log('[WebSocket] Service attached to existing HTTP server');
          }

          // Setup heartbeat to detect stale connections
          if (!this.config.IS_TEST) {
            this.startHeartbeat();
          }

          this.subscriptions.push(
            this.messageBus.subscribe(TOPICS.MESSAGE_SENT, this.handleMessageEvent)
          );

          resolve();
        } catch (err) {
          console.error('[WebSocket] Failed to start service:', err);
          reject(err);
        }
      };

      try {
        if (this.externalServer) {
          this.server = this.externalServer;
          initialize();
          return;
        }

        // Create HTTP server for WebSocket when running standalone
        this.server = http.createServer();

        // Start listening
        const port = this.config.WEBSOCKET_PORT || 3002;
        this.server.listen(port, initialize);

        // Setup server error handler
        this.server.on('error', (err) => {
          console.error('[WebSocket] HTTP server error:', err);
          reject(err);
        });
      } catch (err) {
        console.error('[WebSocket] Failed to start service:', err);
        reject(err);
      }
    });
  }

  /**
   * Stop the WebSocket service
   */
  async stop() {
    if (Array.isArray(this.subscriptions)) {
      this.subscriptions.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          try {
            unsubscribe();
          } catch (err) {
            console.warn('[WebSocket] Failed to remove message bus subscription:', err?.message || err);
          }
        }
      });
    }
    this.subscriptions = [];

    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      if (this.wss) {
        // Close all connections
        this.wss.clients.forEach(ws => {
          ws.close(1001, 'Server shutting down');
        });

        const finalize = () => {
          console.log('[WebSocket] Service stopped');
          resolve();
        };

        if (this.server && this.ownsServer) {
          this.server.close(finalize);
        } else {
          finalize();
        }
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, req) {
    // Extract token from query string or cookie
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || req.headers.cookie?.match(/token=([^;]+)/)?.[1];

    if (!token) {
      ws.close(1008, 'No token provided');
      return;
    }

    try {
      // Verify JWT token
      const user = jwt.verify(token, this.config.JWT_SECRET);
      ws.userId = user.id;
      ws.isAlive = true;

      // Register user session
      if (!this.userSessions.has(user.id)) {
        this.userSessions.set(user.id, new Set());
      }
      this.userSessions.get(user.id).add(ws);

      console.log(`[WebSocket] User ${user.id} connected`);

      // Setup pong handler for heartbeat
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Setup message handler
      ws.on('message', (message) => {
        this.handleMessage(ws, message);
      });

      // Setup close handler
      ws.on('close', () => {
        this.userSessions.get(user.id).delete(ws);
        if (this.userSessions.get(user.id).size === 0) {
          this.userSessions.delete(user.id);
        }
        console.log(`[WebSocket] User ${user.id} disconnected`);
      });

      // Setup error handler
      ws.on('error', (error) => {
        console.error(`[WebSocket] Connection error for user ${user.id}:`, error);
      });

      // Send connected message
      ws.send(JSON.stringify({
        type: 'connected',
        userId: user.id,
        timestamp: Date.now()
      }));

    } catch (err) {
      console.error('[WebSocket] Token verification failed:', err.message);
      ws.close(1008, 'Invalid token');
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(ws, rawMessage) {
    try {
      const data = JSON.parse(rawMessage);

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'message' && data.payload) {
        // Relay message through message bus
        this.messageBus.publish(TOPICS.MESSAGE_SENT, {
          userId: ws.userId,
          conversationId: data.payload.conversationId,
          content: data.payload.content,
          timestamp: Date.now()
        });
      }
      // Add more message types as needed
    } catch (err) {
      console.error('[WebSocket] Failed to process message:', err);
    }
  }

  /**
   * Handle message bus events and forward to connected clients
   */
  async handleMessageEvent(event) {
    if (!event || !this.wss) return;

    const payload = {
      type: 'new_message',
      conversation_id: event.conversationId,
      message: event.message,
      sender_id: event.senderId,
      recipient_id: event.recipientId,
      sender_username: event.senderUsername,
      listing_id: event.listingId || null
    };

    const targets = new Set(
      [event.senderId, event.recipientId].filter((id) => id !== undefined && id !== null)
    );

    for (const userId of targets) {
      await this.sendToUser(userId, payload);
    }
  }

  /**
   * Start heartbeat to detect stale connections
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // Every 30 seconds

    if (typeof this.heartbeatInterval.unref === 'function') {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  async broadcast(message) {
    if (!this.wss) return;

    const payload = JSON.stringify(message);
    this.wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  }

  /**
   * Send message to specific user
   */
  async sendToUser(userId, message) {
    const sessions = this.userSessions.get(userId);
    if (!sessions) return;

    const payload = JSON.stringify(message);
    sessions.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  }

  /**
   * Get connection count
   */
  getConnectionCount() {
    return this.wss ? this.wss.clients.size : 0;
  }

  /**
   * Get user connection count
   */
  getUserConnectionCount(userId) {
    return this.userSessions.get(userId)?.size || 0;
  }

  /**
   * Health check
   */
  async healthCheck() {
    return {
      ok: this.wss !== null,
      connections: this.getConnectionCount(),
      users: this.userSessions.size
    };
  }
}

/**
 * Create and export WebSocket service
 */
async function createWebSocketService(config, messageBus, options = {}) {
  const service = new WebSocketService(config, messageBus, options);
  return service;
}

module.exports = {
  WebSocketService,
  createWebSocketService
};
