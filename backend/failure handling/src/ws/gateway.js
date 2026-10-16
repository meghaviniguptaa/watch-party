import { WebSocketServer } from 'ws';
import { TokenBucket } from '../util/tokenBucket.js';
import { metrics } from '../metrics.js';
import { log } from '../util/logger.js';

class Connection {
  constructor(socket, maxBuffered) {
    this.socket = socket;
    this.maxBuffered = maxBuffered;
    this.room = null;
    this.participant = null;
  }

  send(obj) {
    this.sendRaw(JSON.stringify(obj));
  }

  // A consumer that cannot keep up is dropped rather than allowed to grow server memory;
  // it reconnects and receives a full snapshot.
  sendRaw(data) {
    const s = this.socket;
    if (s.readyState !== s.OPEN) return;
    if (s.bufferedAmount > this.maxBuffered) {
      metrics.count('ws.slow_consumer_dropped');
      s.terminate();
      return;
    }
    s.send(data);
  }

  close(code, reason) {
    try {
      this.socket.close(code, reason);
    } catch {
      this.socket.terminate();
    }
  }
}

export function attachGateway({ httpServer, dispatch, config }) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: config.maxPayloadBytes,
    perMessageDeflate: false,
  });

  wss.on('connection', (socket) => {
    const conn = new Connection(socket, config.maxBufferedBytes);
    const bucket = new TokenBucket(60, 30);
    socket.isAlive = true;
    metrics.count('ws.connections');

    const joinTimer = setTimeout(() => {
      if (!conn.room) conn.close(4001, 'join timeout');
    }, config.joinTimeoutMs);
    joinTimer.unref();

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        return conn.send({ t: 'error', code: 'bad_message', message: 'Binary frames are not supported' });
      }
      if (!bucket.take()) {
        metrics.count('ws.rate_limited');
        return conn.send({ t: 'error', code: 'rate_limited', message: 'Too many messages' });
      }
      dispatch(conn, data.toString());
    });

    socket.on('close', () => {
      clearTimeout(joinTimer);
      conn.room?.detach(conn);
    });

    socket.on('error', (err) => log.debug('socket error', err.message));
  });

  // Detects half-open connections: a client that misses two heartbeats is terminated,
  // which starts its reconnect grace period on the server.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        metrics.count('ws.heartbeat_timeout');
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}