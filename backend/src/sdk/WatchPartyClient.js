import WebSocket from 'ws';
import { DRIFT, computeCorrection, positionAt } from '../shared/sync.js';

const OPEN = 1;
const CLOCK_WINDOW = 12;
const CLOCK_REFRESH_MS = 10000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Headless client. Player contract:
 * { getPosition(): seconds, isPlaying(): boolean, play(), pause(), seek(seconds), setRate(rate) }
 */
export class WatchPartyClient {
  constructor({
    url,
    room,
    name,
    hostKey,
    player = null,
    now = Date.now,
    WebSocketImpl = WebSocket,
    autoReconnect = true,
    requestTimeoutMs = 5000,
  }) {
    Object.assign(this, { url, room, name, hostKey, player, now, autoReconnect, requestTimeoutMs });
    this.WS = WebSocketImpl;
    this.ws = null;
    this.identity = null;
    this.state = null;
    this.hostId = null;
    this.participants = new Map();
    this.playlist = { version: 0, currentId: null, items: [] };
    this.polls = new Map();
    this.chat = [];
    this.settings = null;

    this.offset = 0;
    this.rtt = Infinity;
    this.samples = [];
    this.pings = new Map();
    this.pingSeq = 0;
    this.pending = new Map();
    this.reqSeq = 0;
    this.listeners = new Map();
    this.timers = {};
    this.everJoined = false;
    this.reconnecting = false;
    this.closedByUser = false;
    this.attempt = 0;
  }

