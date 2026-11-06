import { resolveRoot, displayPath, toPosix, resolveSecurePath } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { parseFile } from '../parsers/index.js';
import { treeSitterManager } from '../parsers/treesitter.js';
import { readFileSafe, resolveImportPath, resolveImportTarget } from '../core/utils.js';
import type { CacheManager } from '../core/cache.js';
import type { ImpactAnalysisOutput } from '../types/index.js';

export type { ImpactAnalysisOutput };

export interface ImpactAnalysisOptions {
  path: string;
  maxDepth?: number;
}

export async function getImpactAnalysis(
  root: string | undefined,
  cache: CacheManager,
  options: ImpactAnalysisOptions,
): Promise<ImpactAnalysisOutput> {
  const projectRoot = resolveRoot(root);
  const { path: targetInput, maxDepth = 5 } = options;
  const secureResolved = resolveSecurePath(projectRoot, targetInput);
  const targetPath = toPosix(displayPath(projectRoot, secureResolved)).replace(/\/$/, '');

  const indexedAt = cache.getIndexedAt();
  const inDegreeMap = new Map<string, Set<string>>(); // target -> Set of files that import target

  if (indexedAt) {
    const knownFiles = new Set(cache.getAllFiles().map(f => toPosix(f.path)));
    const rawImports = cache.getImportGraph('').filter(imp => !imp.isExternal);
    for (const imp of rawImports) {
      const from = toPosix(imp.from);
      const resolved =
        (knownFiles.size > 0 ? resolveImportTarget(from, imp.to, knownFiles) : null) ??
        toPosix(imp.to);
      if (!inDegreeMap.has(resolved)) inDegreeMap.set(resolved, new Set());
      inDegreeMap.get(resolved)!.add(from);
    }
  } else {
    try {
      await treeSitterManager.init();
    } catch {
      // Fallback to regex
    }
    const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
    const sourceFiles = result.entries.filter(e => !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cs', 'rb', 'php'].includes(e.lang));
    const knownFilesSet = new Set(sourceFiles.map(f => toPosix(f.relative)));

    for (const file of sourceFiles) {
      const relPath = toPosix(file.relative);
      const content = readFileSafe(file.path);
      if (!content) continue;

      const parsed = parseFile(file.path, content);
      for (const imp of parsed.imports) {
        if (imp.isExternal) continue;
        const resolvedRel = resolveImportTarget(relPath, imp.from, knownFilesSet);
        if (resolvedRel) {
          if (!inDegreeMap.has(resolvedRel)) inDegreeMap.set(resolvedRel, new Set());
          inDegreeMap.get(resolvedRel)!.add(relPath);
          continue;
        }
        const candidates = resolveImportPath(file.path, imp.from);
        for (const candidate of candidates) {
          const candidateRel = toPosix(displayPath(projectRoot, candidate));
          if (knownFilesSet.has(candidateRel)) {
            if (!inDegreeMap.has(candidateRel)) inDegreeMap.set(candidateRel, new Set());
            inDegreeMap.get(candidateRel)!.add(relPath);
          }
        }
      }
    }
  }

  // BFS reverse traversal (supports both exact file and directory prefix targets)
  const visited = new Map<string, number>(); // file -> depth
  const seedFiles = new Set<string>([targetPath]);
  const dirPrefix = targetPath + '/';
  for (const key of inDegreeMap.keys()) {
    if (key.startsWith(dirPrefix)) {
      seedFiles.add(key);
    }
  }
  const queue: Array<{ file: string; depth: number }> = [...seedFiles].map(file => ({ file, depth: 0 }));

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const importers = inDegreeMap.get(file) || new Set<string>();
    for (const imp of importers) {
      if (seedFiles.has(imp)) continue;
      if (!visited.has(imp)) {
        visited.set(imp, depth + 1);
        queue.push({ file: imp, depth: depth + 1 });
      }
    }
  }

  const directDependents: string[] = [];
  const indirectDependents: Array<{ file: string; depth: number }> = [];
  const impactedTests: string[] = [];

  for (const [file, depth] of visited.entries()) {
    if (isTestFile(file)) {
      impactedTests.push(file);
    }

    if (depth === 1) {
      directDependents.push(file);
    } else {
      indirectDependents.push({ file, depth });
    }
  }

  directDependents.sort();
  indirectDependents.sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file));
  impactedTests.sort();

  const totalImpactedFiles = directDependents.length + indirectDependents.length;

  let blastRadius: ImpactAnalysisOutput['blastRadius'] = 'low';
  if (totalImpactedFiles > 25) blastRadius = 'critical';
  else if (totalImpactedFiles > 10) blastRadius = 'high';
  else if (totalImpactedFiles > 3) blastRadius = 'medium';

  return {
    target: targetPath,
    directDependents,
    indirectDependents,
    impactedTests,
    totalImpactedFiles,
    blastRadius,
  };
}

function isTestFile(filePath: string): boolean {
  const norm = toPosix(filePath);
  return norm.startsWith('test/') || norm.startsWith('tests/') || norm.startsWith('__tests__/') ||
    /\/(?:tests?|__tests__|spec)\//.test(norm) ||
    /\.(?:test|spec)\.(?:ts|tsx|js|jsx|py|go|rs|cs|rb)$/.test(norm) ||
    /(?:^|\/)test_[^/]+\.py$/.test(norm) ||
    /_[^/]*_test\.go$/.test(norm);
}
