import { resolve } from 'node:path';
import { resolveRoot, displayPath } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { readFileSafe } from '../core/utils.js';
import { parseFile } from '../parsers/index.js';
import type { TypeDefinitionsOutput, TypeDefItem, SymbolKind } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface TypeDefinitionsOptions {
  path?: string;
  limit?: number;
}

const TYPE_KINDS = new Set<SymbolKind>(['interface', 'type', 'enum', 'struct', 'trait']);

export async function getTypeDefinitions(
  root: string | undefined,
  cache: CacheManager,
  options: TypeDefinitionsOptions = {},
): Promise<TypeDefinitionsOutput> {
  const projectRoot = resolveRoot(root);
  const { path: targetPath, limit = 50 } = options;

  const results: TypeDefItem[] = [];

  // Try cache first
  const indexedAt = cache.getIndexedAt();
  if (indexedAt) {
    for (const kind of TYPE_KINDS) {
      const symbols = cache.searchSymbols('', kind, limit * 5);
      for (const sym of symbols) {
        if (targetPath && !sym.file.startsWith(targetPath.replace(/\/$/, '')) && sym.file !== targetPath) {
          continue;
        }
        results.push({
          name: sym.name,
          kind: sym.kind as SymbolKind,
          file: sym.file,
          line: sym.line,
          signature: sym.signature,
          doc: '',
        });
      }
    }
  } else {
    // Fallback scan
    const walkResult = walk(projectRoot, { maxDepth: 8, includeTests: false });
    const sourceFiles = walkResult.entries.filter(e =>
      !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java'].includes(e.lang),
    );

    for (const file of sourceFiles) {
      if (targetPath && !file.relative.startsWith(targetPath.replace(/\/$/, '')) && file.relative !== targetPath) {
        continue;
      }

      const content = readFileSafe(file.path);
      if (!content) continue;

      const parsed = parseFile(file.path, content);
      for (const sym of parsed.symbols) {
        if (TYPE_KINDS.has(sym.kind)) {
          results.push({
            name: sym.name,
            kind: sym.kind,
            file: file.relative,
            line: sym.line,
            signature: sym.signature,
            doc: sym.doc,
          });
        }
      }
    }
  }

  // Deduplicate and sort by file and line
  const seen = new Set<string>();
  const uniqueTypes = results.filter(t => {
    const key = `${t.file}:${t.name}:${t.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  uniqueTypes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const totalTypes = uniqueTypes.length;
  const types = uniqueTypes.slice(0, limit);

  return {
    types,
    totalTypes,
    _truncated: totalTypes > limit ? `Showing ${limit} of ${totalTypes} types. Narrow down with 'path' parameter.` : undefined,
  };
}
