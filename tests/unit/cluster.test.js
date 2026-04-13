'use strict';

const { isClusterEnabled, getWorkerCount } = require('../../src/cluster');

describe('cluster', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CLUSTER_ENABLED;
    delete process.env.CLUSTER_WORKERS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isClusterEnabled', () => {
    it('returns false when no config and no env', () => {
      expect(isClusterEnabled({})).toBe(false);
    });

    it('returns false when config.cluster.enabled is false', () => {
      expect(isClusterEnabled({ cluster: { enabled: false } })).toBe(false);
    });

    it('returns true when config.cluster.enabled is true', () => {
      expect(isClusterEnabled({ cluster: { enabled: true } })).toBe(true);
    });

    it('returns true when CLUSTER_ENABLED env is "true"', () => {
      process.env.CLUSTER_ENABLED = 'true';
      expect(isClusterEnabled({})).toBe(true);
    });

    it('returns true when CLUSTER_ENABLED env is "1"', () => {
      process.env.CLUSTER_ENABLED = '1';
      expect(isClusterEnabled({})).toBe(true);
    });

    it('returns false when CLUSTER_ENABLED env is "false"', () => {
      process.env.CLUSTER_ENABLED = 'false';
      expect(isClusterEnabled({ cluster: { enabled: true } })).toBe(false);
    });

    it('env var takes precedence over config', () => {
      process.env.CLUSTER_ENABLED = 'false';
      expect(isClusterEnabled({ cluster: { enabled: true } })).toBe(false);
    });

    it('returns false when config is null', () => {
      expect(isClusterEnabled(null)).toBe(false);
    });

    it('returns false when config is undefined', () => {
      expect(isClusterEnabled(undefined)).toBe(false);
    });
  });

  describe('getWorkerCount', () => {
    it('defaults to os.cpus().length when no config or env', () => {
      const os = require('os');
      expect(getWorkerCount({})).toBe(os.cpus().length);
    });

    it('uses config.cluster.workers when set', () => {
      expect(getWorkerCount({ workers: 4 })).toBe(4);
    });

    it('uses CLUSTER_WORKERS env var when set', () => {
      process.env.CLUSTER_WORKERS = '8';
      expect(getWorkerCount({ workers: 4 })).toBe(8);
    });

    it('env var takes precedence over config', () => {
      process.env.CLUSTER_WORKERS = '2';
      expect(getWorkerCount({ workers: 4 })).toBe(2);
    });

    it('ignores invalid CLUSTER_WORKERS env (NaN)', () => {
      process.env.CLUSTER_WORKERS = 'abc';
      expect(getWorkerCount({ workers: 4 })).toBe(4);
    });

    it('ignores CLUSTER_WORKERS env when less than 1', () => {
      process.env.CLUSTER_WORKERS = '0';
      expect(getWorkerCount({ workers: 4 })).toBe(4);
    });

    it('ignores invalid config workers (NaN)', () => {
      const os = require('os');
      expect(getWorkerCount({ workers: 'abc' })).toBe(os.cpus().length);
    });

    it('handles null clusterConfig', () => {
      const os = require('os');
      expect(getWorkerCount(null)).toBe(os.cpus().length);
    });

    it('handles undefined clusterConfig', () => {
      const os = require('os');
      expect(getWorkerCount(undefined)).toBe(os.cpus().length);
    });
  });

  describe('startCluster', () => {
    it('calls startWorker directly when clustering is disabled', () => {
      const { startCluster } = require('../../src/cluster');
      const mockStartWorker = jest.fn();
      startCluster(mockStartWorker, {});
      expect(mockStartWorker).toHaveBeenCalledTimes(1);
    });

    it('calls startWorker directly when config has cluster.enabled=false', () => {
      const { startCluster } = require('../../src/cluster');
      const mockStartWorker = jest.fn();
      startCluster(mockStartWorker, { cluster: { enabled: false } });
      expect(mockStartWorker).toHaveBeenCalledTimes(1);
    });
  });
});
