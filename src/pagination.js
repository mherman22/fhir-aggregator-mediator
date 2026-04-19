'use strict';

/**
 * Stateless pagination manager.
 *
 * Instead of storing per-source _getpages tokens in an in-process LRU cache
 * (which breaks in multi-replica / clustered deployments), the state is encoded
 * directly into the pagination token as a base64url-encoded JSON string.
 *
 * Token format (before encoding):
 *   { [sourceId]: "<_getpages value from upstream>" }
 *
 * The baseUrl for each source is NOT stored in the token — it is looked up from
 * the configured sources at request time. This prevents clients from crafting
 * tokens that point to arbitrary internal URLs.
 *
 * Config parameter is accepted for API compatibility but has no effect.
 */
class PaginationManager {
  // eslint-disable-next-line no-unused-vars
  constructor(config) {
    // no-op: stateless implementation has no server-side state
  }

  /**
   * Encode per-source _getpages tokens into a URL-safe pagination token.
   * @param {Object} nextPages - Map of sourceId → upstream _getpages token string
   * @returns {string|null} base64url-encoded token, or null if no pages
   */
  createToken(nextPages) {
    if (!nextPages || Object.keys(nextPages).length === 0) {
      return null;
    }
    return Buffer.from(JSON.stringify(nextPages)).toString('base64url');
  }

  /**
   * Decode a pagination token back to per-source state.
   * @param {string} token
   * @returns {Object|null} decoded state, or null if token is invalid
   */
  getState(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const json = Buffer.from(token, 'base64url').toString('utf8');
      const state = JSON.parse(json);
      if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
      // Each value must be a non-empty string (the upstream _getpages token).
      // Reject objects/arrays/numbers so crafted tokens like { "src1": {"a":1} }
      // cannot be interpolated into upstream URLs as "[object Object]".
      for (const val of Object.values(state)) {
        if (typeof val !== 'string' || val.length === 0) return null;
      }
      return state;
    } catch {
      return null;
    }
  }
}

module.exports = PaginationManager;
