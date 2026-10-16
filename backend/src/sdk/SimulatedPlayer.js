export class SimulatedPlayer {
  #pos;
  #playing = false;
  #rate = 1;
  #last;

  constructor({ position = 0, now = Date.now } = {}) {
    this.now = now;
    this.#pos = position;
    this.#last = now();
  }

  #advance() {
    const t = this.now();
    if (this.#playing) this.#pos += ((t - this.#last) / 1000) * this.#rate;
    this.#last = t;
  }

  getPosition() {
    this.#advance();
    return this.#pos;
  }

  isPlaying() {
    return this.#playing;
  }

  get rate() {
    return this.#rate;
  }

  seek(seconds) {
    this.#advance();
    this.#pos = seconds;
  }

  play() {
    this.#advance();
    this.#playing = true;
  }

  pause() {
    this.#advance();
    this.#playing = false;
  }

  setRate(rate) {
    this.#advance();
    this.#rate = rate;
  }

  injectDrift(ms) {
    this.#advance();
    this.#pos += ms / 1000;
  }
}