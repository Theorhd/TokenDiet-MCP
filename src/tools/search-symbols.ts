import { resolveRoot, displayPath, toPosix } from '../core/paths.js';
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

  const isIndexed = !!cache.getIndexedAt();

  if (isIndexed) {
    const cachedResults = cache.searchSymbols(query, kind, limit * 10, filePattern);
    let matches: SearchResult[] = cachedResults.map(r => ({
      name: r.name,
      kind: r.kind as SymbolKind,
      file: toPosix(r.file),
      line: r.line,
      signature: r.signature,
    }));

    // Filter language
    if (language) {
      matches = matches.filter(m => {
        const ext = m.file.split('.').pop()?.toLowerCase();
        return ext && isLanguageMatch(ext, language);
      });
    }

    // Filter filePattern
    if (filePattern) {
      const regexPattern = '^' + toPosix(filePattern).replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*') + '$';
      const pattern = new RegExp(regexPattern, 'i');
      matches = matches.filter(m => pattern.test(m.file));
    }

    // Rank results: exact match > prefix match > substring match
    const qLower = query.toLowerCase();
    matches.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName === qLower && bName !== qLower) return -1;
      if (bName === qLower && aName !== qLower) return 1;
      if (aName.startsWith(qLower) && !bName.startsWith(qLower)) return -1;
      if (bName.startsWith(qLower) && !aName.startsWith(qLower)) return 1;
      return a.file.localeCompare(b.file) || a.line - b.line;
    });

    const totalMatches = matches.length;
    return {
      matches: matches.slice(0, limit),
      totalMatches,
      truncated: totalMatches > limit ? totalMatches - limit : 0,
    };
  }

  // Fallback only when database is NOT indexed yet
  const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const sourceFiles = result.entries.filter(e =>
    !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'rb', 'cs', 'php'].includes(e.lang),
  );

  const allMatches: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const file of sourceFiles) {
    if (language && !isLanguageMatch(file.lang, language)) continue;
    if (filePattern) {
      const regexPattern = '^' + toPosix(filePattern).replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*') + '$';
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
          file: toPosix(file.relative),
          line: sym.line,
          signature: sym.signature,
        });
      }
    }

    if (allMatches.length >= limit * 3) break;
  }

  // Rank matches
  allMatches.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName === queryLower && bName !== queryLower) return -1;
    if (bName === queryLower && aName !== queryLower) return 1;
    if (aName.startsWith(queryLower) && !bName.startsWith(queryLower)) return -1;
    if (bName.startsWith(queryLower) && !aName.startsWith(queryLower)) return 1;
    return a.file.localeCompare(b.file) || a.line - b.line;
  });

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
    c_sharp: ['cs'],
    ruby: ['rb', 'erb'],
    php: ['php'],
  };
  return (map[lang] ?? [lang]).includes(ext);
}
