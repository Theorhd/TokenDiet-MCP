import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEntryPoints } from '../../src/tools/entry-points.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getEntryPoints', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('detects package.json main, bin, and cli scripts', async () => {
    const result = await getEntryPoints(projectRoot, cache);
    expect(result.entryPoints.length).toBeGreaterThan(0);

    const mainEntry = result.entryPoints.find(e => e.kind === 'main');
    expect(mainEntry).toBeDefined();

    const cliEntry = result.entryPoints.find(e => e.kind === 'cli');
    expect(cliEntry).toBeDefined();

    expect(result.cliCommands.some(c => c.name === 'tokendiet')).toBe(true);
    expect(result.cliCommands.some(c => c.name === 'build')).toBe(true);
  });

  it('detects test directories', async () => {
    const result = await getEntryPoints(projectRoot, cache);
    const testDir = result.entryPoints.find(e => e.kind === 'test');
    expect(testDir).toBeDefined();
    expect(testDir?.count).toBeGreaterThan(0);
  });
});
