import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock } from '../src/core/PlaybackClock.js';
import { computeCorrection, positionAt } from '../src/shared/sync.js';

const make = () => {
  const time = { t: 1000 };
  return { time, clock: new PlaybackClock(() => time.t) };
};

test('position advances only while playing', () => {
  const { time, clock } = make();
  clock.seek(10);
  time.t += 5000;
  assert.equal(clock.positionAt(), 10);
  clock.play();
  time.t += 2000;
  assert.equal(clock.positionAt(), 12);
  clock.pause();
  time.t += 5000;
  assert.equal(clock.positionAt(), 12);
});

test('play and pause are idempotent', () => {
  const { clock } = make();
  assert.ok(clock.play());
  assert.equal(clock.play(), null);
  assert.ok(clock.pause());
  assert.equal(clock.pause(), null);
});

test('every applied transition bumps the version', () => {
  const { clock } = make();
  const v0 = clock.state.version;
  clock.play();
  clock.seek(5);
  clock.pause();
  assert.equal(clock.state.version, v0 + 3);
});

test('client-supplied position wins when valid, falls back otherwise', () => {
  const { time, clock } = make();
  clock.play(30);
  time.t += 1000;
  const paused = clock.pause(Number.NaN);
  assert.equal(paused.position, 31);
  const resumed = clock.play(-5);
  assert.equal(resumed.position, 31);
});

test('setMedia resets to a paused zero position', () => {
  const { clock } = make();
  clock.play(50);
  const snap = clock.setMedia('item-1');
  assert.deepEqual([snap.mediaId, snap.playing, snap.position], ['item-1', false, 0]);
});

test('positionAt compensates for propagation delay', () => {
  const state = { playing: true, position: 100, anchor: 5000 };
  assert.equal(positionAt(state, 5250), 100.25);
});

test('drift correction policy', () => {
  assert.equal(computeCorrection(10).action, 'none');
  assert.equal(computeCorrection(-30).action, 'none');
  const ahead = computeCorrection(200);
  assert.equal(ahead.action, 'rate');
  assert.ok(ahead.rate < 1);
  const behind = computeCorrection(-200);
  assert.ok(behind.rate > 1);
  assert.equal(computeCorrection(401).action, 'seek');
  assert.equal(computeCorrection(-2000).action, 'seek');
});