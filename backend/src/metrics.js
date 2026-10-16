export class Series {
  constructor(capacity = 10000) {
    this.capacity = capacity;
    this.buf = [];
    this.next = 0;
    this.total = 0;
  }

  record(value) {
    if (this.buf.length < this.capacity) this.buf.push(value);
    else this.buf[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    this.total++;
  }

  summary() {
    const n = this.buf.length;
    if (!n) return { count: 0 };
    const sorted = [...this.buf].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      count: this.total,
      samples: n,
      min: sorted[0],
      mean: sum / n,
      p50: q(50),
      p95: q(95),
      p99: q(99),
      max: sorted[n - 1],
    };
  }
}

export class Metrics {
  #series = new Map();
  #counters = new Map();

  series(name) {
    if (!this.#series.has(name)) this.#series.set(name, new Series());
    return this.#series.get(name);
  }

  count(name, n = 1) {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + n);
  }

  snapshot() {
    return {
      series: Object.fromEntries([...this.#series].map(([k, v]) => [k, v.summary()])),
      counters: Object.fromEntries(this.#counters),
    };
  }

  reset() {
    this.#series.clear();
    this.#counters.clear();
  }
}

export const metrics = new Metrics();