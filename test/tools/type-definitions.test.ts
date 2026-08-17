import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTypeDefinitions } from '../../src/tools/type-definitions.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getTypeDefinitions', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('aggregates types, interfaces and structs across the project', async () => {
    const result = await getTypeDefinitions(projectRoot, cache, { limit: 20 });
    expect(result.types.length).toBeGreaterThan(0);
    expect(result.totalTypes).toBeGreaterThan(0);
    expect(result.types.some(t => t.kind === 'interface' || t.kind === 'type')).toBe(true);
  });

  it('filters types to a specific directory or file', async () => {
    const result = await getTypeDefinitions(projectRoot, cache, { path: 'src/types/index.ts' });
    expect(result.types.length).toBeGreaterThan(0);
    expect(result.types.every(t => t.file.startsWith('src/types/'))).toBe(true);
  });
});