  // ---- events ------------------------------------------------------------

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event, data) {
    for (const fn of this.listeners.get(event) ?? []) fn(data);
  }

  waitFor(event, predicate = () => true, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for "${event}"`));
      }, timeoutMs);
      const off = this.on(event, (data) => {
        if (!predicate(data)) return;
        clearTimeout(timer);
        off();
        resolve(data);
      });
    });
  }

  // ---- lifecycle ---------------------------------------------------------

  serverNow() {
    return this.now() + this.offset;
  }

  get isHost() {
    return this.identity !== null && this.identity.id === this.hostId;
  }

  async connect() {
    this.closedByUser = false;
    await this.#open();
    this.#startLoops();
    return this.identity;
  }

  close() {
    this.closedByUser = true;
    this.#stopLoops();
    this.ws?.close();
  }

  async #open() {
    await this.#openSocket();
    await this.#syncClock(8);
    await this.#request('join', {
      room: this.room,
      name: this.name,
      hostKey: this.hostKey,
      participantId: this.identity?.id,
      token: this.identity?.token,
    });
  }

  #openSocket() {
    return new Promise((resolve, reject) => {
      const ws = new this.WS(this.url);
      this.ws = ws;
      ws.addEventListener('error', () => {});
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('socket error')), { once: true });
      ws.addEventListener('message', (e) => this.#onMessage(e.data));
      ws.addEventListener('close', () => this.#onClose(ws));
    });
  }

  #onClose(ws) {
    if (ws !== this.ws) return;
    this.#stopLoops();
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error('disconnected'));
    }
    this.pending.clear();
    this.pings.clear();
    this.emit('disconnected');
    if (this.closedByUser || !this.autoReconnect || !this.everJoined || this.reconnecting) return;
    this.#reconnectLoop();
  }

  async #reconnectLoop() {
    this.reconnecting = true;
    while (!this.closedByUser) {
      const delay = Math.min(10000, 200 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
      this.attempt++;
      this.emit('reconnecting', { attempt: this.attempt, delay });
      await sleep(delay);
      if (this.closedByUser) break;
      try {
        await this.#open();
        this.attempt = 0;
        this.reconnecting = false;
        this.#startLoops();
        this.emit('reconnected', this.identity);
        return;
      } catch (err) {
        try {
          this.ws?.close();
        } catch {
          /* socket already gone */
        }
        if (err.code === 'room_not_found' || err.code === 'bad_token') {
          this.emit('error', err);
          break;
        }
      }
    }
    this.reconnecting = false;
    this.emit('closed');
  }

  #startLoops() {
    this.#stopLoops();
    this.timers.check = setInterval(() => this.#reconcile(false), DRIFT.CHECK_INTERVAL_MS);
    this.timers.report = setInterval(() => this.#reportDrift(), DRIFT.REPORT_INTERVAL_MS);
    this.timers.clock = setInterval(() => this.#refreshClock(), CLOCK_REFRESH_MS);
  }

  #stopLoops() {
    for (const key of Object.keys(this.timers)) clearInterval(this.timers[key]);
    this.timers = {};
  }

  // ---- clock sync --------------------------------------------------------

  async #syncClock(rounds) {
    for (let i = 0; i < rounds; i++) await this.#pingOnce();
  }

  async #refreshClock() {
    try {
      await this.#pingOnce();
      await this.#pingOnce();
    } catch {
      /* a missed sample only delays the next refinement */
    }
  }

  #pingOnce() {
    return new Promise((resolve, reject) => {
      const c = ++this.pingSeq;
      const timer = setTimeout(() => {
        this.pings.delete(c);
        reject(new Error('ping timed out'));
      }, this.requestTimeoutMs);
      this.pings.set(c, { t0: this.now(), timer, resolve });
      this.ws.send(JSON.stringify({ t: 'ping', c }));
    });
  }

  // The lowest-RTT sample in a sliding window has the smallest asymmetry error.
  #onPong({ c, s }) {
    const ping = this.pings.get(c);
    if (!ping) return;
    this.pings.delete(c);
    clearTimeout(ping.timer);
    const t1 = this.now();
    const rtt = t1 - ping.t0;
    this.samples.push({ rtt, offset: s + rtt / 2 - t1 });
    if (this.samples.length > CLOCK_WINDOW) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.rtt = best.rtt;
    ping.resolve();
  }

  // ---- state and drift correction ---------------------------------------

  #onState(state, forceSeek) {
    if (this.state && state.version < this.state.version) return;
    this.state = state;
    this.#reconcile(forceSeek);
  }

  #reconcile(forceSeek) {
    const { player, state } = this;
    if (!player || !state) return;
    if (state.playing !== player.isPlaying()) {
      if (state.playing) player.play();
      else player.pause();
    }
    const expected = positionAt(state, this.serverNow());
    const driftMs = (player.getPosition() - expected) * 1000;

    if (!state.playing) {
      if (forceSeek || Math.abs(driftMs) > DRIFT.DEADBAND_MS) player.seek(expected);
      player.setRate(1);
      return;
    }

    const correction = computeCorrection(driftMs);
    if (forceSeek || correction.action === 'seek') {
      player.seek(expected);
      player.setRate(1);
    } else {
      player.setRate(correction.rate);
    }
    this.emit('drift', { driftMs, action: forceSeek ? 'seek' : correction.action });
  }

  #reportDrift() {
    if (!this.player || !this.state || this.ws?.readyState !== OPEN) return;
    this.ws.send(
      JSON.stringify({
        t: 'drift',
        position: this.player.getPosition(),
        serverTime: this.serverNow(),
        version: this.state.version,
      }),
    );
  }

  // ---- messages ----------------------------------------------------------

  #onMessage(data) {
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }

    switch (m.t) {
      case 'pong':
        this.#onPong(m);
        return;
      case 'ack': {
        const req = this.pending.get(m.id);
        if (!req) return;
        this.pending.delete(m.id);
        clearTimeout(req.timer);
        req.resolve(m);
        return;
      }
      case 'error': {
        const req = this.pending.get(m.id);
        if (req) {
          this.pending.delete(m.id);
          clearTimeout(req.timer);
          const err = new Error(m.message);
          err.code = m.code;
          req.reject(err);
        } else {
          this.emit('error', Object.assign(new Error(m.message), { code: m.code }));
        }
        return;
      }
      case 'joined':
        this.everJoined = true;
        this.identity = m.you;
        this.hostId = m.hostId;
        this.settings = m.room;
        this.participants = new Map(m.participants.map((p) => [p.id, p]));
        this.playlist = m.playlist;
        this.polls = new Map(m.polls.map((p) => [p.id, p]));
        this.chat = m.chat;
        this.state = null;
        this.#onState(m.state, true);
        break;
      case 'state':
        this.#onState(m.state, m.action === 'seek' || m.action === 'media');
        break;
      case 'sync':
        this.#onState(m.state, false);
        break;
      case 'participant':
        if (m.event === 'leave') this.participants.delete(m.participant.id);
        else this.participants.set(m.participant.id, m.participant);
        break;
      case 'host':
        this.hostId = m.hostId;
        break;
      case 'chat':
        this.chat.push(m.message);
        break;
      case 'playlist':
        this.playlist = m.playlist;
        break;
      case 'poll':
        this.polls.set(m.poll.id, m.poll);
        break;
      case 'settings':
        this.settings = { ...this.settings, ...m.settings };
        break;
      default:
        break;
    }
    this.emit(m.t, m);
  }

  #request(t, payload = {}) {
    if (this.ws?.readyState !== OPEN) return Promise.reject(new Error('not connected'));
    const id = ++this.reqSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${t} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ t, id, ...payload }));
    });
  }

  // ---- public API --------------------------------------------------------

  control(action, position) {
    return this.#request('control', { action, position });
  }

  play() {
    return this.control('play', this.player?.getPosition());
  }

  pause() {
    return this.control('pause', this.player?.getPosition());
  }

  seek(position) {
    return this.control('seek', position);
  }

  sendChat(text) {
    return this.#request('chat', { text });
  }

  react(emoji) {
    return this.#request('reaction', { emoji });
  }

  playlistAdd(item) {
    return this.#request('playlist.add', item);
  }

  playlistRemove(itemId) {
    return this.#request('playlist.remove', { itemId });
  }

  playlistMove(itemId, index) {
    return this.#request('playlist.move', { itemId, index });
  }

  playlistPlay(itemId) {
    return this.#request('playlist.play', { itemId });
  }

  playlistNext() {
    return this.#request('playlist.next');
  }

  ended(itemId) {
    return this.#request('ended', { itemId });
  }

  pollCreate({ question, options, durationSec }) {
    return this.#request('poll.create', { question, options, durationSec });
  }

  pollVote(pollId, option) {
    return this.#request('poll.vote', { pollId, option });
  }

  pollClose(pollId) {
    return this.#request('poll.close', { pollId });
  }

  transferHost(to) {
    return this.#request('host.transfer', { to });
  }

  updateSettings(settings) {
    return this.#request('settings.update', settings);
  }

  async leave() {
    await this.#request('leave');
    this.close();
  }
}