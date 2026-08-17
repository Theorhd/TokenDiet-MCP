import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSymbolBody } from '../../src/tools/symbol-body.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getSymbolBody', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('extracts function body and line range without reading entire file', async () => {
    const result = await getSymbolBody(projectRoot, cache, {
      path: 'src/core/utils.ts',
      symbol: 'formatBytes',
    });

    expect(result.file).toBe('src/core/utils.ts');
    expect(result.symbol).toBe('formatBytes');
    expect(result.kind).toBe('function');
    expect(result.body).toContain('function formatBytes');
    expect(result.body).toContain('return `${bytes}B`');
    expect(result.endLine).toBeGreaterThan(result.line);
  });

  it('throws helpful error if symbol is not found in file', async () => {
    await expect(
      getSymbolBody(projectRoot, cache, {
        path: 'src/core/utils.ts',
        symbol: 'nonExistentFunction',
      })
    ).rejects.toThrow("Symbol 'nonExistentFunction' not found in src/core/utils.ts");
  });
});
