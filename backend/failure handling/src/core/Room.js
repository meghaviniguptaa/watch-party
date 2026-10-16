import { PlaybackClock } from './PlaybackClock.js';
import { Playlist } from './Playlist.js';
import { PollManager } from './PollManager.js';
import { Participant } from './Participant.js';
import { AppError } from '../util/errors.js';
import { shortId, newToken } from '../util/ids.js';
import { metrics } from '../metrics.js';
import { DRIFT, positionAt } from '../shared/sync.js';

const CHAT_HISTORY = 100;
const forbidden = (msg) => new AppError('forbidden', msg, 403);

export class Room {
  #hostTimer = null;
  #syncTimer;

  constructor({ code, name, controlMode = 'everyone', hostKey, opts }) {
    this.code = code;
    this.name = name;
    this.controlMode = controlMode;
    this.hostKey = hostKey;
    this.hostKeyUsed = false;
    this.hostId = null;
    this.opts = opts;
    this.clock = new PlaybackClock();
    this.playlist = new Playlist();
    this.polls = new PollManager({ onClose: (poll) => this.broadcast({ t: 'poll', poll }) });
    this.participants = new Map();
    this.chat = [];
    this.chatSeq = 0;
    this.emptySince = Date.now();
    this.#syncTimer = setInterval(() => this.#broadcastSync(), opts.syncBroadcastMs);
    this.#syncTimer.unref();
  }

  connectedCount() {
    let n = 0;
    for (const p of this.participants.values()) if (p.connected) n++;
    return n;
  }

  summary() {
    const current = this.playlist.get(this.playlist.currentId);
    return {
      code: this.code,
      name: this.name,
      controlMode: this.controlMode,
      participants: this.participants.size,
      connected: this.connectedCount(),
      nowPlaying: current?.title ?? null,
    };
  }

  // ---- membership --------------------------------------------------------

  join(conn, { name, participantId, token, hostKey }) {
    let p = participantId ? this.participants.get(participantId) : undefined;
    const resumed = Boolean(p);

    if (p) {
      if (p.token !== token) throw new AppError('bad_token', 'Invalid participant token', 403);
      this.#rebind(p, conn);
    } else {
      if (this.participants.size >= this.opts.maxRoomSize) throw new AppError('room_full', 'Room is full', 403);
      p = new Participant({ id: shortId(), name, token: newToken(), joinedAt: Date.now() });
      p.conn = conn;
      this.participants.set(p.id, p);
    }

    conn.room = this;
    conn.participant = p;
    this.emptySince = null;

    if (hostKey && !this.hostKeyUsed && hostKey === this.hostKey) {
      this.hostKeyUsed = true;
      this.#setHost(p.id, 'creator', p.id);
    } else if (!this.hostId) {
      this.#setHost(p.id, 'first_joiner', p.id);
    }

    conn.send({
      t: 'joined',
      resumed,
      you: { id: p.id, token: p.token, name: p.name },
      ...this.#snapshot(),
    });
    this.broadcast({ t: 'participant', event: resumed ? 'online' : 'join', participant: p.toJSON() }, p.id);
    return p;
  }

