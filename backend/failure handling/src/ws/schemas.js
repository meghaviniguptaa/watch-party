import { z } from 'zod';

const reqId = z.union([z.string().max(64), z.number()]).optional();
const msg = (t, shape = {}) => z.object({ t: z.literal(t), id: reqId, ...shape });

const entityId = z.string().min(1).max(64);
const seconds = z.number().finite().min(0).max(86400 * 7);
const httpUrl = z
  .string()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed');
const emoji = z
  .string()
  .max(16)
  .regex(/^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u);

export const ClientMessage = z.discriminatedUnion('t', [
  msg('ping', { c: z.number() }),
  msg('join', {
    room: z.string().min(1).max(16),
    name: z.string().trim().min(1).max(32),
    participantId: entityId.optional(),
    token: z.string().max(128).optional(),
    hostKey: z.string().max(128).optional(),
  }),
  msg('control', { action: z.enum(['play', 'pause', 'seek']), position: seconds.optional() }),
  msg('drift', { position: seconds, serverTime: z.number(), version: z.number().int() }),
  msg('resync'),
  msg('chat', { text: z.string().trim().min(1).max(500) }),
  msg('reaction', { emoji }),
  msg('playlist.add', {
    movieId: entityId.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    url: httpUrl.optional(),
    playNow: z.boolean().optional(),
  }),
  msg('playlist.remove', { itemId: entityId }),
  msg('playlist.move', { itemId: entityId, index: z.number().int().min(0).max(1000) }),
  msg('playlist.play', { itemId: entityId }),
  msg('playlist.next'),
  msg('ended', { itemId: entityId }),
  msg('poll.create', {
    question: z.string().trim().min(1).max(200),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(8),
    durationSec: z.number().int().min(0).max(3600).optional(),
  }),
  msg('poll.vote', { pollId: entityId, option: z.number().int().min(0).max(7) }),
  msg('poll.close', { pollId: entityId }),
  msg('host.transfer', { to: entityId }),
  msg('settings.update', { controlMode: z.enum(['everyone', 'host']) }),
  msg('leave'),
]);