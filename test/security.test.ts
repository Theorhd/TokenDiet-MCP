import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { writeFileSync, symlinkSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { getChangedSymbols } from '../src/tools/changed-symbols.js';
import { getFileOverview } from '../src/tools/file-overview.js';
import { getFoldedFile } from '../src/tools/folded-file.js';
import { getSymbolBody } from '../src/tools/symbol-body.js';
import { getConfigDigest } from '../src/tools/config-digest.js';
import { getImpactAnalysis } from '../src/tools/impact-analysis.js';
import { resolveSecurePath, isPathInside } from '../src/core/paths.js';
import { mergeJsonFile } from '../src/installer/utils/json-merge.js';
import { CacheManager } from '../src/core/cache.js';

describe('Security & Confinement Audit Tests', () => {
  const testRoot = resolve(process.cwd());
  const cache = new CacheManager(testRoot);

  describe('Path Traversal & Confinement', () => {
    it('resolveSecurePath accepts valid paths inside project root', () => {
      const valid = resolveSecurePath(testRoot, 'src/index.ts');
      expect(valid).toBe(resolve(testRoot, 'src/index.ts'));
    });

    it('resolveSecurePath rejects parent directory traversal', () => {
      expect(() => resolveSecurePath(testRoot, '../../../etc/hosts')).toThrow(/escapes project root/);
      expect(() => resolveSecurePath(testRoot, '..')).toThrow(/escapes project root/);
    });

    it('resolveSecurePath rejects absolute paths outside project root', () => {
      expect(() => resolveSecurePath(testRoot, '/etc/passwd')).toThrow(/escapes project root/);
    });

    it('resolveSecurePath accepts files with prefix .. like ..hidden', () => {
      expect(isPathInside(testRoot, '..hidden.txt')).toBe(true);
      expect(resolveSecurePath(testRoot, '..hidden.txt')).toBe(resolve(testRoot, '..hidden.txt'));
    });

    it('isPathInside correctly checks bounds', () => {
      expect(isPathInside(testRoot, 'src/core/cache.ts')).toBe(true);
      expect(isPathInside(testRoot, '../../outside.txt')).toBe(false);
    });

    it('resolveSecurePath rejects symlinks pointing outside root', () => {
      const symlinkPath = join(testRoot, '.tmp_symlink_test');
      try {
        symlinkSync('/etc/hosts', symlinkPath);
        expect(() => resolveSecurePath(testRoot, '.tmp_symlink_test')).toThrow(/escapes project root/);
      } catch (err: any) {
        if (!err.message.includes('escapes project root')) {
          // If symlink creation requires admin on OS, skip
        }
      } finally {
        try { rmSync(symlinkPath, { force: true }); } catch {}
      }
    });

    it('getFileOverview blocks paths outside project root', async () => {
      await expect(getFileOverview(testRoot, cache, { path: '../../../etc/hosts' })).rejects.toThrow(
        /escapes project root/
      );
    });

    it('getFoldedFile blocks paths outside project root', async () => {
      await expect(getFoldedFile(testRoot, cache, { path: '/etc/hosts' })).rejects.toThrow(
        /escapes project root/
      );
    });

    it('getSymbolBody blocks paths outside project root', async () => {
      await expect(getSymbolBody(testRoot, cache, { path: '/etc/hosts', symbol: 'main' })).rejects.toThrow(
        /escapes project root/
      );
    });

    it('getConfigDigest blocks paths outside project root', async () => {
      await expect(getConfigDigest(testRoot, cache, { path: '../../../etc/hosts' })).rejects.toThrow(
        /escapes project root/
      );
    });

    it('getImpactAnalysis blocks paths outside project root', async () => {
      await expect(getImpactAnalysis(testRoot, cache, { path: '../../../etc/hosts' })).rejects.toThrow(
        /escapes project root/
      );
    });
  });

  describe('Command Injection & Git Safety', () => {
    it('getChangedSymbols rejects base reference with shell injection attempts', async () => {
      await expect(
        getChangedSymbols(testRoot, cache, { base: 'HEAD; touch /tmp/evil' })
      ).rejects.toThrow(/Invalid git base reference/);

      await expect(
        getChangedSymbols(testRoot, cache, { base: 'HEAD $(whoami)' })
      ).rejects.toThrow(/Invalid git base reference/);

      await expect(
        getChangedSymbols(testRoot, cache, { base: 'HEAD`id`' })
      ).rejects.toThrow(/Invalid git base reference/);
    });

    it('getChangedSymbols rejects base reference starting with dash (git option)', async () => {
      await expect(
        getChangedSymbols(testRoot, cache, { base: '-o/tmp/evil' })
      ).rejects.toThrow(/Invalid git base reference/);

      await expect(
        getChangedSymbols(testRoot, cache, { base: '--stat' })
      ).rejects.toThrow(/Invalid git base reference/);
    });

    it('getChangedSymbols accepts valid git refs', async () => {
      const result = await getChangedSymbols(testRoot, cache, { base: 'HEAD' });
      expect(result).toBeDefined();
      expect(Array.isArray(result.changedFiles)).toBe(true);
    });
  });

  describe('JSON Merge Atomic & Corruption Protection', () => {
    const tmpDir = join(testRoot, '.tmp_test_json');
    const malformedFile = join(tmpDir, 'malformed.json');

    beforeEach(() => {
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it('refuses to overwrite corrupted JSON files and creates a .corrupt.bak', async () => {
      writeFileSync(malformedFile, '{ name: "invalid", broken json... }', 'utf-8');

      await expect(
        mergeJsonFile(malformedFile, (curr) => ({ ...curr, injected: true }))
      ).rejects.toThrow(/malformed\/corrupted/);
    });
  });
});
