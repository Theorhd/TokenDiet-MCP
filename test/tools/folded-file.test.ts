import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFoldedFile } from '../../src/tools/folded-file.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getFoldedFile', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('folds function bodies while preserving file structure and signatures', async () => {
    const result = await getFoldedFile(projectRoot, cache, { path: 'src/server.ts' });
    expect(result.file).toBe('src/server.ts');
    expect(result.foldedLines).toBeGreaterThan(0);
    expect(result.content).toContain('lines folded');
    expect(result.content).toContain('createServer');
  });

  it('leaves specified unfoldSymbols intact', async () => {
    const result = await getFoldedFile(projectRoot, cache, {
      path: 'src/server.ts',
      unfoldSymbols: ['startServer'],
    });
    expect(result.file).toBe('src/server.ts');
    expect(result.content).toContain('startServer');
  });
});
