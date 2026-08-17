import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { parseFile } from '../parsers/index.js';
import { resolveRoot, displayPath } from '../core/paths.js';
import { readFileSafe } from '../core/utils.js';
import type { FileOverview, SymbolInfo, ExportInfo } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface FileOverviewOptions {
  path: string;
  detail?: 'signatures' | 'names' | 'bodies';
  maxSymbols?: number;
}

export async function getFileOverview(
  root: string | undefined,
  cache: CacheManager,
  options: FileOverviewOptions,
): Promise<FileOverview> {
  const projectRoot = resolveRoot(root);
  const filePath = resolve(projectRoot, options.path);
  const { detail = 'signatures', maxSymbols = 100 } = options;

  // Check cache first
  let stats: { mtimeMs: number; size: number };
  try {
    stats = statSync(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  const cachedMtime = cache.getFileMtime(displayPath(projectRoot, filePath));
  if (cachedMtime === Math.floor(stats.mtimeMs)) {
    const cached = cache.getFileOverview(displayPath(projectRoot, filePath));
    if (cached) {
      return {
        file: displayPath(projectRoot, filePath),
        language: cached.lang,
        purpose: '',
        lines: cached.lines,
        bytes: cached.bytes,
        lastModified: new Date(stats.mtimeMs).toISOString(),
        imports: [],
        exports: cached.symbols.filter(s => s.exported).map(s => ({ ...s, kind: s.kind as ExportInfo['kind'] })),
        symbols: cached.symbols.slice(0, maxSymbols),
        precision: cached.precision as 'full' | 'approx',
      };
    }
  }

  // Read and parse
  const content = readFileSafe(filePath);
  if (content === null) {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  const parsed = parseFile(filePath, content);
  const relPath = displayPath(projectRoot, filePath);

  // Apply detail level
  let symbols: SymbolInfo[] = parsed.symbols;
  if (detail === 'names') {
    symbols = symbols.map(s => ({ ...s, signature: '', doc: '' }));
  } else if (detail === 'bodies') {
    // Include a bit more context — first few lines of implementation
    symbols = symbols.map(s => {
      const bodyLines = content.split('\n').slice(s.line, s.line + 10).join('\n').slice(0, 200);
      return { ...s, doc: s.doc || bodyLines.slice(0, 100) };
    });
  }

  // Cache the result
  cache.upsertFile(
    relPath,
    Math.floor(stats.mtimeMs),
    stats.size,
    parsed.language,
    'regex',
    parsed.lines,
    parsed.bytes,
    parsed.precision,
    parsed.symbols,
    parsed.imports,
  );

  return {
    file: relPath,
    language: parsed.language,
    purpose: parsed.purpose,
    lines: parsed.lines,
    bytes: parsed.bytes,
    lastModified: new Date(stats.mtimeMs).toISOString(),
    imports: parsed.imports,
    exports: parsed.symbols.filter(s => s.exported).map(s => ({
      name: s.name,
      kind: s.kind as ExportInfo['kind'],
      line: s.line,
      signature: s.signature,
      doc: s.doc,
      exported: true,
    })),
    symbols: symbols.slice(0, maxSymbols),
    precision: parsed.precision,
  };
}
