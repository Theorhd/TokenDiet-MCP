import { resolveRoot } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { parseFile } from '../parsers/index.js';
import { readFileSafe } from '../core/utils.js';
import type { CacheManager } from '../core/cache.js';

export async function refreshIndex(
  root: string | undefined,
  cache: CacheManager,
): Promise<{ reindexed: number; removed: number; elapsedMs: number }> {
  const projectRoot = resolveRoot(root);
  const startTime = Date.now();

  // Clear existing
  const oldStats = cache.getStats();

  // Walk and re-index
  const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const validPaths = new Set<string>();
  let reindexed = 0;

  for (const entry of result.entries) {
    if (entry.isDir) continue;
    validPaths.add(entry.relative);

    const content = readFileSafe(entry.path);
    if (!content) continue;

    try {
      const parsed = parseFile(entry.path, content);
      cache.upsertFile(
        entry.relative,
        Date.now(), // mtime — we just read it
        entry.size,
        entry.lang,
        'regex',
        parsed.lines,
        parsed.bytes,
        parsed.precision,
        parsed.symbols,
        parsed.imports,
      );
      reindexed++;
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Remove stale entries
  const removed = cache.removeStaleFiles(validPaths);
  cache.setIndexed();

  const elapsedMs = Date.now() - startTime;

  return { reindexed, removed, elapsedMs };
}
