import { Room } from './Room.js';
import { AppError } from '../util/errors.js';
import { roomCode, newToken } from '../util/ids.js';
import { log } from '../util/logger.js';

export class RoomManager {
  #sweeper;

  constructor(opts) {
    this.opts = opts;
    this.rooms = new Map();
    this.#sweeper = setInterval(() => this.sweep(), opts.sweepMs);
    this.#sweeper.unref();
  }

  create({ name, controlMode } = {}) {
    if (this.rooms.size >= this.opts.maxRooms) throw new AppError('too_many_rooms', 'Server is at capacity', 503);
    let code;
    for (let i = 0; i < 10; i++) {
      code = roomCode();
      if (!this.rooms.has(code)) break;
      code = null;
    }
    if (!code) throw new AppError('internal', 'Could not allocate a room code', 500);
    const room = new Room({
      code,
      name: name || `Room ${code}`,
      controlMode,
      hostKey: newToken(),
      opts: this.opts,
    });
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(code);
  }

  require(code) {
    const room = this.rooms.get(code);
    if (!room) throw new AppError('room_not_found', 'Room not found', 404);
    return room;
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > this.opts.roomIdleTtlMs) {
        room.dispose();
        this.rooms.delete(code);
        log.info(`room ${code} closed after idle timeout`);
      }
    }
  }

  stats() {
    let participants = 0;
    let connected = 0;
    for (const room of this.rooms.values()) {
      participants += room.participants.size;
      connected += room.connectedCount();
    }
    return { rooms: this.rooms.size, participants, connected };
  }

  closeAll() {
    clearInterval(this.#sweeper);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}