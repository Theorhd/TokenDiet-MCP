import { resolve } from 'node:path';
import { resolveRoot, displayPath } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { readFileSafe, truncate } from '../core/utils.js';
import type { SymbolReferencesOutput, SymbolReference } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface SymbolReferencesOptions {
  symbol: string;
  path?: string;
  limit?: number;
}

export async function getSymbolReferences(
  root: string | undefined,
  cache: CacheManager,
  options: SymbolReferencesOptions,
): Promise<SymbolReferencesOutput> {
  const projectRoot = resolveRoot(root);
  const { symbol, path: defPath, limit = 30 } = options;

  if (!symbol || !symbol.trim()) {
    throw new Error('Symbol name is required');
  }

  const cleanSymbol = symbol.trim();
  const symbolRegex = new RegExp(`\\b${escapeRegExp(cleanSymbol)}\\b`);
  const walkResult = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const sourceFiles = walkResult.entries.filter(e =>
    !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'rb'].includes(e.lang),
  );

  const references: SymbolReference[] = [];

  for (const file of sourceFiles) {
    const content = readFileSafe(file.path);
    if (!content || !content.includes(cleanSymbol)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (symbolRegex.test(line)) {
        const trimmed = line.trim();
        const isImport = trimmed.startsWith('import ') || trimmed.startsWith('from ') ||
                         trimmed.startsWith('use ') || trimmed.startsWith('require(');

        references.push({
          file: file.relative,
          line: i + 1,
          preview: truncate(trimmed, 90),
          isImport,
        });

        if (references.length >= limit * 3) break;
      }
    }
    if (references.length >= limit * 3) break;
  }

  const totalReferences = references.length;
  const slicedRefs = references.slice(0, limit);

  return {
    symbol: cleanSymbol,
    references: slicedRefs,
    totalReferences,
    _truncated: totalReferences > limit ? `Showing ${limit} of ${totalReferences} references.` : undefined,
  };
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
