import express from 'express';
import { ZodError } from 'zod';
import { AppError } from '../util/errors.js';
import { log } from '../util/logger.js';
import { metrics } from '../metrics.js';
import { roomRoutes } from './roomRoutes.js';
import { movieRoutes } from './movieRoutes.js';

export function createApp({ rooms, movies, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': config.corsOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeSec: process.uptime(), ...rooms.stats() }));
  app.get('/api/metrics', (_req, res) => res.json(metrics.snapshot()));
  app.use('/api/rooms', roomRoutes({ rooms, config }));
  app.use('/api/movies', movieRoutes({ movies }));

  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found' } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return res
        .status(400)
        .json({ error: { code: 'bad_request', message: 'Invalid request', issues: err.issues } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
    }
    log.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal error' } });
  });

  return app;
}