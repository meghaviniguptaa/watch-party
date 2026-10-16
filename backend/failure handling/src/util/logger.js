const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

const emit = (level, args) => {
  if (LEVELS[level] < threshold) return;
  const sink = level === 'debug' || level === 'info' ? console.log : console[level];
  sink(new Date().toISOString(), level.toUpperCase(), ...args);
};

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
};