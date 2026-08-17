import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getGlobalProject } from '../../src/tools/global-project.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getGlobalProject', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('bundles summary, tree, configs, and entryPoints in a single response', async () => {
    const result = await getGlobalProject(projectRoot, cache, { depth: 3 });
    expect(result).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.summary.name).toBe('tokendiet-mcp');
    expect(result.tree).toContain('src/');
    expect(result.configs.length).toBeGreaterThan(0);
    expect(result.entryPoints.length).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
