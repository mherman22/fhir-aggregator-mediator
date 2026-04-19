'use strict';

const PaginationManager = require('../../src/pagination');

describe('PaginationManager (stateless)', () => {
  let pm;

  beforeEach(() => {
    // Config is accepted for compatibility but has no effect on stateless implementation
    pm = new PaginationManager({ cacheMaxSize: 5, cacheTtlMs: 60000 });
  });

  it('creates a token and retrieves state', () => {
    const state = { src1: 'abc' };
    const token = pm.createToken(state);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(pm.getState(token)).toEqual(state);
  });

  it('round-trips a multi-source state', () => {
    const state = {
      src1: 'token-abc123',
      src2: 'token-def456',
    };
    const token = pm.createToken(state);
    expect(pm.getState(token)).toEqual(state);
  });

  it('returns null for empty input', () => {
    expect(pm.createToken(null)).toBeNull();
    expect(pm.createToken({})).toBeNull();
    expect(pm.createToken(undefined)).toBeNull();
  });

  it('returns null for an unrecognised (non-base64url) token', () => {
    expect(pm.getState('nonexistent!!!')).toBeNull();
  });

  it('returns null for a token that decodes to non-JSON', () => {
    // base64url of raw bytes that are not valid JSON
    const badToken = Buffer.from('not-json-at-all').toString('base64url');
    expect(pm.getState(badToken)).toBeNull();
  });

  it('returns null for a token that decodes to an array', () => {
    const arrayToken = Buffer.from(JSON.stringify(['a', 'b'])).toString('base64url');
    expect(pm.getState(arrayToken)).toBeNull();
  });

  it('different states produce different tokens', () => {
    const t1 = pm.createToken({ src1: 'a' });
    const t2 = pm.createToken({ src1: 'b' });
    expect(t1).not.toBe(t2);
  });

  it('same state always produces the same token (deterministic)', () => {
    const state = { src1: 'abc', src2: 'def' };
    expect(pm.createToken(state)).toBe(pm.createToken(state));
  });

  it('handles default config when no config provided', () => {
    const defaultPm = new PaginationManager();
    const token = defaultPm.createToken({ src1: 'a' });
    expect(defaultPm.getState(token)).toEqual({ src1: 'a' });
  });

  it('token is URL-safe (no +, /, = characters)', () => {
    // Tokens should be base64url, not base64 (which uses +, /, =)
    const state = { src1: 'some-page-token-with-special-chars-123456789' };
    const token = pm.createToken(state);
    expect(token).not.toMatch(/[+/=]/);
  });
});
