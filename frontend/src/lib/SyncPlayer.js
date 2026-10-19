import { SimulatedPlayer } from './SimulatedPlayer.js';

// Implements the SDK's player contract. Drives a real <video> when one is attached,
// otherwise a virtual timeline, so titles without a video URL still stay in sync.
export class SyncPlayer {
  constructor() {
    this.video = null;
    this.sim = new SimulatedPlayer();
    this.blocked = false;
    this.onBlockedChange = () => {};
  }

  attach(el) { this.video = el; }
  reset() { this.sim = new SimulatedPlayer(); }
  #block(v) { if (this.blocked !== v) { this.blocked = v; this.onBlockedChange(v); } }

  // True while a seek is still loading. Correcting drift during that window just restarts the download.
  isSeeking() { return Boolean(this.video && this.video.seeking); }
  getPosition() { return this.video ? this.video.currentTime : this.sim.getPosition(); }
  isPlaying() { return this.video ? !this.video.paused && !this.video.ended : this.sim.isPlaying(); }

  play() {
    if (!this.video) return this.sim.play();
    if (this.video.ended) return;
    this.video.play().then(() => this.#block(false)).catch(() => this.#block(true)); // autoplay policy
  }
  pause() { this.video ? this.video.pause() : this.sim.pause(); }
  seek(s) { if (this.video) this.video.currentTime = s; else this.sim.seek(s); }
  setRate(r) {
    if (this.video) { if (Math.abs(this.video.playbackRate - r) > 0.001) this.video.playbackRate = r; }
    else this.sim.setRate(r);
  }
}
