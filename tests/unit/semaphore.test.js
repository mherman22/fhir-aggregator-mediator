'use strict';

const Semaphore = require('../../src/semaphore');

describe('Semaphore', () => {
  it('throws on non-positive limit', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow(RangeError);
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
  });

  it('allows up to limit concurrent acquires without queuing', async () => {
    const sem = new Semaphore(3);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();
    expect(sem.available).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('queues when limit is reached', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    expect(sem.available).toBe(0);

    let resolved = false;
    const pending = sem.acquire().then(() => {
      resolved = true;
    });
    expect(sem.queued).toBe(1);
    expect(resolved).toBe(false);

    sem.release();
    await pending;
    expect(resolved).toBe(true);
    expect(sem.queued).toBe(0);
  });

  it('processes queued waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));
    const p3 = sem.acquire().then(() => order.push(3));

    sem.release(); // unblocks p1
    await p1;
    sem.release(); // unblocks p2
    await p2;
    sem.release(); // unblocks p3
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it('available count decrements and increments correctly', async () => {
    const sem = new Semaphore(2);
    expect(sem.available).toBe(2);
    await sem.acquire();
    expect(sem.available).toBe(1);
    await sem.acquire();
    expect(sem.available).toBe(0);
    sem.release();
    expect(sem.available).toBe(1);
    sem.release();
    expect(sem.available).toBe(2);
  });

  it('limits concurrent async operations', async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      (async () => {
        await sem.acquire();
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        sem.release();
      })()
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('throws on release() underflow (no slot held)', () => {
    const sem = new Semaphore(2);
    expect(() => sem.release()).toThrow('release() called more times than acquire()');
  });

  it('throws on release() underflow after acquiring and releasing all slots', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    sem.release();
    expect(() => sem.release()).toThrow('release() called more times than acquire()');
  });

});
