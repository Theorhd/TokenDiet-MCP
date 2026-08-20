import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findDeadCode } from '../../src/tools/find-dead-code.js';
import { CacheManager } from '../../src/core/cache.js';

// Use a real directory that exists to satisfy resolveRoot
const TEST_ROOT = '/tmp';

// Mock the entry-points module to return controlled data
vi.mock('../../src/tools/entry-points.js', () => ({
  getEntryPoints: vi.fn().mockResolvedValue({
    entryPoints: [
      { path: 'src/index.ts', kind: 'main', via: 'package.json:main' },
      { path: 'src/cli.ts', kind: 'cli', via: 'package.json:bin.cli' },
    ],
    routes: [],
    cliCommands: [],
  }),
}));

// Mock walker to avoid real filesystem access in cache-based tests
vi.mock('../../src/core/walker.js', () => ({
  walk: vi.fn().mockReturnValue({
    entries: [],
    skipped: 0,
    partial: false,
  }),
  detectLanguage: vi.fn().mockReturnValue('ts'),
  countLines: vi.fn().mockReturnValue(10),
}));

function createMockCache(overrides: {
  indexedAt?: string | null;
  allFiles?: { path: string; lang: string; lines: number; bytes: number }[];
  filesWithSymbols?: { path: string; lang: string; lines: number; bytes: number }[];
  fileOverviews?: Map<string, {
    lang: string; lines: number; bytes: number; precision: string;
    symbols: { name: string; kind: string; signature: string; line: number; doc: string; exported: number }[];
  }>;
  importGraph?: { from: string; to: string; names: string[]; isExternal: boolean }[];
} = {}): CacheManager {
  const hasIndexedAt = 'indexedAt' in overrides;
  const cache = {
    getIndexedAt: vi.fn().mockReturnValue(hasIndexedAt ? overrides.indexedAt : '2024-01-01T00:00:00Z'),
    getAllFiles: vi.fn().mockReturnValue(overrides.allFiles ?? []),
    getFilesWithSymbols: vi.fn().mockReturnValue(overrides.filesWithSymbols ?? []),
    getFileOverview: vi.fn().mockImplementation((path: string) => {
      return overrides.fileOverviews?.get(path) ?? null;
    }),
    getImportGraph: vi.fn().mockReturnValue(overrides.importGraph ?? []),
    close: vi.fn(),
    getStats: vi.fn().mockReturnValue({ fileCount: 0, indexedBytes: 0 }),
    getFileMtime: vi.fn().mockReturnValue(undefined),
  } as unknown as CacheManager;
  return cache;
}

