import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSymbolReferences } from '../../src/tools/symbol-references.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getSymbolReferences', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('finds usages and references of a symbol across the project', async () => {
    const result = await getSymbolReferences(projectRoot, cache, { symbol: 'CacheManager' });
    expect(result.symbol).toBe('CacheManager');
    expect(result.references.length).toBeGreaterThan(0);
    expect(result.references.some(r => r.file === 'src/server.ts')).toBe(true);
    expect(result.references.some(r => r.isImport)).toBe(true);
  });

  it('throws error if symbol parameter is empty', async () => {
    await expect(
      getSymbolReferences(projectRoot, cache, { symbol: '' })
    ).rejects.toThrow('Symbol name is required');
  });
});
