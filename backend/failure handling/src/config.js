const int = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const env = process.env;

export const config = Object.freeze({
  port: int(env.PORT, 8080),
  host: env.HOST || '0.0.0.0',
  publicUrl: env.PUBLIC_URL || 'http://localhost:5173',
  corsOrigin: env.CORS_ORIGIN || '*',
  maxRoomSize: int(env.MAX_ROOM_SIZE, 50),
  maxRooms: int(env.MAX_ROOMS, 1000),
  syncBroadcastMs: int(env.SYNC_BROADCAST_MS, 5000),
  participantGraceMs: int(env.PARTICIPANT_GRACE_MS, 30000),
  hostGraceMs: int(env.HOST_GRACE_MS, 8000),
  roomIdleTtlMs: int(env.ROOM_IDLE_TTL_MS, 300000),
  sweepMs: 30000,
  heartbeatMs: 10000,
  joinTimeoutMs: 10000,
  maxPayloadBytes: 16 * 1024,
  maxBufferedBytes: 1024 * 1024,
});