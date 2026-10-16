import { shortId } from '../util/ids.js';
import { AppError } from '../util/errors.js';

const MAX_ITEMS = 100;
const notFound = () => new AppError('not_found', 'Playlist item not found', 404);

export class Playlist {
  constructor() {
    this.items = [];
    this.currentId = null;
    this.version = 0;
  }

  get(id) {
    return this.items.find((i) => i.id === id) ?? null;
  }

  add({ movieId = null, title, url = null }, addedBy) {
    if (this.items.length >= MAX_ITEMS) throw new AppError('playlist_full', 'Playlist is full');
    const item = { id: shortId(), movieId, title, url, addedBy, addedAt: Date.now() };
    this.items.push(item);
    this.version++;
    return item;
  }

  remove(id) {
    const index = this.items.findIndex((i) => i.id === id);
    if (index < 0) throw notFound();
    const [item] = this.items.splice(index, 1);
    const wasCurrent = this.currentId === id;
    if (wasCurrent) this.currentId = null;
    this.version++;
    return { item, wasCurrent, successor: wasCurrent ? (this.items[index] ?? null) : null };
  }

  move(id, index) {
    const from = this.items.findIndex((i) => i.id === id);
    if (from < 0) throw notFound();
    const [item] = this.items.splice(from, 1);
    this.items.splice(Math.min(index, this.items.length), 0, item);
    this.version++;
  }

  setCurrent(id) {
    this.currentId = id;
    this.version++;
  }

  next() {
    const idx = this.items.findIndex((i) => i.id === this.currentId);
    return this.items[idx + 1] ?? null;
  }

  toJSON() {
    return { version: this.version, currentId: this.currentId, items: this.items };
  }
}