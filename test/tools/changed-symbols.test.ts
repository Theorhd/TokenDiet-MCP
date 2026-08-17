import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getChangedSymbols } from '../../src/tools/changed-symbols.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getChangedSymbols', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('inspects git working tree changes and returns changed symbols', async () => {
    const result = await getChangedSymbols(projectRoot, cache, {});
    expect(result.branch).toBeDefined();
    expect(Array.isArray(result.changedFiles)).toBe(true);
    expect(typeof result.totalFilesChanged).toBe('number');
  });
});
