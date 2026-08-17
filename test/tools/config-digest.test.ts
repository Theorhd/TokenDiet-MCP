import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfigDigest } from '../../src/tools/config-digest.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getConfigDigest', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('auto-detects project configs including package.json and tsconfig.json', async () => {
    const result = await getConfigDigest(projectRoot, cache, {});
    expect(result.configs.length).toBeGreaterThanOrEqual(2);

    const pkgConfig = result.configs.find(c => c.file === 'package.json');
    expect(pkgConfig).toBeDefined();
    expect(pkgConfig?.format).toBe('json');

    const tsConfig = result.configs.find(c => c.file === 'tsconfig.json');
    expect(tsConfig).toBeDefined();
    expect(tsConfig?.summary.target).toBeDefined();
  });

  it('parses TypeScript/JavaScript configs such as tsup.config.ts', async () => {
    const result = await getConfigDigest(projectRoot, cache, { path: 'tsup.config.ts' });
    expect(result.configs.length).toBe(1);
    expect(result.configs[0]?.file).toBe('tsup.config.ts');
    expect(result.configs[0]?.format).toBe('typescript');
  });

  it('handles single specific config file request', async () => {
    const result = await getConfigDigest(projectRoot, cache, { path: 'package.json' });
    expect(result.configs.length).toBe(1);
    expect(result.configs[0]?.file).toBe('package.json');
  });
});