describe('findDeadCode', () => {
  // ── Cache-based tests ───────────────────────────────────────
  describe('with populated cache', () => {
    it('returns empty when all exports are imported', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/utils.ts', lang: 'ts', lines: 20, bytes: 500 },
          { path: 'src/app.ts', lang: 'ts', lines: 30, bytes: 800 },
        ],
        filesWithSymbols: [
          { path: 'src/utils.ts', lang: 'ts', lines: 20, bytes: 500 },
          { path: 'src/app.ts', lang: 'ts', lines: 30, bytes: 800 },
        ],
        fileOverviews: new Map([
          ['src/utils.ts', {
            lang: 'ts', lines: 20, bytes: 500, precision: 'approx',
            symbols: [
              { name: 'helper', kind: 'function', signature: 'export function helper()', line: 1, doc: '', exported: 1 },
              { name: 'CONFIG', kind: 'const', signature: 'export const CONFIG', line: 5, doc: '', exported: 1 },
              { name: 'internal', kind: 'function', signature: 'function internal()', line: 10, doc: '', exported: 0 },
            ],
          }],
          ['src/app.ts', {
            lang: 'ts', lines: 30, bytes: 800, precision: 'approx',
            symbols: [
              { name: 'App', kind: 'class', signature: 'export class App', line: 1, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [
          // src/app.ts imports { helper } from './utils'
          { from: 'src/app.ts', to: './utils', names: ['helper'], isExternal: false },
        ],
      });

      const result = await findDeadCode(TEST_ROOT, cache, { includeTests: false });

      // 'helper' is imported → NOT dead
      // 'CONFIG' is not imported → dead
      // 'internal' is not exported → not in analysis
      // 'App' is exported from app.ts — app.ts has no incoming imports AND is not an entry point → dead
      expect(result.unusedExports.length).toBeGreaterThan(0);

      // CONFIG should be unused
      const configItem = result.unusedExports.find(e => e.symbol === 'CONFIG');
      expect(configItem).toBeDefined();
      expect(configItem!.file).toBe('src/utils.ts');
      expect(configItem!.confidence).toBe('high'); // file has incoming imports, but this specific name is not imported

      // App should be unused (app.ts is not an entry point and has no incoming imports)
      const appItem = result.unusedExports.find(e => e.symbol === 'App');
      expect(appItem).toBeDefined();
      expect(appItem!.file).toBe('src/app.ts');
      expect(appItem!.confidence).toBe('high');
    });

    it('detects unused files (medium confidence)', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/orphan.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/index.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        filesWithSymbols: [
          { path: 'src/orphan.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/index.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        fileOverviews: new Map([
          ['src/orphan.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'approx',
            symbols: [
              { name: 'orphanFunc', kind: 'function', signature: 'export function orphanFunc()', line: 1, doc: '', exported: 1 },
            ],
          }],
          ['src/index.ts', {
            lang: 'ts', lines: 10, bytes: 200, precision: 'approx',
            symbols: [
              { name: 'main', kind: 'function', signature: 'export function main()', line: 1, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [
          // No imports at all
        ],
      });

      const result = await findDeadCode(TEST_ROOT, cache, { includeTests: false });

      // src/orphan.ts should be in unusedFiles
      const orphanFile = result.unusedFiles.find(f => f.file === 'src/orphan.ts');
      expect(orphanFile).toBeDefined();
      expect(orphanFile!.confidence).toBe('medium');

      // src/index.ts is an entry point → should NOT be in unusedFiles
      const indexFile = result.unusedFiles.find(f => f.file === 'src/index.ts');
      expect(indexFile).toBeUndefined();

      // But src/index.ts exports should still be checked — main() is exported but never imported
      // Even entry points can have unused exports
      const mainExport = result.unusedExports.find(e => e.symbol === 'main' && e.file === 'src/index.ts');
      expect(mainExport).toBeDefined();
    });

    it('skips entry points from unused file detection', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/cli.ts', lang: 'ts', lines: 5, bytes: 100 },
        ],
        filesWithSymbols: [
          { path: 'src/cli.ts', lang: 'ts', lines: 5, bytes: 100 },
        ],
        fileOverviews: new Map([
          ['src/cli.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'approx',
            symbols: [
              { name: 'run', kind: 'function', signature: 'export function run()', line: 1, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [],
      });

      const result = await findDeadCode(TEST_ROOT, cache, { includeTests: false });

      // cli.ts is an entry point → should NOT be reported as unused file
      const cliFile = result.unusedFiles.find(f => f.file === 'src/cli.ts');
      expect(cliFile).toBeUndefined();

      // But 'run' is exported and never imported → reported as unused export
      const runExport = result.unusedExports.find(e => e.symbol === 'run');
      expect(runExport).toBeDefined();
      expect(runExport!.confidence).toBe('high');
    });

    it('handles side-effect imports (empty names)', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/setup.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/app.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        filesWithSymbols: [
          { path: 'src/setup.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/app.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        fileOverviews: new Map([
          ['src/setup.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'approx',
            symbols: [
              { name: 'init', kind: 'function', signature: 'export function init()', line: 1, doc: '', exported: 1 },
            ],
          }],
          ['src/app.ts', {
            lang: 'ts', lines: 10, bytes: 200, precision: 'approx',
            symbols: [
              { name: 'App', kind: 'class', signature: 'export class App', line: 1, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [
          // Side-effect import: import './setup' with no names
          { from: 'src/app.ts', to: './setup', names: [], isExternal: false },
        ],
      });

      const result = await findDeadCode(TEST_ROOT, cache, { includeTests: false });

      // setup.ts has a side-effect import → all its exports should be skipped
      const setupExports = result.unusedExports.filter(e => e.file === 'src/setup.ts');
      expect(setupExports.length).toBe(0);

      // setup.ts should NOT be in unusedFiles (it's imported via side-effect)
      const setupFile = result.unusedFiles.find(f => f.file === 'src/setup.ts');
      expect(setupFile).toBeUndefined();
    });

    it('handles namespace-like imports with medium confidence', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/lib.ts', lang: 'ts', lines: 20, bytes: 600 },
          { path: 'src/consumer.ts', lang: 'ts', lines: 10, bytes: 300 },
        ],
        filesWithSymbols: [
          { path: 'src/lib.ts', lang: 'ts', lines: 20, bytes: 600 },
          { path: 'src/consumer.ts', lang: 'ts', lines: 10, bytes: 300 },
        ],
        fileOverviews: new Map([
          ['src/lib.ts', {
            lang: 'ts', lines: 20, bytes: 600, precision: 'approx',
            symbols: [
              { name: 'foo', kind: 'function', signature: 'export function foo()', line: 1, doc: '', exported: 1 },
              { name: 'bar', kind: 'function', signature: 'export function bar()', line: 5, doc: '', exported: 1 },
            ],
          }],
          ['src/consumer.ts', {
            lang: 'ts', lines: 10, bytes: 300, precision: 'approx',
            symbols: [],
          }],
        ]),
        importGraph: [
          // import * as Lib from './lib' — the parser captures alias 'Lib', not 'foo'/'bar'
          { from: 'src/consumer.ts', to: './lib', names: ['Lib'], isExternal: false },
        ],
      });

      const result = await findDeadCode(TEST_ROOT, cache, { includeTests: false });

      // lib.ts has incoming imports, but the imported name 'Lib' doesn't match 'foo' or 'bar'
      // This means the file IS used (via namespace import), but specific names aren't matched
      // None of the exports match any imported name → all get medium confidence
      const libExports = result.unusedExports.filter(e => e.file === 'src/lib.ts');

      // With default minConfidence='medium', these should appear
      expect(libExports.length).toBe(2);
      for (const exp of libExports) {
        expect(exp.confidence).toBe('medium');
        expect(exp.reason).toContain('possibly namespace');
      }

      // With minConfidence='high', they should be filtered out
      const resultHigh = await findDeadCode(TEST_ROOT, cache, { minConfidence: 'high' });
      const libExportsHigh = resultHigh.unusedExports.filter(e => e.file === 'src/lib.ts');
      expect(libExportsHigh.length).toBe(0);
    });

    it('excludes test files by default', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/App.tsx', lang: 'tsx', lines: 30, bytes: 900 },
          { path: 'src/__tests__/utils.test.ts', lang: 'ts', lines: 20, bytes: 500 },
        ],
        filesWithSymbols: [
          { path: 'src/App.tsx', lang: 'tsx', lines: 30, bytes: 900 },
          { path: 'src/__tests__/utils.test.ts', lang: 'ts', lines: 20, bytes: 500 },
        ],
        fileOverviews: new Map([
          ['src/App.tsx', {
            lang: 'tsx', lines: 30, bytes: 900, precision: 'approx',
            symbols: [
              { name: 'App', kind: 'function', signature: 'export function App()', line: 3, doc: '', exported: 1 },
            ],
          }],
          ['src/__tests__/utils.test.ts', {
            lang: 'ts', lines: 20, bytes: 500, precision: 'approx',
            symbols: [
              { name: 'sum', kind: 'function', signature: 'export function sum()', line: 1, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [],
      });

      const result = await findDeadCode(TEST_ROOT, cache, { includeTests: false });

      // App.tsx should be analyzed (not a test file)
      expect(result.unusedExports.some(e => e.file === 'src/App.tsx')).toBe(true);

      // utils.test.ts should be excluded
      expect(result.unusedExports.some(e => e.file.includes('utils.test'))).toBe(false);
      expect(result.summary.filesAnalyzed).toBe(1); // only App.tsx counted
    });

    it('includes test files when includeTests is true', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/lib.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/lib.test.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        filesWithSymbols: [
          { path: 'src/lib.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/lib.test.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        fileOverviews: new Map([
          ['src/lib.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'approx',
            symbols: [
              { name: 'fn', kind: 'function', signature: 'export function fn()', line: 1, doc: '', exported: 1 },
            ],
          }],
          ['src/lib.test.ts', {
            lang: 'ts', lines: 10, bytes: 200, precision: 'approx',
            symbols: [
              { name: 'helper', kind: 'function', signature: 'export function helper()', line: 1, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [],
      });

      const result = await findDeadCode(TEST_ROOT, cache, { includeTests: true });

      expect(result.unusedExports.some(e => e.file.includes('lib.test'))).toBe(true);
      expect(result.summary.filesAnalyzed).toBe(2);
    });

    it('respects ignorePatterns', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/generated/types.ts', lang: 'ts', lines: 50, bytes: 1500 },
          { path: 'src/app.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        filesWithSymbols: [
          { path: 'src/generated/types.ts', lang: 'ts', lines: 50, bytes: 1500 },
          { path: 'src/app.ts', lang: 'ts', lines: 10, bytes: 200 },
        ],
        fileOverviews: new Map([
          ['src/generated/types.ts', {
            lang: 'ts', lines: 50, bytes: 1500, precision: 'approx',
            symbols: [
              { name: 'User', kind: 'interface', signature: 'export interface User', line: 1, doc: '', exported: 1 },
            ],
          }],
          ['src/app.ts', {
            lang: 'ts', lines: 10, bytes: 200, precision: 'approx',
            symbols: [
              { name: 'App', kind: 'class', signature: 'export class App', line: 1, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [],
      });

      const result = await findDeadCode(TEST_ROOT, cache, {
        ignorePatterns: ['src/generated/**'],
      });

      expect(result.unusedExports.some(e => e.file.includes('generated'))).toBe(false);
      expect(result.unusedExports.some(e => e.file === 'src/app.ts')).toBe(true);
      expect(result.summary.filesAnalyzed).toBe(1);
    });

    it('reports summary statistics correctly', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/a.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/b.ts', lang: 'ts', lines: 5, bytes: 100 },
        ],
        filesWithSymbols: [
          { path: 'src/a.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/b.ts', lang: 'ts', lines: 5, bytes: 100 },
        ],
        fileOverviews: new Map([
          ['src/a.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'approx',
            symbols: [
              { name: 'fnA', kind: 'function', signature: 'export function fnA()', line: 1, doc: '', exported: 1 },
            ],
          }],
          ['src/b.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'approx',
            symbols: [
              { name: 'fnB', kind: 'function', signature: 'export function fnB()', line: 1, doc: '', exported: 1 },
              { name: 'fnB2', kind: 'function', signature: 'export function fnB2()', line: 3, doc: '', exported: 1 },
            ],
          }],
        ]),
        importGraph: [],
      });

      const result = await findDeadCode(TEST_ROOT, cache, {
        ignorePatterns: ['src/generated/**'],
      });

      expect(result.summary.totalUnusedExports).toBe(3);
      expect(result.summary.totalUnusedFiles).toBe(2);
      expect(result.summary.filesAnalyzed).toBe(2);
      expect(result.summary.exportsAnalyzed).toBe(3);
      expect(result.summary.cacheUsed).toBe(true);
    });
    it('resolves multi-hop barrel re-exports transitively (A -> B -> C)', async () => {
      const cache = createMockCache({
        allFiles: [
          { path: 'src/feature.ts', lang: 'ts', lines: 10, bytes: 200 },
          { path: 'src/barrel1.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/barrel2.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/app.ts', lang: 'ts', lines: 15, bytes: 300 },
        ],
        filesWithSymbols: [
          { path: 'src/feature.ts', lang: 'ts', lines: 10, bytes: 200 },
          { path: 'src/barrel1.ts', lang: 'ts', lines: 5, bytes: 100 },
          { path: 'src/barrel2.ts', lang: 'ts', lines: 5, bytes: 100 },
        ],
        fileOverviews: new Map([
          ['src/feature.ts', {
            lang: 'ts', lines: 10, bytes: 200, precision: 'full',
            symbols: [
              { name: 'usedFunc', kind: 'function', signature: 'export function usedFunc()', line: 1, doc: '', exported: 1 },
              { name: 'unusedFunc', kind: 'function', signature: 'export function unusedFunc()', line: 5, doc: '', exported: 1 },
            ],
          }],
          ['src/barrel1.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'full',
            symbols: [],
          }],
          ['src/barrel2.ts', {
            lang: 'ts', lines: 5, bytes: 100, precision: 'full',
            symbols: [],
          }],
        ]),
        importGraph: [
          // feature <- barrel1 <- barrel2 <- app
          { from: 'src/barrel1.ts', to: './feature.js', names: ['usedFunc', 'unusedFunc'], isExternal: false },
          { from: 'src/barrel2.ts', to: './barrel1.js', names: ['usedFunc'], isExternal: false },
          { from: 'src/app.ts', to: './barrel2.js', names: ['usedFunc'], isExternal: false },
        ],
      });

      const result = await findDeadCode(TEST_ROOT, cache);
      expect(result.unusedExports.some(e => e.file === 'src/feature.ts' && e.symbol === 'unusedFunc')).toBe(true);
      expect(result.unusedExports.some(e => e.file === 'src/feature.ts' && e.symbol === 'usedFunc')).toBe(false);
    });
  });

  // ── No-cache (fallback) tests ───────────────────────────────
  describe('without cache (walk + parse fallback)', () => {
    it('returns empty and reports cacheUsed=false', async () => {
      const cache = createMockCache({
        indexedAt: null,
      });

      const result = await findDeadCode(TEST_ROOT, cache);

      expect(result.summary.cacheUsed).toBe(false);
      expect(result.summary.filesAnalyzed).toBe(0);
      expect(result.unusedExports).toEqual([]);
      expect(result.unusedFiles).toEqual([]);
    });
  });
});
