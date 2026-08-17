import { resolveRoot, displayPath } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { parseFile } from '../parsers/index.js';
import { readFileSafe } from '../core/utils.js';
import type { SearchOutput, SearchResult, SymbolKind } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface SearchSymbolsOptions {
  query: string;
  kind?: string;
  language?: string;
  filePattern?: string;
  limit?: number;
}

export async function searchSymbols(
  root: string | undefined,
  cache: CacheManager,
  options: SearchSymbolsOptions,
): Promise<SearchOutput> {
  const projectRoot = resolveRoot(root);
  const {
    query,
    kind,
    language,
    filePattern,
    limit = 30,
  } = options;

  // Try cache first
  const cachedResults = cache.searchSymbols(query, kind, limit * 10, filePattern);

  if (cachedResults.length > 0) {
    let matches: SearchResult[] = cachedResults.map(r => ({
      name: r.name,
      kind: r.kind as SymbolKind,
      file: r.file,
      line: r.line,
      signature: r.signature,
    }));

    // Apply additional filters
    if (language) {
      matches = matches.filter(m => {
        const ext = m.file.split('.').pop()?.toLowerCase();
        return ext && isLanguageMatch(ext, language);
      });
    }
    if (filePattern) {
      const regexPattern = '^' + filePattern.replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*') + '$';
      const pattern = new RegExp(regexPattern, 'i');
      matches = matches.filter(m => pattern.test(m.file));
    }

    const totalMatches = matches.length;
    matches = matches.slice(0, limit);

    return {
      matches,
      totalMatches,
      truncated: totalMatches > limit ? totalMatches - limit : 0,
    };
  }

  // Fallback: brute-force scan (only for fresh projects)
  const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const sourceFiles = result.entries.filter(e =>
    !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'rb'].includes(e.lang),
  );

  const allMatches: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const file of sourceFiles) {
    if (language && !isLanguageMatch(file.lang, language)) continue;
    if (filePattern) {
      const regexPattern = '^' + filePattern.replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*') + '$';
      const pattern = new RegExp(regexPattern, 'i');
      if (!pattern.test(file.relative)) continue;
    }

    const content = readFileSafe(file.path);
    if (!content) continue;

    const parsed = parseFile(file.path, content);

    for (const sym of parsed.symbols) {
      if (sym.name.toLowerCase().includes(queryLower)) {
        if (kind && kind !== 'all' && sym.kind !== kind) continue;
        allMatches.push({
          name: sym.name,
          kind: sym.kind,
          file: file.relative,
          line: sym.line,
          signature: sym.signature,
        });
      }
    }

    if (allMatches.length >= limit * 3) break;
  }

  const totalMatches = allMatches.length;
  const matches = allMatches.slice(0, limit);

  return { matches, totalMatches, truncated: totalMatches > limit ? totalMatches - limit : 0 };
}

function isLanguageMatch(ext: string, lang: string): boolean {
  const map: Record<string, string[]> = {
    typescript: ['ts', 'tsx', 'mts', 'cts'],
    javascript: ['js', 'jsx', 'mjs', 'cjs'],
    python: ['py', 'pyi'],
    go: ['go'],
    rust: ['rs'],
    java: ['java'],
    ruby: ['rb'],
  };
  return (map[lang] ?? [lang]).includes(ext);
}
