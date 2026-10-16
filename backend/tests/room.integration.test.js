import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer } from '../src/createServer.js';
import { WatchPartyClient } from '../src/sdk/WatchPartyClient.js';
import { SimulatedPlayer } from '../src/sdk/SimulatedPlayer.js';
import { positionAt } from '../src/shared/sync.js';

let server;
let base;
let wsUrl;
const clients = [];

before(async () => {
  server = createServer({
    port: 0,
    host: '127.0.0.1',
    syncBroadcastMs: 1000,
    participantGraceMs: 600,
    hostGraceMs: 150,
  });
  const { port } = await server.listen();
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  for (const c of clients) c.close();
  await server.close();
});

const post = async (path, body = {}) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const newRoom = async (body) => (await post('/api/rooms', body)).body;

const join = async (room, name, extra = {}) => {
  const c = new WatchPartyClient({ url: wsUrl, room: room.code, name, ...extra });
  clients.push(c);
  await c.connect();
  return c;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('create room over HTTP, resolve it by code, join through the lowercase code', async () => {
  const room = await newRoom({ name: 'Friday night' });
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.ok(room.inviteUrl.endsWith(`/join/${room.code}`));

  const info = await (await fetch(`${base}/api/rooms/${room.code.toLowerCase()}`)).json();
  assert.equal(info.name, 'Friday night');

  const c = new WatchPartyClient({ url: wsUrl, room: room.code.toLowerCase(), name: 'Asha' });
  clients.push(c);
  await c.connect();
  assert.equal(c.participants.size, 1);
});

test('unknown room and invalid body are rejected', async () => {
  const res = await fetch(`${base}/api/rooms/NOPE00`);
  assert.equal(res.status, 404);
  assert.equal((await post('/api/rooms', { controlMode: 'bogus' })).status, 400);

  const c = new WatchPartyClient({ url: wsUrl, room: 'NOPE00', name: 'X' });
  clients.push(c);
  await assert.rejects(c.connect(), { code: 'room_not_found' });
});

test('creator gets host via hostKey even when someone else joins first', async () => {
  const room = await newRoom();
  const guest = await join(room, 'Guest');
  assert.equal(guest.isHost, true);
  const handover = guest.waitFor('host', (m) => m.reason === 'creator');
  const creator = await join(room, 'Creator', { hostKey: room.hostKey });
  assert.equal(creator.hostId, creator.identity.id);
  assert.equal((await handover).hostId, creator.identity.id);
  assert.equal(guest.isHost, false);
});

test('play, pause and seek reach 12 participants', async () => {
  const room = await newRoom();
  const all = [await join(room, 'host', { hostKey: room.hostKey })];
  for (let i = 1; i < 12; i++) all.push(await join(room, `user${i}`));
  const [host] = all;

  const expectAll = async (action, predicate) => {
    const waits = all.map((c) => c.waitFor('state', (m) => m.action === action && predicate(m.state)));
    const ack = await all[3][action === 'seek' ? 'seek' : action](action === 'seek' ? 77 : undefined);
    assert.equal(ack.applied, true);
    const states = await Promise.all(waits);
    assert.equal(new Set(states.map((s) => s.state.version)).size, 1);
  };

  await expectAll('play', (s) => s.playing);
  await expectAll('seek', (s) => s.position === 77);
  await expectAll('pause', (s) => !s.playing);
  assert.ok(Math.abs(host.state.position - 77) < 0.5);
});

test('concurrent identical pauses collapse into exactly one transition', async () => {
  const room = await newRoom();
  const [a, b, c] = [await join(room, 'a'), await join(room, 'b'), await join(room, 'c')];
  await a.play();
  await sleep(50);
  const results = await Promise.all([a.pause(), b.pause(), c.pause()]);
  assert.equal(results.filter((r) => r.applied).length, 1);
});

test('concurrent conflicting seeks leave every client on the same final state', async () => {
  const room = await newRoom();
  const all = [];
  for (let i = 0; i < 10; i++) all.push(await join(room, `u${i}`));
  await Promise.all(all.map((c, i) => c.seek(100 + i)));
  await sleep(150);
  const authoritative = server.rooms.get(room.code).clock.state;
  for (const c of all) {
    assert.equal(c.state.version, authoritative.version);
    assert.equal(c.state.position, authoritative.position);
  }
});

test('late joiner lands on the live playback position', async () => {
  const room = await newRoom();
  const a = await join(room, 'a');
  await a.seek(100);
  await a.play();
  await sleep(400);
  const late = await join(room, 'late');
  assert.equal(late.state.playing, true);
  const pos = positionAt(late.state, late.serverNow());
  assert.ok(Math.abs(pos - 100.4) < 0.15, `expected ~100.4, got ${pos}`);
});

test('reconnect keeps identity, restores membership and catches up on missed state', async () => {
  const room = await newRoom();
  const a = await join(room, 'a');
  const b = await join(room, 'b');
  const bId = b.identity.id;

  const offline = a.waitFor('participant', (m) => m.event === 'offline' && m.participant.id === bId);
  const reconnected = b.waitFor('reconnected', () => true, 5000);
  b.ws.terminate();
  await offline;
  await a.seek(42);
  await reconnected;

  assert.equal(b.identity.id, bId);
  await sleep(100);
  assert.equal(b.state.position, 42);
  assert.equal(server.rooms.get(room.code).participants.size, 2);
});

test('a participant that stays away past the grace period is removed', async () => {
  const room = await newRoom();
  const a = await join(room, 'a');
  const b = await join(room, 'b', { autoReconnect: false });
  const gone = a.waitFor('participant', (m) => m.event === 'leave' && m.participant.id === b.identity.id, 3000);
  b.close();
  await gone;
  assert.equal(a.participants.has(b.identity.id), false);
});

test('a stale token cannot hijack an identity', async () => {
  const room = await newRoom();
  const a = await join(room, 'a');
  const imposter = new WatchPartyClient({ url: wsUrl, room: room.code, name: 'evil' });
  imposter.identity = { id: a.identity.id, token: 'wrong' };
  clients.push(imposter);
  await assert.rejects(imposter.connect(), { code: 'bad_token' });
});

test('manual host transfer and automatic transfer when the host drops', async () => {
  const room = await newRoom();
  const a = await join(room, 'a', { hostKey: room.hostKey });
  const b = await join(room, 'b');
  const c = await join(room, 'c');

  await assert.rejects(b.transferHost(c.identity.id), { code: 'forbidden' });
  const moved = c.waitFor('host', (m) => m.hostId === b.identity.id);
  await a.transferHost(b.identity.id);
  await moved;
  assert.equal(b.isHost, true);

  const auto = c.waitFor('host', (m) => m.reason === 'host_offline', 3000);
  b.close();
  const m = await auto;
  assert.equal(m.hostId, a.identity.id);
});

test('host-only control mode blocks guests until switched back', async () => {
  const room = await newRoom({ controlMode: 'host' });
  const host = await join(room, 'host', { hostKey: room.hostKey });
  const guest = await join(room, 'guest');
  await assert.rejects(guest.play(), { code: 'forbidden' });
  assert.equal((await host.play()).applied, true);
  await assert.rejects(guest.updateSettings({ controlMode: 'everyone' }), { code: 'forbidden' });
  await host.updateSettings({ controlMode: 'everyone' });
  assert.equal((await guest.pause()).applied, true);
});

test('chat and reactions fan out; floods are rate limited', async () => {
  const room = await newRoom();
  const a = await join(room, 'a');
  const b = await join(room, 'b');

  const chat = b.waitFor('chat');
  const reaction = b.waitFor('reaction');
  await a.sendChat('  hello there  ');
  await a.react('🔥');
  assert.equal((await chat).message.text, 'hello there');
  assert.equal((await reaction).emoji, '🔥');

  await assert.rejects(a.react('not an emoji'), { code: 'bad_message' });
  const burst = await Promise.allSettled(Array.from({ length: 30 }, () => a.sendChat('spam')));
  assert.ok(burst.some((r) => r.status === 'rejected' && r.reason.code === 'rate_limited'));

  const late = await join(room, 'late');
  assert.ok(late.chat.length >= 1);
});

test('shared playlist: add, reorder, play, remove, and ended is idempotent', async () => {
  const room = await newRoom();
  const a = await join(room, 'a', { hostKey: room.hostKey });
  const b = await join(room, 'b');
  const c = await join(room, 'c');

  const first = (await a.playlistAdd({ title: 'One', url: 'https://example.com/1.mp4', playNow: true })).itemId;
  const second = (await b.playlistAdd({ movieId: 'big-buck-bunny' })).itemId;
  const third = (await c.playlistAdd({ title: 'Three' })).itemId;
  await sleep(50);

  assert.equal(a.state.mediaId, first);
  assert.equal(a.playlist.items.find((i) => i.id === second).title, 'Big Buck Bunny');
  assert.ok(a.playlist.items.find((i) => i.id === second).url.endsWith('BigBuckBunny.mp4'));

  await c.playlistMove(third, 0);
  await sleep(50);
  assert.equal(a.playlist.items[0].id, third);

  await assert.rejects(c.playlistRemove(first), { code: 'forbidden' });

  const advanced = await Promise.all([a.ended(first), b.ended(first), c.ended(first)]);
  assert.equal(advanced.filter((r) => r.applied).length, 1);
  await sleep(50);
  assert.equal(server.rooms.get(room.code).playlist.currentId, a.playlist.items[a.playlist.items.findIndex((i) => i.id === first) + 1].id);

  await b.playlistRemove(second);
  await a.playlistPlay(first);
  await sleep(50);
  assert.equal(c.state.mediaId, first);
  assert.equal(c.state.playing, false);
  assert.equal(c.state.position, 0);
});

test('polls: vote changes, host close, and auto-close once everyone voted', async () => {
  const room = await newRoom();
  const a = await join(room, 'a', { hostKey: room.hostKey });
  const b = await join(room, 'b');
  const c = await join(room, 'c');

  const { pollId } = await a.pollCreate({ question: 'Pick a movie', options: ['Dune', 'Arrival', 'Coco'], durationSec: 0 });
  await a.pollVote(pollId, 0);
  await b.pollVote(pollId, 1);
  await b.pollVote(pollId, 2);
  await sleep(50);
  const open = c.polls.get(pollId);
  assert.equal(open.status, 'open');
  assert.deepEqual(open.options.map((o) => o.votes), [1, 0, 1]);

  const closed = c.waitFor('poll', (m) => m.poll.status === 'closed');
  await c.pollVote(pollId, 2);
  const { poll } = await closed;
  assert.deepEqual(poll.winners, [2]);
  await assert.rejects(a.pollVote(pollId, 0), { code: 'poll_closed' });

  const second = (await a.pollCreate({ question: 'Snacks?', options: ['Yes', 'No'], durationSec: 0 })).pollId;
  await assert.rejects(b.pollClose(second), { code: 'forbidden' });
  await a.pollClose(second);
  assert.equal(a.polls.get(second).status, 'closed');
});

test('timed polls close themselves', async () => {
  const room = await newRoom();
  const a = await join(room, 'a');
  await join(room, 'b');
  const closed = a.waitFor('poll', (m) => m.poll.status === 'closed', 3000);
  await a.pollCreate({ question: 'Quick?', options: ['A', 'B'], durationSec: 1 });
  await closed;
});

test('a lagging player is pulled back: hard seek for large drift', async () => {
  const room = await newRoom();
  const host = await join(room, 'host');
  await host.seek(10);
  await host.play();
  const player = new SimulatedPlayer({ position: 10 });
  const viewer = await join(room, 'viewer', { player });
  await sleep(200);

  player.injectDrift(1500);
  await sleep(1200);
  const drift = (player.getPosition() - positionAt(viewer.state, viewer.serverNow())) * 1000;
  assert.ok(Math.abs(drift) < 100, `drift after correction was ${drift}ms`);
});

test('small drift is absorbed by rate nudging instead of a visible seek', async () => {
  const room = await newRoom();
  const host = await join(room, 'host');
  await host.play(0);
  const player = new SimulatedPlayer({ position: 0 });
  const viewer = await join(room, 'viewer', { player });
  await sleep(200);

  player.injectDrift(150);
  let seeks = 0;
  const realSeek = player.seek.bind(player);
  player.seek = (s) => {
    seeks++;
    realSeek(s);
  };
  await sleep(700);
  assert.ok(player.rate < 1, `expected slowed playback, rate=${player.rate}`);
  assert.equal(seeks, 0);
  await sleep(3500);
  const drift = (player.getPosition() - positionAt(viewer.state, viewer.serverNow())) * 1000;
  assert.ok(Math.abs(drift) < 60, `drift after nudging was ${drift}ms`);
});

test('client clock skew is compensated by the offset estimate', async () => {
  const room = await newRoom();
  const host = await join(room, 'host');
  await host.seek(500);
  await host.play();
  const skewed = await join(room, 'skewed', { now: () => Date.now() + 4000 });
  assert.ok(Math.abs(skewed.offset + 4000) < 15, `offset was ${skewed.offset}`);
  const pos = positionAt(skewed.state, skewed.serverNow());
  assert.ok(Math.abs(pos - positionAt(host.state, host.serverNow())) < 0.05);
});

test('protocol errors: bad JSON, unauthenticated actions, oversize payloads', async () => {
  const room = await newRoom();
  const raw = new WebSocket(wsUrl);
  const messages = [];
  raw.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((r) => raw.once('open', r));

  raw.send('{not json');
  raw.send(JSON.stringify({ t: 'chat', id: 1, text: 'hi' }));
  raw.send(JSON.stringify({ t: 'nope' }));
  await sleep(100);
  assert.deepEqual(messages.map((m) => m.code), ['bad_json', 'not_joined', 'bad_message']);
  assert.equal(messages[1].id, 1);

  const closed = new Promise((r) => raw.once('close', (code) => r(code)));
  raw.send('x'.repeat(40 * 1024));
  assert.equal(await closed, 1009);
  assert.ok(room.code);
});

test('movie endpoints serve categories, filtered search and recommendations', async () => {
  const cats = await (await fetch(`${base}/api/movies/categories`)).json();
  assert.ok(cats.shelves.length > 0);

  const search = await (await fetch(`${base}/api/movies?q=incepton&genre=Sci-Fi&minRating=8`)).json();
  assert.equal(search.items[0].id, 'inception');

  const recs = await (await fetch(`${base}/api/movies/recommendations?basedOn=arrival,dune&limit=3`)).json();
  assert.equal(recs.items.length, 3);

  assert.equal((await fetch(`${base}/api/movies/missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/movies?limit=999`)).status, 400);
  assert.equal((await fetch(`${base}/api/movies?category=nope`)).status, 400);
});