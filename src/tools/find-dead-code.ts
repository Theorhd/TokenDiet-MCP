import { resolveRoot, displayPath, toPosix } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { parseFile } from '../parsers/index.js';
import { readFileSafe } from '../core/utils.js';
import { getEntryPoints } from './entry-points.js';
import type { DeadCodeOutput, DeadCodeItem, SymbolKind } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface FindDeadCodeOptions {
  includeTests?: boolean;
  ignorePatterns?: string[];
  minConfidence?: 'high' | 'medium';
}

interface FileExport {
  name: string;
  kind: SymbolKind;
  line: number;
}

interface RawImport {
  from: string;
  to: string;
  names: string[];
  isExternal: boolean;
}

export async function findDeadCode(
  root: string | undefined,
  cache: CacheManager,
  options: FindDeadCodeOptions = {},
): Promise<DeadCodeOutput> {
  const projectRoot = resolveRoot(root);
  const {
    includeTests = false,
    ignorePatterns = [],
    minConfidence = 'medium',
  } = options;

  // ── 1. Identify entry points ──────────────────────────────────
  const entryPoints = await getEntryPoints(root, cache);
  const entryPointPaths = new Set<string>();
  for (const ep of entryPoints.entryPoints) {
    entryPointPaths.add(toPosix(ep.path).replace(/\/$/, ''));
  }

  // ── 2. Gather data (cache-first, walk as fallback) ────────────
  const indexedAt = cache.getIndexedAt();
  let cacheUsed = false;

  const fileExports = new Map<string, FileExport[]>();
  const fileSymbolsCount = new Map<string, number>();
  const allFiles = new Set<string>();
  let rawImports: RawImport[] = [];

  if (indexedAt) {
    cacheUsed = true;

    const cachedFiles = cache.getAllFiles();
    for (const f of cachedFiles) {
      allFiles.add(toPosix(f.path));
    }

    const filesWithSymbols = cache.getFilesWithSymbols();
    for (const f of filesWithSymbols) {
      const overview = cache.getFileOverview(f.path);
      if (overview) {
        const exports: FileExport[] = [];
        fileSymbolsCount.set(toPosix(f.path), overview.symbols.length);
        for (const sym of overview.symbols) {
          if (sym.exported) {
            exports.push({ name: sym.name, kind: sym.kind as SymbolKind, line: sym.line });
          }
        }
        if (exports.length > 0) {
          fileExports.set(toPosix(f.path), exports);
        }
      }
    }

    rawImports = cache.getImportGraph('').filter(imp => !imp.isExternal);
  } else {
    const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
    const sourceFiles = result.entries.filter(
      e => !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'rb', 'cs', 'php'].includes(e.lang),
    );

    for (const file of sourceFiles) {
      const posixRel = toPosix(file.relative);
      allFiles.add(posixRel);

      const content = readFileSafe(file.path);
      if (!content) continue;

      const parsed = parseFile(file.path, content);
      fileSymbolsCount.set(posixRel, parsed.symbols.length);

      const exports: FileExport[] = [];
      for (const sym of parsed.symbols) {
        if (sym.exported) {
          exports.push({ name: sym.name, kind: sym.kind, line: sym.line });
        }
      }
      if (exports.length > 0) {
        fileExports.set(posixRel, exports);
      }

      for (const imp of parsed.imports) {
        if (!imp.isExternal) {
          rawImports.push({
            from: posixRel,
            to: imp.from,
            names: imp.names,
            isExternal: false,
          });
        }
      }
    }
  }

  // ── 3. Build index: for each file, what names are imported from it ──
  const importedNames = new Map<string, Set<string>>();
  const filesWithIncomingImports = new Set<string>();
  const filesWithSideEffectImports = new Set<string>();

  // A file is an intermediate pass-through re-exporter if it has 0 symbols in fileOverviews and is not an entry point
  const isIntermediateBarrel = (file: string): boolean => {
    if (entryPointPaths.has(file)) return false;
    // If it has explicitly recorded symbols > 0, it has its own logic
    return fileSymbolsCount.has(file) && (fileSymbolsCount.get(file) ?? 0) === 0;
  };

  // Step 3a: Non-intermediate files register direct demand
  for (const imp of rawImports) {
    const target = resolveImportTarget(imp.from, imp.to, allFiles);
    if (!target) continue;

    filesWithIncomingImports.add(target);

    if (imp.names.length === 0) {
      filesWithSideEffectImports.add(target);
      continue;
    }

    if (!isIntermediateBarrel(imp.from)) {
      let namesSet = importedNames.get(target);
      if (!namesSet) {
        namesSet = new Set();
        importedNames.set(target, namesSet);
      }
      for (const name of imp.names) {
        namesSet.add(name);
      }
    }
  }

  // Step 3b: Transitive propagation of demand through intermediate barrel chains
  let changed = true;
  let passes = 0;
  const maxPasses = 10;

  while (changed && passes < maxPasses) {
    changed = false;
    passes++;

    for (const imp of rawImports) {
      if (!isIntermediateBarrel(imp.from)) continue;

      const target = resolveImportTarget(imp.from, imp.to, allFiles);
      if (!target) continue;

      const incomingDemandOnImporter = importedNames.get(imp.from);
      if (!incomingDemandOnImporter || incomingDemandOnImporter.size === 0) continue;

      let targetNames = importedNames.get(target);
      if (!targetNames) {
        targetNames = new Set();
        importedNames.set(target, targetNames);
      }

      for (const name of incomingDemandOnImporter) {
        if ((imp.names.length === 0 || imp.names.includes(name)) && !targetNames.has(name)) {
          targetNames.add(name);
          changed = true;
        }
      }
    }
  }

  // ── 4. Detect dead code ───────────────────────────────────────
  const unusedExports: DeadCodeItem[] = [];
  const unusedFiles: DeadCodeItem[] = [];
  let totalExports = 0;
  let filesAnalyzed = 0;

  for (const [filePath, exports] of fileExports) {
    if (!includeTests && isTestFile(filePath)) continue;
    if (ignorePatterns.length > 0 && matchesAnyPattern(filePath, ignorePatterns)) continue;

    filesAnalyzed++;
    totalExports += exports.length;

    const hasIncomingImports = filesWithIncomingImports.has(filePath);
    const hasSideEffectImport = filesWithSideEffectImports.has(filePath);
    const isEntryPoint = entryPointPaths.has(filePath) ||
      [...entryPointPaths].some(ep => filePath === ep || filePath.startsWith(ep + '/') || ep.startsWith(filePath + '/'));

    if (hasSideEffectImport) continue;

    if (!isEntryPoint && !hasIncomingImports) {
      unusedFiles.push({
        file: filePath,
        symbol: filePath,
        kind: 'module',
        line: 1,
        confidence: 'medium',
        reason: 'File is never imported by any other file and is not an entry point',
      });
    }

    const fileImportedNames = importedNames.get(filePath);

    if (!fileImportedNames || fileImportedNames.size === 0) {
      if (!hasIncomingImports) {
        for (const exp of exports) {
          unusedExports.push({
            file: filePath,
            symbol: exp.name,
            kind: exp.kind,
            line: exp.line,
            confidence: 'high',
            reason: isEntryPoint
              ? 'Entry point export never imported by any other file'
              : 'File has no incoming imports and is not an entry point',
          });
        }
      } else {
        if (minConfidence !== 'high') {
          for (const exp of exports) {
            unusedExports.push({
              file: filePath,
              symbol: exp.name,
              kind: exp.kind,
              line: exp.line,
              confidence: 'medium',
              reason: 'File has incoming imports (possibly namespace/default imports) but this symbol name is never imported directly',
            });
          }
        }
      }
      continue;
    }

    const anyNameMatches = exports.some(e => fileImportedNames.has(e.name));

    for (const exp of exports) {
      if (!fileImportedNames.has(exp.name)) {
        const confidence = anyNameMatches ? 'high' : 'medium';
        const reason = anyNameMatches
          ? 'Exported but never imported by name from any file'
          : 'File has incoming imports (possibly namespace/default imports) but this symbol name is never imported directly';

        if (minConfidence === 'high' && confidence === 'medium') continue;

        unusedExports.push({
          file: filePath,
          symbol: exp.name,
          kind: exp.kind,
          line: exp.line,
          confidence,
          reason,
        });
      }
    }
  }

  unusedExports.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return a.file.localeCompare(b.file) || a.line - b.line;
  });
  unusedFiles.sort((a, b) => a.file.localeCompare(b.file));

  return {
    unusedExports,
    unusedFiles,
    summary: {
      totalUnusedExports: unusedExports.length,
      totalUnusedFiles: unusedFiles.length,
      filesAnalyzed,
      exportsAnalyzed: totalExports,
      cacheUsed,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function resolveImportTarget(
  fromFile: string,
  importSpec: string,
  knownFiles: Set<string>,
): string | null {
  const normFromFile = toPosix(fromFile);
  const lastSlash = normFromFile.lastIndexOf('/');
  const fromDir = lastSlash >= 0 ? normFromFile.substring(0, lastSlash) : '';

  let resolved: string;
  if (importSpec.startsWith('.')) {
    resolved = fromDir ? `${fromDir}/${importSpec}` : importSpec;
  } else if (importSpec.startsWith('/')) {
    resolved = importSpec.slice(1);
  } else if (importSpec.startsWith('@/') || importSpec.startsWith('~/')) {
    resolved = importSpec.slice(2);
    if (!knownFiles.has(resolved) && knownFiles.has(`src/${resolved}`)) {
      resolved = `src/${resolved}`;
    }
  } else {
    resolved = importSpec;
    if (!knownFiles.has(resolved) && knownFiles.has(`src/${resolved}`)) {
      resolved = `src/${resolved}`;
    }
  }

  const parts = resolved.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      normalized.pop();
    } else if (part !== '.' && part !== '') {
      normalized.push(part);
    }
  }
  resolved = normalized.join('/');

  if (knownFiles.has(resolved)) return resolved;

  const extMatch = resolved.match(/\.(js|jsx|mjs|cjs)$/);
  if (extMatch) {
    const base = resolved.slice(0, -extMatch[0].length);
    const altExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
    for (const ext of altExtensions) {
      const candidate = base + ext;
      if (candidate !== resolved && knownFiles.has(candidate)) return candidate;
    }
    for (const idx of ['/index.ts', '/index.js', '/index.tsx']) {
      const candidate = base + idx;
      if (knownFiles.has(candidate)) return candidate;
    }
  }

  const extensions = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
    '.py', '.go', '.rs', '.java', '.rb', '.cs', '.php',
    '/index.ts', '/index.js', '/index.tsx', '/index.py', '/index.go', '/index.rs',
    '/__init__.py',
  ];

  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

function isTestFile(filePath: string): boolean {
  const norm = toPosix(filePath);
  if (norm.startsWith('test/') || norm.startsWith('tests/') || norm.startsWith('__tests__/')) return true;
  if (/\/(?:tests?|__tests__|spec)\//.test(norm)) return true;
  if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx|py|go|rs|cs|rb)$/.test(norm)) return true;
  if (/(?:^|\/)test_[^/]+\.py$/.test(norm)) return true;
  if (/_[^/]*_test\.go$/.test(norm)) return true;
  return false;
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  const norm = toPosix(filePath);
  for (const pattern of patterns) {
    const normPattern = toPosix(pattern);
    const regex = new RegExp(
      '^' + normPattern.replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*') + '$',
    );
    if (regex.test(norm)) return true;
  }
  return false;
}
