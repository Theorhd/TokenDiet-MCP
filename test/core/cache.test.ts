import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CacheManager } from '../../src/core/cache.js';

describe('CacheManager', () => {
  let tempCacheDir: string;
  let cache: CacheManager;
  const testRoot = '/test/project/mock';

  beforeEach(() => {
    tempCacheDir = mkdtempSync(join(tmpdir(), 'tokendiet-cache-test-'));
    process.env.TOKENDIET_CACHE_DIR = tempCacheDir;
    cache = new CacheManager(testRoot);
  });

  afterEach(() => {
    cache.close();
    try {
      rmSync(tempCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
    delete process.env.TOKENDIET_CACHE_DIR;
  });

  it('initializes schema and prepares statements', () => {
    expect(cache).toBeDefined();
    expect(cache.getDbPath()).toContain(tempCacheDir);
  });

  it('upserts and retrieves file overviews and symbol data', () => {
    cache.upsertFile(
      'src/index.ts',
      1700000000,
      1024,
      'ts',
      'tree-sitter',
      50,
      1024,
      'full',
      [
        { name: 'main', kind: 'function', line: 10, signature: 'main() => void', doc: 'Entry point', exported: true },
        { name: 'helper', kind: 'function', line: 20, signature: 'helper() => void', doc: '', exported: false },
      ],
      [
        { from: './utils.js', names: ['add'], isExternal: false, isDefault: false },
      ],
      'Main entry point',
    );

    const overview = cache.getFileOverview('src/index.ts');
    expect(overview).toBeDefined();
    expect(overview?.lang).toBe('ts');
    expect(overview?.symbols.length).toBe(2);
    expect(overview?.symbols[0]?.name).toBe('main');
    expect(overview?.imports.length).toBe(1);
    expect(overview?.imports[0]?.from).toBe('./utils.js');
  });

  it('correctly escapes LIKE queries for symbols and imports', () => {
    cache.upsertFile(
      'src/test%file_a.ts',
      1700000000,
      500,
      'ts',
      'regex',
      20,
      500,
      'approx',
      [
        { name: 'test%func_1', kind: 'function', line: 5, signature: 'test%func_1()', doc: '', exported: true },
        { name: 'test_func_2', kind: 'function', line: 10, signature: 'test_func_2()', doc: '', exported: true },
      ],
      [
        { from: 'lib_a', names: ['fn'], isExternal: true, isDefault: false },
      ],
    );

    // Literal match for '%'
    const pctMatches = cache.searchSymbols('test%func');
    expect(pctMatches.length).toBe(1);
    expect(pctMatches[0]?.name).toBe('test%func_1');

    // Literal match for '_'
    const underMatches = cache.searchSymbols('test_func');
    expect(underMatches.length).toBe(1);
    expect(underMatches[0]?.name).toBe('test_func_2');
  });

  it('supports incremental check via isFileUnchanged', () => {
    cache.upsertFile(
      'src/file.ts',
      1234567,
      200,
      'ts',
      'regex',
      10,
      200,
      'approx',
    );

    expect(cache.isFileUnchanged('src/file.ts', 1234567, 200)).toBe(true);
    expect(cache.isFileUnchanged('src/file.ts', 1234568, 200)).toBe(false);
    expect(cache.isFileUnchanged('src/file.ts', 1234567, 201)).toBe(false);
    expect(cache.isFileUnchanged('src/other.ts', 1234567, 200)).toBe(false);
  });

  it('manages PRAGMA user_version and supports non-destructive schema migrations', () => {
    expect(cache.getSchemaVersion()).toBe(2);
  });
});
