import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { searchSymbols } from '../../src/tools/search-symbols.js';
import { refreshIndex } from '../../src/tools/refresh.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('searchSymbols', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeAll(async () => {
    cache = new CacheManager(projectRoot);
    await refreshIndex(projectRoot, cache);
  });

  afterAll(() => {
    cache.close();
  });

  it('finds symbols by query substring', async () => {
    const result = await searchSymbols(projectRoot, cache, { query: 'createServer' });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some(m => m.name === 'createServer')).toBe(true);
  });

  it('filters symbols by kind', async () => {
    const result = await searchSymbols(projectRoot, cache, { query: 'CacheManager', kind: 'class' });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.kind).toBe('class');
  });

  it('filters symbols by filePattern', async () => {
    const result = await searchSymbols(projectRoot, cache, {
      query: 'parse',
      filePattern: 'src/parsers/**',
    });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every(m => m.file.startsWith('src/parsers/'))).toBe(true);
  });
});
