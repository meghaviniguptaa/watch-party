import { Router } from 'express';
import { z } from 'zod';
import { normalizeCode } from '../util/ids.js';

const CreateBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    controlMode: z.enum(['everyone', 'host']).optional(),
  })
  .strict();

export function roomRoutes({ rooms, config }) {
  const router = Router();

  router.post('/', (req, res) => {
    const room = rooms.create(CreateBody.parse(req.body ?? {}));
    res.status(201).json({
      code: room.code,
      name: room.name,
      controlMode: room.controlMode,
      hostKey: room.hostKey,
      inviteUrl: `${config.publicUrl}/join/${room.code}`,
      ws: '/ws',
    });
  });

  router.get('/:code', (req, res) => {
    res.json(rooms.require(normalizeCode(req.params.code)).summary());
  });

  return router;
}