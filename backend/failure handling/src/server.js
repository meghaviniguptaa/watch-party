import { createServer } from './createServer.js';
import { log } from './util/logger.js';

const server = createServer();
const addr = await server.listen();
log.info(`watchparty listening on ${addr.address}:${addr.port}`);

const shutdown = async (signal) => {
  log.info(`${signal} received, shutting down`);
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));