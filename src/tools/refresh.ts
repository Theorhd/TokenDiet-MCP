import { statSync } from 'node:fs';
import { resolveRoot } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { workerPool } from '../parsers/worker-pool.js';
import { readFileSafe } from '../core/utils.js';
import type { CacheManager } from '../core/cache.js';

interface PendingIndexItem {
  relative: string;
  fullPath: string;
  floorMtime: number;
  size: number;
  lang: string;
  content: string;
}

export async function refreshIndex(
  root: string | undefined,
  cache: CacheManager,
): Promise<{ reindexed: number; removed: number; elapsedMs: number }> {
  const projectRoot = resolveRoot(root);
  const startTime = Date.now();

  // Walk directory
  const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const validPaths = new Set<string>();
  const pendingItems: PendingIndexItem[] = [];

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

    pendingItems.push({
      relative: entry.relative,
      fullPath: entry.path,
      floorMtime,
      size: entry.size,
      lang: entry.lang,
      content,
    });
  }

  // Parse in parallel via worker pool if batch size is large enough
  const parseTasks = pendingItems.map(item => ({
    filePath: item.fullPath,
    content: item.content,
  }));

  const parseResults = await workerPool.parseBatch(parseTasks);
  const parseResultMap = new Map(parseResults.map(r => [r.filePath, r.parsed]));

  let reindexed = 0;
  cache.withTransaction(() => {
    for (const item of pendingItems) {
      const parsed = parseResultMap.get(item.fullPath);
      if (!parsed) continue;

      cache.upsertFile(
        item.relative,
        item.floorMtime,
        item.size,
        item.lang,
        parsed.tier ?? 'regex',
        parsed.lines,
        parsed.bytes,
        parsed.precision,
        parsed.symbols,
        parsed.imports,
        parsed.purpose,
      );
      reindexed++;
    }
  });

  // Remove stale entries
  const removed = cache.removeStaleFiles(validPaths);
  cache.setIndexed();

  const elapsedMs = Date.now() - startTime;
  return { reindexed, removed, elapsedMs };
}
