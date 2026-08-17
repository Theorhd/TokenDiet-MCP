import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getModuleGraph } from '../../src/tools/module-graph.js';
import { CacheManager } from '../../src/core/cache.js';
import { resolve } from 'node:path';

describe('getModuleGraph', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('generates an aggregated module graph with nodes and external counts', async () => {
    const result = await getModuleGraph(projectRoot, cache, { aggregate: true });
    expect(result).toBeDefined();
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.external).toBeDefined();
    expect(result.external['@modelcontextprotocol/sdk']).toBeDefined();
  });

  it('resolves internal edges between TypeScript modules', async () => {
    const result = await getModuleGraph(projectRoot, cache, { aggregate: false });
    expect(result.nodes.length).toBeGreaterThan(0);
    // Should have edges connecting src/server.ts to src/tools/... or src/core/...
    expect(result.edges.length).toBeGreaterThan(0);
    const serverEdges = result.edges.filter(e => e.from === 'src/server.ts');
    expect(serverEdges.length).toBeGreaterThan(0);
    expect(serverEdges.some(e => e.to.startsWith('src/tools/'))).toBe(true);
  });

  it('supports focusing on a specific module', async () => {
    const result = await getModuleGraph(projectRoot, cache, { module: 'src/tools' });
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.every(n => n.id.startsWith('src/tools'))).toBe(true);
  });
});
