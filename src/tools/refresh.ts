import { statSync } from 'node:fs';
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

  // Walk and re-index
  const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const validPaths = new Set<string>();
  let reindexed = 0;

  cache.withTransaction(() => {
    for (const entry of result.entries) {
      if (entry.isDir) continue;
      validPaths.add(entry.relative);

      let mtimeMs = Date.now();
      try {
        const st = statSync(entry.path);
        mtimeMs = st.mtimeMs;
      } catch {
        // Fallback
      }
      const floorMtime = Math.floor(mtimeMs);

      // Incremental indexing: skip reading and parsing if file is unmodified
      if (cache.isFileUnchanged(entry.relative, floorMtime, entry.size)) {
        continue;
      }

      const content = readFileSafe(entry.path);
      if (!content) continue;

      try {
        const parsed = parseFile(entry.path, content);
        cache.upsertFile(
          entry.relative,
          floorMtime,
          entry.size,
          entry.lang,
          parsed.tier ?? 'regex',
          parsed.lines,
          parsed.bytes,
          parsed.precision,
          parsed.symbols,
          parsed.imports,
          parsed.purpose,
        );
        reindexed++;
      } catch {
        // Skip files that can't be parsed
      }
    }
  });

  // Remove stale entries
  const removed = cache.removeStaleFiles(validPaths);
  cache.setIndexed();

  const elapsedMs = Date.now() - startTime;

  return { reindexed, removed, elapsedMs };
}
