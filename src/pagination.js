'use strict';

const { LRUCache } = require('lru-cache');
const { v4: uuidv4 } = require('uuid');

class PaginationManager {
  constructor(config) {
    this.cache = new LRUCache({
      max: (config && config.cacheMaxSize) || 1000,
      ttl: (config && config.cacheTtlMs) || 3600000,
    });
  }

  createToken(nextPages) {
    if (!nextPages || Object.keys(nextPages).length === 0) {
      return null;
    }
    const token = uuidv4();
    this.cache.set(token, nextPages);
    return token;
  }

  getState(token) {
    return this.cache.get(token) || null;
  }
}

module.exports = PaginationManager;
