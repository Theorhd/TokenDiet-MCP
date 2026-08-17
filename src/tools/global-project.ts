import { getProjectSummary } from './project-summary.js';
import { getDirectoryTree } from './directory-tree.js';
import { getConfigDigest } from './config-digest.js';
import { getEntryPoints } from './entry-points.js';
import type { GlobalProjectOutput } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface GlobalProjectOptions {
  refresh?: boolean;
  depth?: number;
}

export async function getGlobalProject(
  root: string | undefined,
  cache: CacheManager,
  options: GlobalProjectOptions = {},
): Promise<GlobalProjectOutput> {
  const { refresh = false, depth = 3 } = options;
  const startTime = Date.now();

  // Run all four exploration tools in parallel
  const [summary, tree, configResult, entryResult] = await Promise.all([
    getProjectSummary(root, cache, refresh),
    getDirectoryTree(root, cache, { depth, includeTests: true, format: 'text', maxEntries: 200 }),
    getConfigDigest(root, cache, {}),
    getEntryPoints(root, cache),
  ]);

  const elapsedMs = Date.now() - startTime;

  return {
    summary,
    tree,
    configs: configResult.configs,
    entryPoints: entryResult.entryPoints,
    routes: entryResult.routes,
    cliCommands: entryResult.cliCommands,
    elapsedMs,
  };
}
