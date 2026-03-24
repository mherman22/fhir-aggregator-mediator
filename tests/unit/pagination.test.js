'use strict';

const PaginationManager = require('../../src/pagination');

describe('PaginationManager', () => {
  let pm;

  beforeEach(() => {
    pm = new PaginationManager({ cacheMaxSize: 5, cacheTtlMs: 60000 });
  });

  it('creates a token and retrieves state', () => {
    const state = { src1: { token: 'abc', baseUrl: 'http://src1/fhir' } };
    const token = pm.createToken(state);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(pm.getState(token)).toEqual(state);
  });

  it('returns null for empty input', () => {
    expect(pm.createToken(null)).toBeNull();
    expect(pm.createToken({})).toBeNull();
    expect(pm.createToken(undefined)).toBeNull();
  });

  it('returns null for unknown token', () => {
    expect(pm.getState('nonexistent')).toBeNull();
  });

  it('generates unique tokens', () => {
    const state = { src1: { token: 'a', baseUrl: 'http://a' } };
    const t1 = pm.createToken(state);
    const t2 = pm.createToken(state);
    expect(t1).not.toBe(t2);
  });

  it('evicts oldest entry when max size exceeded', () => {
    const tokens = [];
    for (let i = 0; i < 6; i++) {
      tokens.push(pm.createToken({ [`src${i}`]: { token: `t${i}`, baseUrl: 'http://x' } }));
    }
    // First token should be evicted (cache max is 5)
    expect(pm.getState(tokens[0])).toBeNull();
    // Latest should still exist
    expect(pm.getState(tokens[5])).toBeTruthy();
  });

  it('handles default config when no config provided', () => {
    const defaultPm = new PaginationManager();
    const token = defaultPm.createToken({ src1: { token: 'a', baseUrl: 'http://a' } });
    expect(defaultPm.getState(token)).toBeTruthy();
  });
});
