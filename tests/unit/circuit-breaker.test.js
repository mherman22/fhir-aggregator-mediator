'use strict';

const CircuitBreaker = require('../../src/circuit-breaker');

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
  });

  describe('initial state', () => {
    it('starts in CLOSED state for new sources', () => {
      expect(cb.allowRequest('src1')).toBe(true);
      const states = cb.getStates();
      expect(states.src1.state).toBe('CLOSED');
    });
  });

  describe('failure tracking', () => {
    it('stays CLOSED below failure threshold', () => {
      cb.recordFailure('src1');
      cb.recordFailure('src1');
      expect(cb.allowRequest('src1')).toBe(true);
      expect(cb.getStates().src1.state).toBe('CLOSED');
    });

    it('transitions to OPEN at failure threshold', () => {
      cb.recordFailure('src1');
      cb.recordFailure('src1');
      cb.recordFailure('src1');
      expect(cb.allowRequest('src1')).toBe(false);
      expect(cb.getStates().src1.state).toBe('OPEN');
    });

    it('blocks requests when OPEN', () => {
      for (let i = 0; i < 5; i++) cb.recordFailure('src1');
      expect(cb.allowRequest('src1')).toBe(false);
    });
  });

  describe('recovery', () => {
    it('transitions to HALF_OPEN after resetTimeout', async () => {
      for (let i = 0; i < 3; i++) cb.recordFailure('src1');
      expect(cb.allowRequest('src1')).toBe(false);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cb.allowRequest('src1')).toBe(true);
      expect(cb.getStates().src1.state).toBe('HALF_OPEN');
    });

    it('transitions to CLOSED on success after HALF_OPEN', async () => {
      for (let i = 0; i < 3; i++) cb.recordFailure('src1');
      await new Promise((resolve) => setTimeout(resolve, 150));
      cb.allowRequest('src1'); // triggers HALF_OPEN
      cb.recordSuccess('src1');
      expect(cb.getStates().src1.state).toBe('CLOSED');
      expect(cb.getStates().src1.failures).toBe(0);
    });

    it('transitions back to OPEN on failure during HALF_OPEN', async () => {
      for (let i = 0; i < 3; i++) cb.recordFailure('src1');
      await new Promise((resolve) => setTimeout(resolve, 150));
      cb.allowRequest('src1'); // triggers HALF_OPEN
      cb.recordFailure('src1');
      expect(cb.getStates().src1.state).toBe('OPEN');
    });
  });

  describe('recordSuccess', () => {
    it('resets failure count and state to CLOSED', () => {
      cb.recordFailure('src1');
      cb.recordFailure('src1');
      cb.recordSuccess('src1');
      expect(cb.getStates().src1.failures).toBe(0);
      expect(cb.getStates().src1.state).toBe('CLOSED');
    });
  });

  describe('getStates', () => {
    it('returns state for all tracked sources', () => {
      cb.allowRequest('src1');
      cb.allowRequest('src2');
      cb.recordFailure('src1');

      const states = cb.getStates();
      expect(Object.keys(states)).toEqual(['src1', 'src2']);
      expect(states.src1.failures).toBe(1);
      expect(states.src2.failures).toBe(0);
    });

    it('includes lastFailure as ISO string', () => {
      cb.recordFailure('src1');
      const states = cb.getStates();
      expect(states.src1.lastFailure).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns null lastFailure when no failures', () => {
      cb.allowRequest('src1');
      expect(cb.getStates().src1.lastFailure).toBeNull();
    });
  });

  describe('independent circuits', () => {
    it('each source has its own circuit', () => {
      for (let i = 0; i < 3; i++) cb.recordFailure('src1');
      expect(cb.allowRequest('src1')).toBe(false);
      expect(cb.allowRequest('src2')).toBe(true);
    });
  });
});
