import { positionAt } from '../shared/sync.js';

const validPosition = (v) => (Number.isFinite(v) && v >= 0 ? v : null);

export class PlaybackClock {
  #s;

  constructor(now = Date.now) {
    this.now = now;
    this.#s = { mediaId: null, playing: false, position: 0, anchor: now(), version: 0 };
  }

  get state() {
    return this.#s;
  }

  positionAt(t = this.now()) {
    return positionAt(this.#s, t);
  }

  snapshot() {
    return { ...this.#s, serverTime: this.now() };
  }

  #commit(t, patch) {
    this.#s = { ...this.#s, ...patch, anchor: t, version: this.#s.version + 1 };
    return { ...this.#s, serverTime: t };
  }

  // play/pause are idempotent: they return null when the state already matches,
  // so concurrent duplicate requests from several users collapse into one transition.
  play(position) {
    if (this.#s.playing) return null;
    const t = this.now();
    return this.#commit(t, { playing: true, position: validPosition(position) ?? this.positionAt(t) });
  }

  pause(position) {
    if (!this.#s.playing) return null;
    const t = this.now();
    return this.#commit(t, { playing: false, position: validPosition(position) ?? this.positionAt(t) });
  }

  seek(position) {
    const t = this.now();
    return this.#commit(t, { position: validPosition(position) ?? 0 });
  }

  setMedia(mediaId) {
    return this.#commit(this.now(), { mediaId, playing: false, position: 0 });
  }
}