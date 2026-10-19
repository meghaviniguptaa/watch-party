// Control-propagation latency: time from a client sending play/pause/seek until each client in the room has
// received the resulting `state` message. All timestamps come from one process (performance.now()), so there is
// no clock-offset error. Requirement: p95 <= 250 ms with >= 10 clients.
import { WebSocket } from 'ws';
import { startServer, createRoom, metrics, stats, f, sleep } from './lib.js';

const SIZES = (process.env.SIZES || '12,25,50').split(',').map(Number);
const OPS = Number(process.env.OPS || 300);
const ROUNDS = Number(process.env.ROUNDS || 100);
const LIMIT_MS = 250;

async function connect(base, code, name, hostKey) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  const c = { ws, name, seen: new Map(), latest: null, acks: new Map(), listeners: [] };
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const joined = new Promise((res) => { c.onJoined = res; });
  ws.on('message', (raw) => {
    const now = performance.now();
    const m = JSON.parse(raw);
    if (m.t === 'joined') { c.latest = m.state; c.onJoined(m); }
    else if (m.t === 'state') { c.seen.set(m.state.version, now); c.latest = m.state; c.listeners.forEach((fn) => fn()); }
    else if (m.t === 'ack') c.acks.get(m.id)?.(now, m);
  });
  ws.send(JSON.stringify({ t: 'join', id: 'j', room: code, name, hostKey }));
  await joined;
  c.send = (action, position) => {
    const id = `${Math.random()}`;
    const t0 = performance.now();
    const ack = new Promise((res) => c.acks.set(id, (t, m) => res({ rtt: t - t0, applied: m.applied })));
    ws.send(JSON.stringify({ t: 'control', id, action, position }));
    return { t0, ack };
  };
  return c;
}

const allHave = (clients, v) => clients.every((c) => c.seen.has(v));
const waitAll = (clients, v, ms = 2000) =>
  new Promise((resolve) => {
    if (allHave(clients, v)) return resolve(true);
    const timer = setTimeout(() => { clients.forEach((c) => (c.listeners = [])); resolve(false); }, ms);
    const check = () => { if (allHave(clients, v)) { clearTimeout(timer); clients.forEach((c) => (c.listeners = [])); resolve(true); } };
    clients.forEach((c) => c.listeners.push(check));
  });

async function runSize(base, n) {
  const room = await createRoom(base);
  const clients = [await connect(base, room.code, 'host', room.hostKey)];
  for (let i = 1; i < n; i++) clients.push(await connect(base, room.code, `u${i}`));
  const host = clients[0];
  await sleep(200);

  // Phase A: one controller, many receivers.
  const cycle = ['play', 'seek', 'seek', 'pause'];
  const lat = [], acks = [];
  let lost = 0, version = host.latest.version;
  for (let i = 0; i < OPS; i++) {
    const action = cycle[i % 4];
    const { t0, ack } = host.send(action, action === 'seek' ? (i % 50) + 1 : 0);
    version++;
    const ok = await waitAll(clients, version);
    if (!ok) { lost++; version = Math.max(...clients.map((c) => c.latest.version)); }
    for (const c of clients) if (c.seen.has(version)) lat.push(c.seen.get(version) - t0);
    acks.push((await ack).rtt);
    await sleep(40); // stay under the per-connection limit (30 msgs/s refill) so we measure propagation, not the rate limiter
  }

  // Phase B: every client sends a control message in the same tick, then we check everybody converged.
  let converged = 0, applied = 0, collapsed = 0;
  const actions = ['play', 'pause', 'seek'];
  for (let r = 0; r < ROUNDS; r++) {
    const sent = clients.map((c, i) => c.send(actions[(r + i) % 3], Math.random() * 100));
    const results = await Promise.all(sent.map((s) => s.ack));
    results.forEach((x) => (x.applied ? applied++ : collapsed++));
    await sleep(120);
    const v = clients.map((c) => c.latest);
    if (v.every((s) => s.version === v[0].version && s.playing === v[0].playing && s.position === v[0].position)) converged++;
  }

  const server = (await metrics(base)).series['control.process_ms'];
  clients.forEach((c) => c.ws.close());
  return { n, ops: OPS, lost, prop: stats(lat), ack: stats(acks), rounds: ROUNDS, converged, applied, collapsed, server };
}

const server = await startServer();
console.log(`# control-propagation latency  (node ${process.version}, ${OPS} ops/size, ${ROUNDS} contention rounds/size)`);
let fail = false;
for (const n of SIZES) {
  const r = await runSize(server.base, n);
  const pass = r.prop.p95 <= LIMIT_MS && r.lost === 0 && r.converged === r.rounds;
  fail ||= !pass;
  console.log(`\n## ${n} clients in one room   ${pass ? 'PASS' : 'FAIL'}`);
  console.log(`propagation (send -> every client received), ms over ${r.prop.n} samples:`);
  console.log(`  min ${f(r.prop.min, 2)}  mean ${f(r.prop.mean, 2)}  p50 ${f(r.prop.p50, 2)}  p95 ${f(r.prop.p95, 2)}  p99 ${f(r.prop.p99, 2)}  max ${f(r.prop.max, 2)}   (limit p95 <= ${LIMIT_MS})`);
  console.log(`  controller ack round-trip: p50 ${f(r.ack.p50, 2)}  p95 ${f(r.ack.p95, 2)}   lost broadcasts: ${r.lost}`);
  console.log(`  server-side processing (control -> broadcast queued): p50 ${f(r.server?.p50, 3)}  p95 ${f(r.server?.p95, 3)}  max ${f(r.server?.max, 3)}`);
  console.log(`  ${n} simultaneous senders x ${r.rounds} rounds: converged ${r.converged}/${r.rounds}; applied ${r.applied}, collapsed-as-duplicate ${r.collapsed}`);
}
await server.stop();
process.exit(fail ? 1 : 0);
