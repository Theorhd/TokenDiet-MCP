import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getArchitectureNotes } from '../../src/tools/architecture-notes.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getArchitectureNotes', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('extracts headings and concepts from README or architecture docs', async () => {
    const result = await getArchitectureNotes(projectRoot, cache, { maxWords: 500 });
    expect(result.found.length).toBeGreaterThan(0);
    expect(result.headings.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0]?.excerpt).toBeDefined();
  });
});
