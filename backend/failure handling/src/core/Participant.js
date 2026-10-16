import { TokenBucket } from '../util/tokenBucket.js';

export class Participant {
  constructor({ id, name, token, joinedAt }) {
    this.id = id;
    this.name = name;
    this.token = token;
    this.joinedAt = joinedAt;
    this.conn = null;
    this.offlineSince = null;
    this.graceTimer = null;
    this.lastResyncAt = 0;
    this.chatBucket = new TokenBucket(5, 1);
    this.reactionBucket = new TokenBucket(10, 5);
  }

  get connected() {
    return this.conn !== null;
  }

  toJSON() {
    return { id: this.id, name: this.name, connected: this.connected, joinedAt: this.joinedAt };
  }
}