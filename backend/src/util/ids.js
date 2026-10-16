import { randomBytes, randomInt } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const roomCode = (length = 6) =>
  Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const shortId = () => randomBytes(6).toString('base64url');

export const newToken = () => randomBytes(24).toString('base64url');