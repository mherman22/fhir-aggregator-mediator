'use strict';

/**
 * Async counting semaphore.
 *
 * Limits the number of concurrent async operations. Callers
 * await acquire(), do their work, then call release(). If the
 * limit is already reached, acquire() suspends until a previous
 * caller calls release().
 *
 * Implementation notes:
 * - The waiter queue uses a head-index approach so dequeue is O(1).
 * - release() guards against underflow — calling it more times than
 *   acquire() throws, so misuse fails loudly rather than silently
 *   disabling concurrency limits.
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
    // O(1) FIFO queue: items stored in an array with a moving head pointer
    // to avoid O(n) re-indexing that Array.shift() causes on large queues.
    this._queue = [];
    this._queueHead = 0;
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
   * Throws if release() is called when no slot is held (underflow guard).
   */
  release() {
    if (this._queueHead < this._queue.length) {
      // Hand the slot directly to the next waiter (keep _count the same).
      const next = this._queue[this._queueHead];
      this._queue[this._queueHead] = undefined; // allow GC
      this._queueHead++;
      // Compact the backing array once the head has advanced far enough
      if (this._queueHead > 1024 && this._queueHead > this._queue.length >> 1) {
        this._queue = this._queue.slice(this._queueHead);
        this._queueHead = 0;
      }
      next();
    } else if (this._count > 0) {
      this._count--;
    } else {
      throw new Error('Semaphore: release() called more times than acquire()');
    }
  }

  get available() {
    return this.limit - this._count;
  }

  get queued() {
    return this._queue.length - this._queueHead;
  }
}

module.exports = Semaphore;
