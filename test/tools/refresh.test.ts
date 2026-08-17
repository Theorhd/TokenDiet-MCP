import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { refreshIndex } from '../../src/tools/refresh.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('refreshIndex', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('reindexes the project and updates indexed_at', async () => {
    const result = await refreshIndex(projectRoot, cache);
    expect(result.reindexed).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(cache.getIndexedAt()).toBeTruthy();

    const stats = cache.getStats();
    expect(stats.fileCount).toBeGreaterThan(0);
  });
});
