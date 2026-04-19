'use strict';

/**
 * Async counting semaphore.
 *
 * Limits the number of concurrent async operations. Callers
 * await acquire(), do their work, then call release(). If the
 * limit is already reached, acquire() suspends until a previous
 * caller calls release().
 *
 * Usage:
 *   const sem = new Semaphore(10);
 *   await sem.acquire();
 *   try { ... } finally { sem.release(); }
 */
class Semaphore {
  constructor(limit) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`Semaphore limit must be a positive integer, got ${limit}`);
    }
    this.limit = limit;
    this._count = 0;
    this._queue = [];
  }

  /**
   * Acquire a slot. Resolves immediately when below the limit,
   * otherwise queues and waits.
   */
  acquire() {
    if (this._count < this.limit) {
      this._count++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._queue.push(resolve);
    });
  }

  /**
   * Release a slot. If callers are queued, the next one is resumed.
   */
  release() {
    if (this._queue.length > 0) {
      // keep _count the same — hand the slot directly to the next waiter
      const next = this._queue.shift();
      next();
    } else {
      this._count--;
    }
  }

  get available() {
    return this.limit - this._count;
  }

  get queued() {
    return this._queue.length;
  }
}

module.exports = Semaphore;
