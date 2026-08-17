import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFileOverview } from '../../src/tools/file-overview.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getFileOverview', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('parses a file on cache miss and returns signatures, imports, and purpose', async () => {
    const result = await getFileOverview(projectRoot, cache, {
      path: 'src/server.ts',
      detail: 'signatures',
    });

    expect(result.file).toBe('src/server.ts');
    expect(result.language).toBe('ts');
    expect(result.imports.length).toBeGreaterThan(0);
    expect(result.exports.some(e => e.name === 'createServer')).toBe(true);
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  it('serves cached file overview with imports, purpose and detail modes', async () => {
    // 1. Populate cache
    await getFileOverview(projectRoot, cache, { path: 'src/server.ts' });

    // 2. Fetch from cache with 'names' detail
    const namesResult = await getFileOverview(projectRoot, cache, {
      path: 'src/server.ts',
      detail: 'names',
    });

    expect(namesResult.imports.length).toBeGreaterThan(0);
    expect(namesResult.purpose).toBeDefined();
    expect(namesResult.symbols.length).toBeGreaterThan(0);
    expect(namesResult.symbols[0]?.signature).toBe('');

    // 3. Fetch from cache with 'signatures' detail
    const sigResult = await getFileOverview(projectRoot, cache, {
      path: 'src/server.ts',
      detail: 'signatures',
    });
    expect(sigResult.symbols[0]?.signature).not.toBe('');
  });

  it('throws for non-existent files', async () => {
    await expect(
      getFileOverview(projectRoot, cache, { path: 'src/non-existent.ts' })
    ).rejects.toThrow('File not found');
  });
});
