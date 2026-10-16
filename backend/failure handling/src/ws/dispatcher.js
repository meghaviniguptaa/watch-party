import { ClientMessage } from './schemas.js';
import { AppError } from '../util/errors.js';
import { normalizeCode } from '../util/ids.js';
import { log } from '../util/logger.js';

export function createDispatcher({ rooms, movies }) {
  const ack = (conn, m, extra = {}) => {
    if (m.id !== undefined) conn.send({ t: 'ack', id: m.id, ...extra });
  };

  const joined = (conn) => {
    if (!conn.room || !conn.participant) throw new AppError('not_joined', 'Join a room first');
    return { room: conn.room, p: conn.participant };
  };

  const handlers = {
    ping: (conn, m) => conn.send({ t: 'pong', c: m.c, s: Date.now() }),

    join: (conn, m) => {
      if (conn.room) throw new AppError('already_joined', 'Already in a room');
      rooms.require(normalizeCode(m.room)).join(conn, m);
      ack(conn, m);
    },

    leave: (conn, m) => {
      const { room, p } = joined(conn);
      room.removeParticipant(p.id, 'left');
      ack(conn, m);
    },

    control: (conn, m) => {
      const { room, p } = joined(conn);
      if (m.action === 'seek' && m.position === undefined) {
        throw new AppError('bad_message', 'seek requires a position');
      }
      const result = room.control(p, m.action, m.position);
      ack(conn, m, { applied: result.applied, version: result.state.version });
    },

    drift: (conn, m) => {
      const { room, p } = joined(conn);
      room.reportDrift(p, m);
    },

    resync: (conn) => {
      const { room } = joined(conn);
      conn.send({ t: 'sync', state: room.clock.snapshot(), reason: 'requested' });
    },

    chat: (conn, m) => {
      const { room, p } = joined(conn);
      room.chatSend(p, m.text);
      ack(conn, m);
    },

    reaction: (conn, m) => {
      const { room, p } = joined(conn);
      room.react(p, m.emoji);
      ack(conn, m);
    },

    'playlist.add': (conn, m) => {
      const { room, p } = joined(conn);
      let { title, url } = m;
      if (m.movieId) {
        const movie = movies.get(m.movieId);
        if (!movie) throw new AppError('not_found', 'Unknown movie', 404);
        title ??= movie.title;
        url ??= movie.sourceUrl ?? null;
      }
      if (!title) throw new AppError('bad_message', 'title or movieId is required');
      const item = room.playlistAdd(p, { movieId: m.movieId, title, url }, m.playNow);
      ack(conn, m, { itemId: item.id });
    },

    'playlist.remove': (conn, m) => {
      const { room, p } = joined(conn);
      room.playlistRemove(p, m.itemId);
      ack(conn, m);
    },

    'playlist.move': (conn, m) => {
      const { room, p } = joined(conn);
      room.playlistMove(p, m.itemId, m.index);
      ack(conn, m);
    },

    'playlist.play': (conn, m) => {
      const { room, p } = joined(conn);
      room.playlistPlay(p, m.itemId);
      ack(conn, m);
    },

    'playlist.next': (conn, m) => {
      const { room, p } = joined(conn);
      room.playlistNext(p);
      ack(conn, m);
    },

    ended: (conn, m) => {
      const { room, p } = joined(conn);
      ack(conn, m, { applied: room.mediaEnded(p, m.itemId) });
    },

    'poll.create': (conn, m) => {
      const { room, p } = joined(conn);
      const poll = room.pollCreate(p, m);
      ack(conn, m, { pollId: poll.id });
    },

    'poll.vote': (conn, m) => {
      const { room, p } = joined(conn);
      room.pollVote(p, m.pollId, m.option);
      ack(conn, m);
    },

    'poll.close': (conn, m) => {
      const { room, p } = joined(conn);
      room.pollClose(p, m.pollId);
      ack(conn, m);
    },

    'host.transfer': (conn, m) => {
      const { room, p } = joined(conn);
      room.transferHost(p, m.to);
      ack(conn, m);
    },

    'settings.update': (conn, m) => {
      const { room, p } = joined(conn);
      room.updateSettings(p, m);
      ack(conn, m);
    },
  };

  return function dispatch(conn, text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return conn.send({ t: 'error', code: 'bad_json', message: 'Malformed JSON' });
    }
    const reqId = ['string', 'number'].includes(typeof parsed?.id) ? parsed.id : undefined;

    const result = ClientMessage.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      return conn.send({
        t: 'error',
        id: reqId,
        code: 'bad_message',
        message: `${issue.path.join('.') || 'message'}: ${issue.message}`,
      });
    }

    const m = result.data;
    try {
      handlers[m.t](conn, m);
    } catch (err) {
      if (err instanceof AppError) {
        conn.send({ t: 'error', id: m.id, code: err.code, message: err.message });
      } else {
        log.error('handler failure', m.t, err);
        conn.send({ t: 'error', id: m.id, code: 'internal', message: 'Internal error' });
      }
    }
  };
}