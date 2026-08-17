import { resolveRoot, displayPath } from '../core/paths.js';
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
    // Normalize: remove trailing slashes from directory entries
    entryPointPaths.add(ep.path.replace(/\/$/, ''));
  }

  // ── 2. Gather data (cache-first, walk as fallback) ────────────
  const indexedAt = cache.getIndexedAt();
  let cacheUsed = false;

  const fileExports = new Map<string, FileExport[]>();
  const allFiles = new Set<string>();
  let rawImports: RawImport[] = [];

  if (indexedAt) {
    cacheUsed = true;

    // Get all files from cache
    const cachedFiles = cache.getAllFiles();
    for (const f of cachedFiles) {
      allFiles.add(f.path);
    }

    // Get files that have symbols — we need exports
    const filesWithSymbols = cache.getFilesWithSymbols();
    for (const f of filesWithSymbols) {
      const overview = cache.getFileOverview(f.path);
      if (overview) {
        const exports: FileExport[] = [];
        for (const sym of overview.symbols) {
          if (sym.exported) {
            exports.push({ name: sym.name, kind: sym.kind as SymbolKind, line: sym.line });
          }
        }
        if (exports.length > 0) {
          fileExports.set(f.path, exports);
        }
      }
    }

    // Get import graph from cache
    rawImports = cache.getImportGraph('').filter(imp => !imp.isExternal);
  } else {
    // Fallback: walk + parse (no cache available)
    const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
    const sourceFiles = result.entries.filter(
      e => !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'rb'].includes(e.lang),
    );

    for (const file of sourceFiles) {
      allFiles.add(file.relative);

      const content = readFileSafe(file.path);
      if (!content) continue;

      const parsed = parseFile(file.path, content);

      // Collect exports
      const exports: FileExport[] = [];
      for (const sym of parsed.symbols) {
        if (sym.exported) {
          exports.push({ name: sym.name, kind: sym.kind, line: sym.line });
        }
      }
      if (exports.length > 0) {
        fileExports.set(file.relative, exports);
      }

      // Collect non-external imports
      for (const imp of parsed.imports) {
        if (!imp.isExternal) {
          rawImports.push({
            from: file.relative,
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

  for (const imp of rawImports) {
    const target = resolveImportTarget(imp.from, imp.to, allFiles);
    if (!target) continue;

    filesWithIncomingImports.add(target);

    if (imp.names.length === 0) {
      // Side-effect import: `import './side-effects'`
      filesWithSideEffectImports.add(target);
      continue;
    }

    let namesSet = importedNames.get(target);
    if (!namesSet) {
      namesSet = new Set();
      importedNames.set(target, namesSet);
    }
    for (const name of imp.names) {
      namesSet.add(name);
    }
  }

  // ── 4. Detect dead code ───────────────────────────────────────
  const unusedExports: DeadCodeItem[] = [];
  const unusedFiles: DeadCodeItem[] = [];
  let totalExports = 0;
  let filesAnalyzed = 0;

  for (const [filePath, exports] of fileExports) {
    // Skip test files unless explicitly included
    if (!includeTests && isTestFile(filePath)) continue;

    // Skip files matching ignore patterns
    if (ignorePatterns.length > 0 && matchesAnyPattern(filePath, ignorePatterns)) continue;

    filesAnalyzed++;
    totalExports += exports.length;

    const hasIncomingImports = filesWithIncomingImports.has(filePath);
    const hasSideEffectImport = filesWithSideEffectImports.has(filePath);
    const isEntryPoint = entryPointPaths.has(filePath) ||
      // Also check without extension and with trailing content
      [...entryPointPaths].some(ep => filePath.startsWith(ep) || ep.startsWith(filePath));

    // Case A: side-effect import exists — file is intentionally used, skip all exports
    if (hasSideEffectImport) continue;

    // If not an entry point AND no incoming imports → file is dead
    if (!isEntryPoint && !hasIncomingImports) {
      unusedFiles.push({
        file: filePath,
        symbol: filePath,
        kind: 'module',
        line: 1,
        confidence: 'medium',
        reason: 'File is never imported by any other file',
      });
    }

    // Check individual exports regardless of entry point status
    // An entry point can still have unused exports
    const fileImportedNames = importedNames.get(filePath);

    // If no specific names imported from this file (no imports, or only
    // namespace/default imports that don't match any export name):
    if (!fileImportedNames || fileImportedNames.size === 0) {
      if (!hasIncomingImports) {
        // No one imports from this file at all — all exports are dead (high confidence)
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
      }
      // else: file has incoming imports but no specific names captured
      // (likely namespace imports like `import * as X`). Skip — we can't be sure.
      continue;
    }

    // File has specific imported names — check each export
    const anyNameMatches = exports.some(e => fileImportedNames.has(e.name));

    for (const exp of exports) {
      if (!fileImportedNames.has(exp.name)) {
        // Not imported by name
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

  // ── 5. Sort and return ────────────────────────────────────────
  // Sort by confidence (high first), then by file path
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

/** Resolve a relative import spec to a known file path */
function resolveImportTarget(
  fromFile: string,
  importSpec: string,
  knownFiles: Set<string>,
): string | null {
  // Normalize the from-file directory
  const lastSlash = fromFile.lastIndexOf('/');
  const fromDir = lastSlash >= 0 ? fromFile.substring(0, lastSlash) : '';

  // Resolve relative to the importing file's directory
  let resolved: string;
  if (importSpec.startsWith('.')) {
    resolved = fromDir ? `${fromDir}/${importSpec}` : importSpec;
  } else if (importSpec.startsWith('/')) {
    resolved = importSpec.slice(1); // absolute within project
  } else {
    return null; // external — shouldn't happen (filtered earlier)
  }

  // Normalize path (resolve . and ..)
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

  // Check exact match
  if (knownFiles.has(resolved)) return resolved;

  // If the import already has an extension (e.g., .js in TS projects),
  // try the same path with alternative extensions
  const extMatch = resolved.match(/\.(js|jsx|mjs|cjs)$/);
  if (extMatch) {
    const base = resolved.slice(0, -extMatch[0].length);
    const altExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
    for (const ext of altExtensions) {
      const candidate = base + ext;
      if (candidate !== resolved && knownFiles.has(candidate)) return candidate;
    }
    // Also try index files
    for (const idx of ['/index.ts', '/index.js', '/index.tsx']) {
      const candidate = base + idx;
      if (knownFiles.has(candidate)) return candidate;
    }
  }

  // Probe common extensions and index files
  const extensions = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java', '.rb',
    '/index.ts', '/index.js', '/index.tsx', '/index.py', '/index.go', '/index.rs',
    '/__init__.py',
  ];

  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

/** Check if a file path is a test file */
function isTestFile(filePath: string): boolean {
  // Test directories — check anywhere in path, not just start
  if (/\/(?:tests?|__tests__|spec)\//.test(filePath)) return true;
  // Test file name patterns: *.test.ts, *.spec.tsx, test_*.py, *_test.go
  if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx|py|go|rs)$/.test(filePath)) return true;
  if (/(?:^|\/)test_[^/]+\.py$/.test(filePath)) return true;
  if (/_[^/]*_test\.go$/.test(filePath)) return true;
  return false;
}

/** Check if a file path matches any of the given glob patterns */
function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = new RegExp(
      '^' + pattern.replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*') + '$',
    );
    if (regex.test(filePath)) return true;
  }
  return false;
}