  #rebind(p, conn) {
    clearTimeout(p.graceTimer);
    p.graceTimer = null;
    p.offlineSince = null;
    const old = p.conn;
    p.conn = conn;
    if (old && old !== conn) {
      old.room = null;
      old.participant = null;
      old.close(4000, 'replaced by a newer connection');
    }
    if (p.id === this.hostId) this.#clearHostTimer();
  }

  detach(conn) {
    const p = conn.participant;
    if (!p || p.conn !== conn) return;
    p.conn = null;
    p.offlineSince = Date.now();
    conn.room = null;
    conn.participant = null;
    this.broadcast({ t: 'participant', event: 'offline', participant: p.toJSON() });
    p.graceTimer = setTimeout(() => this.removeParticipant(p.id, 'timeout'), this.opts.participantGraceMs);
    p.graceTimer.unref();
    if (p.id === this.hostId) {
      this.#clearHostTimer();
      this.#hostTimer = setTimeout(() => this.#autoTransferHost(), this.opts.hostGraceMs);
      this.#hostTimer.unref();
    }
    this.#markEmpty();
  }

  removeParticipant(id, reason) {
    const p = this.participants.get(id);
    if (!p) return;
    clearTimeout(p.graceTimer);
    this.participants.delete(id);
    if (p.conn) {
      p.conn.room = null;
      p.conn.participant = null;
    }
    this.broadcast({ t: 'participant', event: 'leave', participant: p.toJSON(), reason });
    if (id === this.hostId) {
      this.hostId = null;
      this.#clearHostTimer();
      const next = this.#successor(id, true) ?? this.#successor(id, false);
      if (next) this.#setHost(next.id, 'host_left');
    }
    this.#markEmpty();
  }

  #markEmpty() {
    if (this.connectedCount() === 0) this.emptySince ??= Date.now();
  }

  // ---- host --------------------------------------------------------------

  #setHost(id, reason, exceptId) {
    if (this.hostId === id) return;
    this.hostId = id;
    this.#clearHostTimer();
    this.broadcast({ t: 'host', hostId: id, reason }, exceptId);
  }

  #clearHostTimer() {
    clearTimeout(this.#hostTimer);
    this.#hostTimer = null;
  }

  #successor(excludeId, connectedOnly) {
    const pool = [...this.participants.values()].filter(
      (p) => p.id !== excludeId && (!connectedOnly || p.connected),
    );
    pool.sort((a, b) => a.joinedAt - b.joinedAt);
    return pool[0] ?? null;
  }

  #autoTransferHost() {
    this.#hostTimer = null;
    if (this.participants.get(this.hostId)?.connected) return;
    const next = this.#successor(this.hostId, true);
    if (next) this.#setHost(next.id, 'host_offline');
  }

  transferHost(p, toId) {
    if (p.id !== this.hostId) throw forbidden('Only the host can transfer host');
    const target = this.participants.get(toId);
    if (!target?.connected) throw new AppError('not_found', 'Participant unavailable', 404);
    this.#setHost(toId, 'transfer');
  }

  updateSettings(p, { controlMode }) {
    if (p.id !== this.hostId) throw forbidden('Only the host can change settings');
    this.controlMode = controlMode;
    this.broadcast({ t: 'settings', settings: { controlMode } });
  }

  #authorize(p) {
    if (this.controlMode === 'host' && p.id !== this.hostId) {
      throw forbidden('Only the host can control playback');
    }
  }

  // ---- playback ----------------------------------------------------------

  control(p, action, position) {
    this.#authorize(p);
    const started = performance.now();
    const snap = this.clock[action](position);
    if (!snap) return { applied: false, state: this.clock.snapshot() };
    this.broadcast({ t: 'state', state: snap, by: p.id, action });
    metrics.series('control.process_ms').record(performance.now() - started);
    return { applied: true, state: snap };
  }

  reportDrift(p, { position, serverTime, version }) {
    const s = this.clock.state;
    if (version !== s.version) return null;
    const driftMs = (position - positionAt(s, serverTime)) * 1000;
    metrics.series('drift.reported_ms').record(Math.abs(driftMs));
    const now = Date.now();
    if (Math.abs(driftMs) > DRIFT.HARD_SEEK_MS && now - p.lastResyncAt > DRIFT.SERVER_RESYNC_COOLDOWN_MS) {
      p.lastResyncAt = now;
      p.conn?.send({ t: 'sync', state: this.clock.snapshot(), reason: 'drift' });
      metrics.count('drift.server_resync');
    }
    return driftMs;
  }

  #broadcastSync() {
    if (this.connectedCount() > 0) this.broadcast({ t: 'sync', state: this.clock.snapshot() });
  }

  // ---- playlist ----------------------------------------------------------

  #playItem(item) {
    this.playlist.setCurrent(item?.id ?? null);
    const state = this.clock.setMedia(item?.id ?? null);
    this.#broadcastPlaylist();
    this.broadcast({ t: 'state', state, action: 'media' });
  }

  #broadcastPlaylist() {
    this.broadcast({ t: 'playlist', playlist: this.playlist.toJSON() });
  }

  playlistAdd(p, data, playNow = false) {
    if (playNow) this.#authorize(p);
    const item = this.playlist.add(data, p.id);
    if (playNow) this.#playItem(item);
    else this.#broadcastPlaylist();
    return item;
  }

  playlistRemove(p, itemId) {
    const item = this.playlist.get(itemId);
    if (!item) throw new AppError('not_found', 'Playlist item not found', 404);
    if (item.addedBy !== p.id && p.id !== this.hostId) throw forbidden('Only the host or the adder can remove this');
    const { wasCurrent, successor } = this.playlist.remove(itemId);
    if (wasCurrent) this.#playItem(successor);
    else this.#broadcastPlaylist();
  }

  playlistMove(_p, itemId, index) {
    this.playlist.move(itemId, index);
    this.#broadcastPlaylist();
  }

  playlistPlay(p, itemId) {
    this.#authorize(p);
    const item = this.playlist.get(itemId);
    if (!item) throw new AppError('not_found', 'Playlist item not found', 404);
    this.#playItem(item);
  }

  playlistNext(p) {
    this.#authorize(p);
    const next = this.playlist.next();
    if (!next) throw new AppError('end_of_playlist', 'No next item');
    this.#playItem(next);
  }

  // Every client reports "ended"; only the first report for the current item advances the queue.
  mediaEnded(_p, itemId) {
    if (itemId !== this.playlist.currentId) return false;
    const next = this.playlist.next();
    if (next) {
      this.#playItem(next);
    } else {
      const snap = this.clock.pause();
      if (snap) this.broadcast({ t: 'state', state: snap, action: 'pause' });
    }
    return true;
  }

  // ---- chat, reactions, polls --------------------------------------------

  chatSend(p, text) {
    if (!p.chatBucket.take()) throw new AppError('rate_limited', 'You are sending messages too fast');
    const message = {
      id: shortId(),
      seq: ++this.chatSeq,
      from: { id: p.id, name: p.name },
      text,
      ts: Date.now(),
    };
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.broadcast({ t: 'chat', message });
  }

  react(p, emoji) {
    if (!p.reactionBucket.take()) throw new AppError('rate_limited', 'Too many reactions');
    this.broadcast({ t: 'reaction', from: p.id, name: p.name, emoji, ts: Date.now() });
  }

  pollCreate(p, { question, options, durationSec }) {
    const poll = this.polls.create({ question, options, durationSec, by: p.id });
    this.broadcast({ t: 'poll', poll });
    return poll;
  }

  pollVote(p, pollId, option) {
    const poll = this.polls.vote(pollId, p.id, option);
    const connectedIds = [...this.participants.values()].filter((x) => x.connected).map((x) => x.id);
    if (this.polls.allVoted(pollId, connectedIds)) this.polls.close(pollId);
    else this.broadcast({ t: 'poll', poll });
  }

  pollClose(p, pollId) {
    const poll = this.polls.get(pollId);
    if (poll.createdBy !== p.id && p.id !== this.hostId) throw forbidden('Only the host or the creator can close this poll');
    if (!this.polls.close(pollId)) throw new AppError('poll_closed', 'Poll is already closed');
  }

  // ---- transport ---------------------------------------------------------

  #snapshot() {
    return {
      room: { code: this.code, name: this.name, controlMode: this.controlMode },
      hostId: this.hostId,
      state: this.clock.snapshot(),
      participants: [...this.participants.values()].map((p) => p.toJSON()),
      playlist: this.playlist.toJSON(),
      polls: this.polls.toJSON(),
      chat: this.chat,
    };
  }

  broadcast(msg, exceptId) {
    const data = JSON.stringify(msg);
    for (const p of this.participants.values()) {
      if (p.conn && p.id !== exceptId) p.conn.sendRaw(data);
    }
  }

  dispose() {
    clearInterval(this.#syncTimer);
    this.#clearHostTimer();
    this.polls.dispose();
    for (const p of this.participants.values()) {
      clearTimeout(p.graceTimer);
      const conn = p.conn;
      if (conn) {
        conn.room = null;
        conn.participant = null;
        conn.close(1001, 'room closed');
      }
    }
    this.participants.clear();
  }
}