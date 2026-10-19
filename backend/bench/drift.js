// Playback drift: how far each client's player is from the room's authoritative position, and how fast it recovers.
// Players run on deliberately imperfect clocks (±2 % speed error) and are knocked off position on purpose.
import { WatchPartyClient } from '../src/sdk/WatchPartyClient.js';
import { SimulatedPlayer } from '../src/sdk/SimulatedPlayer.js';
import { positionAt } from '../src/shared/sync.js';
import { startServer, createRoom, stats, f, sleep } from './lib.js';

const CLIENTS = Number(process.env.CLIENTS || 12);
const QUIET_S = Number(process.env.QUIET_S || 15);
const KICK_S = Number(process.env.KICK_S || 30);
const LIMIT_MS = 500;
const rnd = (a, b) => a + Math.random() * (b - a);

// A player whose clock runs errPct % fast or slow, like a real decoder that does not keep perfect time.
const skewedPlayer = (errPct) => {
  const t0 = Date.now();
  return new SimulatedPlayer({ now: () => t0 + (Date.now() - t0) * (1 + errPct / 100) });
};

async function addClient(base, code, name, hostKey) {
  const player = skewedPlayer(rnd(-2, 2));
  const c = new WatchPartyClient({ url: base.replace(/^http/, 'ws') + '/ws', room: code, name, hostKey, player });
  await c.connect();
  return { c, player, name };
}
// Use the client's clock-synced server time (not this machine's clock) so results stay valid when the server is on another device.
const driftMs = (host, m) => (m.player.getPosition() - positionAt(host.c.state, host.c.serverNow())) * 1000;
const line = (label, s, unit = 'ms') =>
  console.log(`  ${label.padEnd(34)} n=${s.n}  p50 ${f(s.p50, 1)}  p95 ${f(s.p95, 1)}  p99 ${f(s.p99, 1)}  max ${f(s.max, 1)} ${unit}`);

const server = await startServer();
const room = await createRoom(server.base);
const host = await addClient(server.base, room.code, 'host', room.hostKey);
const members = [host];
for (let i = 1; i < CLIENTS; i++) members.push(await addClient(server.base, room.code, `u${i}`));
await host.c.play();
await sleep(2000);
const checks = [];
console.log(`# playback drift  (node ${process.version}, ${CLIENTS} clients, player clock error uniform in ±2 %, requirement <= ${LIMIT_MS} ms)`);

// A. Quiet: only natural clock error, corrected by the SDK's rate nudging.
const quiet = [];
for (let t = 0; t < QUIET_S * 10; t++) { for (const m of members) quiet.push(Math.abs(driftMs(host, m))); await sleep(100); }
const q = stats(quiet);
console.log('\n## A. steady state (no disturbance)');
line('|drift| over all clients', q);
checks.push(['A  steady-state p99 <= 500 ms', q.p99 <= LIMIT_MS]);

// B. Disturbed: every 1.5 s a random client's player is thrown 0.3-1.5 s off (stall / buffering jump).
const kicks = [], noisy = [];
let nextKick = 0;
for (let t = 0; t < KICK_S * 10; t++) {
  if (t >= nextKick) {
    const m = members[1 + Math.floor(Math.random() * (CLIENTS - 1))];
    m.player.injectDrift((Math.random() < 0.5 ? -1 : 1) * rnd(300, 1500));
    kicks.push({ m, at: performance.now(), recoveredAfter: null });
    nextKick = t + 15;
  }
  for (const k of kicks) if (k.recoveredAfter === null && Math.abs(driftMs(host, k.m)) <= LIMIT_MS) k.recoveredAfter = performance.now() - k.at;
  for (const m of members) noisy.push(Math.abs(driftMs(host, m)));
  await sleep(100);
}
await sleep(1500);
for (const k of kicks) if (k.recoveredAfter === null && Math.abs(driftMs(host, k.m)) <= LIMIT_MS) k.recoveredAfter = performance.now() - k.at;
const rec = stats(kicks.filter((k) => k.recoveredAfter !== null).map((k) => k.recoveredAfter));
const unrecovered = kicks.filter((k) => k.recoveredAfter === null).length;
console.log(`\n## B. forced disturbances (${kicks.length} jumps of 0.3-1.5 s)`);
line('|drift| over all clients (incl. jumps)', stats(noisy));
line('time to get back within 500 ms', rec);
console.log(`  jumps never corrected: ${unrecovered}`);
checks.push(['B  every jump back within 500 ms, max <= 1500 ms', unrecovered === 0 && rec.max <= 1500]);

// C. Late joiners while the room is already playing.
const joinTimes = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  const m = await addClient(server.base, room.code, `late${i}`);
  let ms = null;
  while (performance.now() - t0 < 4000) { if (Math.abs(driftMs(host, m)) <= LIMIT_MS) { ms = performance.now() - t0; break; } await sleep(10); }
  joinTimes.push(ms ?? 4000);
  members.push(m);
}
console.log('\n## C. late joins (room already playing; time from connect start to within 500 ms)');
line('5 late joiners', stats(joinTimes));
checks.push(['C  late joiners in sync <= 1000 ms', Math.max(...joinTimes) <= 1000]);

// D. Reconnect: kill 3 sockets, host seeks while they are offline, they must resume and re-align.
const victims = members.slice(1, 4), ids = victims.map((m) => m.c.identity.id);
const t0 = performance.now();
victims.forEach((m) => m.c.ws.terminate());
await sleep(100);
await host.c.seek(300);
const back = [];
for (const m of victims) {
  let ms = null;
  while (performance.now() - t0 < 15000) {
    if (!m.c.reconnecting && m.c.ws?.readyState === 1 && Math.abs(driftMs(host, m)) <= LIMIT_MS) { ms = performance.now() - t0; break; }
    await sleep(20);
  }
  back.push(ms ?? 15000);
}
const sameIdentity = victims.every((m, i) => m.c.identity.id === ids[i]);
console.log('\n## D. reconnect (3 sockets killed, host seeks to 300 s while they are offline)');
line('time until reconnected + in sync', stats(back));
console.log(`  resumed with same participant id: ${sameIdentity}`);
checks.push(['D  reconnect + resync <= 5000 ms, identity kept', Math.max(...back) <= 5000 && sameIdentity]);

console.log('\n## summary');
for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
members.forEach((m) => m.c.close());
await server.stop();
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
