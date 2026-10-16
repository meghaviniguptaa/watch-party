export const DRIFT = Object.freeze({
  DEADBAND_MS: 40,
  HARD_SEEK_MS: 400,
  MAX_NUDGE: 0.05,
  NUDGE_HORIZON_MS: 2000,
  CHECK_INTERVAL_MS: 500,
  REPORT_INTERVAL_MS: 2000,
  SERVER_RESYNC_COOLDOWN_MS: 1500,
});

export function positionAt(state, serverTime) {
  return state.playing ? state.position + (serverTime - state.anchor) / 1000 : state.position;
}

// driftMs > 0 means the local player is ahead of the room.
export function computeCorrection(driftMs) {
  const abs = Math.abs(driftMs);
  if (abs <= DRIFT.DEADBAND_MS) return { action: 'none', rate: 1 };
  if (abs > DRIFT.HARD_SEEK_MS) return { action: 'seek', rate: 1 };
  const nudge = Math.min(DRIFT.MAX_NUDGE, abs / DRIFT.NUDGE_HORIZON_MS);
  return { action: 'rate', rate: driftMs > 0 ? 1 - nudge : 1 + nudge };
}