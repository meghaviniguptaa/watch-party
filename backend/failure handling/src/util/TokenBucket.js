export class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSec / 1000;
    this.tokens = capacity;
    this.last = Date.now();
  }

  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}