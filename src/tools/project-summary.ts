import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { walk, detectLanguage, countLines } from '../core/walker.js';
import { detectAll, parsePackageJson } from '../core/config-detector.js';
import { resolveRoot, displayPath } from '../core/paths.js';
import type { ProjectSummary, LanguageStat, TopLevelDir } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export async function getProjectSummary(
  root: string | undefined,
  cache: CacheManager,
  refresh: boolean = false,
): Promise<ProjectSummary> {
  const projectRoot = resolveRoot(root);

  if (refresh) {
    cache.clear();
  }

  // Walk the project
  const result = walk(projectRoot, { maxDepth: 1, includeTests: true });
  const topDirs: TopLevelDir[] = [];
  for (const entry of result.entries) {
    if (entry.isDir) {
      topDirs.push({
        name: entry.relative + '/',
        role: guessRole(entry.relative),
        fileCount: 0, // filled below
      });
    }
  }

  // Deeper walk for stats
  const fullWalk = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const langStats = new Map<string, { files: number; loc: number }>();
  for (const entry of fullWalk.entries) {
    if (entry.isDir) continue;
    const lang = entry.lang || 'other';
    const stat = langStats.get(lang) || { files: 0, loc: 0 };
    stat.files++;
    try {
      stat.loc += countLines(entry.path);
    } catch { /* skip */ }
    langStats.set(lang, stat);
  }

  const languages: LanguageStat[] = Array.from(langStats.entries())
    .map(([lang, s]) => ({ lang, files: s.files, loc: s.loc }))
    .sort((a, b) => b.files - a.files);

  // Fill dir file counts
  for (const dir of topDirs) {
    dir.fileCount = fullWalk.entries.filter(e => !e.isDir && e.relative.startsWith(dir.name)).length;
  }

  // Detect tools and frameworks
  const pkg = parsePackageJson(projectRoot);
  const deps = (pkg?.dependencies as Record<string, string>) ?? {};
  const detected = detectAll(projectRoot, deps);

  // Determine project kind
  let kind: ProjectSummary['kind'] = 'mixed';
  if (pkg?.workspaces) kind = 'monorepo';
  else if (pkg?.bin || pkg?.main) kind = 'app';
  else if (!pkg?.bin && pkg?.main) kind = 'library';

  // Build tool
  const buildTool = detected.buildTools[0] ?? 'unknown';

  // Name
  const name = (pkg?.name as string) ?? projectRoot.split('/').pop() ?? 'unknown';

  return {
    name,
    kind,
    languages,
    frameworks: detected.frameworks,
    build: {
      tool: buildTool,
      packageManager: detected.packageManager,
      hasLockfile: detected.packageManager !== 'unknown',
    },
    workspaces: (pkg?.workspaces as string[]) ?? [],
    stats: {
      fileCount: fullWalk.entries.filter(e => !e.isDir).length,
      skippedCount: fullWalk.skipped,
      indexedBytes: fullWalk.entries.reduce((sum, e) => sum + e.size, 0),
      dirsBySize: topDirs
        .sort((a, b) => b.fileCount - a.fileCount)
        .slice(0, 10)
        .map(d => [d.name, d.fileCount] as [string, number]),
    },
    topLevelStructure: topDirs.slice(0, 15),
    _partial: fullWalk.partial || undefined,
  };
}

function guessRole(dirName: string): string {
  const map: Record<string, string> = {
    src: 'source-code', source: 'source-code', lib: 'source-code', app: 'source-code',
    tests: 'tests', test: 'tests', __tests__: 'tests', spec: 'tests',
    docs: 'documentation', doc: 'documentation',
    public: 'static-assets', static: 'static-assets', assets: 'static-assets',
    config: 'configuration', scripts: 'scripts',
    examples: 'examples', fixtures: 'fixtures',
    '.github': 'ci-cd', '.circleci': 'ci-cd',
    migrations: 'database-migrations',
    packages: 'workspace-packages',
  };
  const clean = dirName.replace(/\/$/, '');
  return map[clean] ?? 'source';
}
