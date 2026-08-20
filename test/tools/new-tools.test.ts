import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { CacheManager } from '../../src/core/cache.js';
import { getImpactAnalysis } from '../../src/tools/impact-analysis.js';
import { getDiffSummary } from '../../src/tools/diff-summary.js';
import { getWorkspaces } from '../../src/tools/workspaces.js';

describe('New MCP Tools (impact-analysis, diff-summary, workspaces)', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    cache = new CacheManager(projectRoot);
  });

  afterEach(() => {
    cache.close();
  });

  it('getImpactAnalysis calculates dependents and test files for a core file', async () => {
    const res = await getImpactAnalysis(projectRoot, cache, { path: 'src/core/cache.ts' });
    expect(res.target).toBe('src/core/cache.ts');
    expect(Array.isArray(res.directDependents)).toBe(true);
    expect(Array.isArray(res.indirectDependents)).toBe(true);
    expect(Array.isArray(res.impactedTests)).toBe(true);
    expect(typeof res.totalImpactedFiles).toBe('number');
    expect(['low', 'medium', 'high', 'critical']).toContain(res.blastRadius);
  });

  it('getDiffSummary generates a compact change digest and impact highlights', async () => {
    const res = await getDiffSummary(projectRoot, cache, {});
    expect(res.branch).toBeDefined();
    expect(typeof res.filesChanged).toBe('number');
    expect(typeof res.totalAddedSymbols).toBe('number');
    expect(typeof res.summaryText).toBe('string');
    expect(res.summaryText).toContain('Git Branch:');
  });

  it('getWorkspaces analyzes monorepo topology or reports single-project', async () => {
    const res = await getWorkspaces(projectRoot);
    expect(typeof res.isMonorepo).toBe('boolean');
    expect(Array.isArray(res.packages)).toBe(true);
    expect(typeof res.totalPackages).toBe('number');
  });
});
