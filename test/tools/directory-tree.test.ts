import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDirectoryTree } from '../../src/tools/directory-tree.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getDirectoryTree', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('generates text format directory tree', async () => {
    const text = await getDirectoryTree(projectRoot, cache, { depth: 3, format: 'text' });
    expect(typeof text).toBe('string');
    expect(text).toContain('src/');
    expect(text).toContain('test/');
  });

  it('generates json format directory tree', async () => {
    const jsonStr = await getDirectoryTree(projectRoot, cache, { depth: 2, format: 'json' });
    const parsed = JSON.parse(jsonStr);
    expect(parsed.tree).toBeDefined();
    expect(parsed.tree['src/']).toBeDefined();
  });

  it('respects dirsOnly option', async () => {
    const text = await getDirectoryTree(projectRoot, cache, { depth: 2, dirsOnly: true });
    expect(text).toContain('src/');
    expect(text).not.toContain('package.json [');
  });
});
