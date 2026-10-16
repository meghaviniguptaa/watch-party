import { shortId } from '../util/ids.js';
import { AppError } from '../util/errors.js';

const MAX_OPEN = 5;
const MAX_KEPT = 20;

export class PollManager {
  #polls = new Map();
  #timers = new Map();

  constructor({ onClose } = {}) {
    this.onClose = onClose;
  }

  create({ question, options, by, durationSec = 60 }) {
    const open = [...this.#polls.values()].filter((p) => p.status === 'open').length;
    if (open >= MAX_OPEN) throw new AppError('too_many_polls', 'Too many open polls');
    const now = Date.now();
    const poll = {
      id: shortId(),
      question,
      options,
      createdBy: by,
      createdAt: now,
      closesAt: durationSec ? now + durationSec * 1000 : null,
      closedAt: null,
      status: 'open',
      votes: {},
    };
    this.#polls.set(poll.id, poll);
    if (durationSec) {
      const timer = setTimeout(() => this.close(poll.id), durationSec * 1000);
      timer.unref();
      this.#timers.set(poll.id, timer);
    }
    this.#prune();
    return this.view(poll);
  }

  get(id) {
    const poll = this.#polls.get(id);
    if (!poll) throw new AppError('not_found', 'Poll not found', 404);
    return poll;
  }

  vote(id, voterId, option) {
    const poll = this.get(id);
    if (poll.status !== 'open') throw new AppError('poll_closed', 'Poll is closed');
    if (option >= poll.options.length) throw new AppError('bad_option', 'Option out of range');
    poll.votes[voterId] = option;
    return this.view(poll);
  }

  allVoted(id, voterIds) {
    const poll = this.#polls.get(id);
    return Boolean(poll) && voterIds.length > 0 && voterIds.every((v) => Object.hasOwn(poll.votes, v));
  }

  close(id) {
    const poll = this.#polls.get(id);
    if (!poll || poll.status !== 'open') return null;
    poll.status = 'closed';
    poll.closedAt = Date.now();
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    const view = this.view(poll);
    this.onClose?.(view);
    return view;
  }

  view(poll) {
    const counts = poll.options.map(() => 0);
    for (const option of Object.values(poll.votes)) counts[option]++;
    const max = Math.max(...counts);
    return {
      id: poll.id,
      question: poll.question,
      createdBy: poll.createdBy,
      createdAt: poll.createdAt,
      closesAt: poll.closesAt,
      closedAt: poll.closedAt,
      status: poll.status,
      options: poll.options.map((text, i) => ({ text, votes: counts[i] })),
      voters: Object.keys(poll.votes).length,
      votes: { ...poll.votes },
      winners: poll.status === 'closed' && max > 0 ? counts.flatMap((c, i) => (c === max ? [i] : [])) : [],
    };
  }

  toJSON() {
    return [...this.#polls.values()].map((p) => this.view(p));
  }

  #prune() {
    if (this.#polls.size <= MAX_KEPT) return;
    for (const [id, poll] of this.#polls) {
      if (this.#polls.size <= MAX_KEPT) break;
      if (poll.status === 'closed') this.#polls.delete(id);
    }
  }

  dispose() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}