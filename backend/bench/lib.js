import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Percentile by nearest rank. Same definition the server uses in metrics.js.
export function stats(values) {
  if (!values.length) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return { n: s.length, min: s[0], mean: s.reduce((a, b) => a + b, 0) / s.length, p50: q(50), p95: q(95), p99: q(99), max: s[s.length - 1] };
}
export const f = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '-');

// Starts the server in its OWN process so benchmark clients and server do not share an event loop.
// Set BENCH_URL=http://<lan-ip>:8080 to target an already-running server (e.g. on another machine).
export async function startServer() {
  if (process.env.BENCH_URL) return { base: process.env.BENCH_URL.replace(/\/$/, ''), stop: async () => {} };
  const port = Number(process.env.BENCH_PORT || 18080);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  return { base, stop: async () => { child.kill('SIGTERM'); await sleep(100); } };
}

export async function createRoom(base, body = {}) {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`create room failed: ${res.status}`);
  return res.json();
}
export const metrics = async (base) => (await fetch(`${base}/api/metrics`)).json();
