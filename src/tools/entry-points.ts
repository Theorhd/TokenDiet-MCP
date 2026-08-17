import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRoot, displayPath } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { parseFile } from '../parsers/index.js';
import { readFileSafe } from '../core/utils.js';
import { parsePackageJson } from '../core/config-detector.js';
import type { EntryPointsOutput, EntryPoint, RouteInfo, CliCommand } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export async function getEntryPoints(
  root: string | undefined,
  cache: CacheManager,
): Promise<EntryPointsOutput> {
  const projectRoot = resolveRoot(root);
  const entryPoints: EntryPoint[] = [];
  const routes: RouteInfo[] = [];
  const cliCommands: CliCommand[] = [];

  // ── 1. Config-driven detection ──
  const pkg = parsePackageJson(projectRoot);
  if (pkg) {
    // main field
    if (pkg.main && typeof pkg.main === 'string') {
      entryPoints.push({ path: pkg.main, kind: 'main', via: 'package.json:main' });
    }
    // module field
    if (pkg.module && typeof pkg.module === 'string') {
      entryPoints.push({ path: pkg.module, kind: 'main', via: 'package.json:module' });
    }
    // bin field
    if (pkg.bin) {
      if (typeof pkg.bin === 'string') {
        entryPoints.push({ path: pkg.bin, kind: 'bin', via: 'package.json:bin' });
      } else if (typeof pkg.bin === 'object') {
        for (const [name, path] of Object.entries(pkg.bin as Record<string, string>)) {
          cliCommands.push({ name, command: name, description: `CLI: ${name}` });
          entryPoints.push({ path, kind: 'cli', via: `package.json:bin.${name}` });
        }
      }
    }
    // scripts
    if (pkg.scripts && Array.isArray(pkg.scripts)) {
      for (const script of pkg.scripts) {
        if (['dev', 'start', 'build', 'test', 'lint', 'deploy'].includes(script as string)) {
          cliCommands.push({
            name: script as string,
            command: `npm run ${script}`,
            description: `npm script: ${script}`,
          });
        }
      }
    }
  }

  // Cargo.toml bins
  if (existsSync(join(projectRoot, 'Cargo.toml'))) {
    const cargo = readFileSafe(join(projectRoot, 'Cargo.toml'));
    if (cargo) {
      const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
      const mainMatch = cargo.match(/^path\s*=\s*"([^"]+)"/m);
      if (nameMatch && mainMatch) {
        entryPoints.push({ path: mainMatch[1]!, kind: 'bin', via: 'Cargo.toml:[[bin]]' });
      }
      // Default binary
      const srcMain = join(projectRoot, 'src', 'main.rs');
      if (existsSync(srcMain)) {
        entryPoints.push({ path: 'src/main.rs', kind: 'main', via: 'convention: rust' });
      }
    }
  }

  // Go module
  if (existsSync(join(projectRoot, 'go.mod'))) {
    const cmdDir = join(projectRoot, 'cmd');
    if (existsSync(cmdDir)) {
      try {
        const cmds = readFileSync(cmdDir);
        // cmd/ subdirs are entry points
        entryPoints.push({ path: 'cmd/', kind: 'main', via: 'convention: go' });
      } catch { /* skip */ }
    }
    const mainGo = join(projectRoot, 'main.go');
    if (existsSync(mainGo)) {
      entryPoints.push({ path: 'main.go', kind: 'main', via: 'convention: go' });
    }
  }

  // Python
  if (existsSync(join(projectRoot, 'manage.py'))) {
    entryPoints.push({ path: 'manage.py', kind: 'main', via: 'convention: django' });
  }
  const mainPy = join(projectRoot, 'main.py');
  if (existsSync(mainPy)) {
    entryPoints.push({ path: 'main.py', kind: 'main', via: 'convention: python' });
  }
  const appPy = join(projectRoot, 'app.py');
  if (existsSync(appPy)) {
    entryPoints.push({ path: 'app.py', kind: 'main', via: 'convention: python' });
  }

  // ── 2. Convention-based detection ──
  const result = walk(projectRoot, { maxDepth: 3, includeTests: false });
  const entryPatterns = [
    { pattern: /^src\/index\.(ts|tsx|js|jsx|mjs)$/, kind: 'main' as const, via: 'convention: index' },
    { pattern: /^index\.(ts|tsx|js|jsx)$/, kind: 'main' as const, via: 'convention: root index' },
    { pattern: /^src\/main\.(ts|tsx|js|py|go|rs)$/, kind: 'main' as const, via: 'convention: main' },
    { pattern: /^src\/app\.(ts|tsx|js|py)$/, kind: 'main' as const, via: 'convention: app' },
    { pattern: /^src\/server\.(ts|js)$/, kind: 'main' as const, via: 'convention: server' },
  ];

  for (const entry of result.entries) {
    if (entry.isDir) continue;
    for (const { pattern, kind, via } of entryPatterns) {
      if (pattern.test(entry.relative)) {
        entryPoints.push({ path: entry.relative, kind, via });
      }
    }
  }

  // ── 3. Route detection (scan for route registrations) ──
  for (const entry of result.entries) {
    if (entry.isDir) continue;
    if (!['ts', 'tsx', 'js', 'jsx', 'py', 'go'].includes(entry.lang)) continue;
    if (routes.length >= 50) break;

    const content = readFileSafe(entry.path);
    if (!content) continue;

    // Express/Fastify/Hono route patterns
    const routePatterns = [
      /\.(get|post|put|delete|patch|options|head)\s*\(\s*['"](\/[^'"]*)['"]\s*,\s*(\w+)/g,
      /app\.(get|post|put|delete|patch)\s*\(\s*['"](\/[^'"]*)['"]\s*,\s*(\w+)/g,
      /router\.(get|post|put|delete|patch)\s*\(\s*['"](\/[^'"]*)['"]\s*,\s*(\w+)/g,
      // FastAPI
      /@app\.(get|post|put|delete|patch)\s*\(\s*['"](\/[^'"]*)['"]/g,
      /@router\.(get|post|put|delete|patch)\s*\(\s*['"](\/[^'"]*)['"]/g,
      // Flask
      /@\w+\.route\s*\(\s*['"](\/[^'"]*)['"]\s*,\s*methods\s*=\s*\[([^\]]+)\]/g,
      // Go Gin/Echo
      /\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"](\/[^'"]*)['"]\s*,\s*(\w+)/g,
    ];

    for (const pattern of routePatterns) {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null && routes.length < 50) {
        const method = (match[1] ?? 'GET').toUpperCase();
        const path = match[2] ?? '/';
        const handler = match[3] ?? 'handler';
        routes.push({ method, path, handler, file: entry.relative });
      }
    }
  }

  // ── 4. Test entry points ──
  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  for (const dir of testDirs) {
    if (existsSync(join(projectRoot, dir))) {
      const testFiles = walk(join(projectRoot, dir), { maxDepth: 2, includeTests: true });
      const count = testFiles.entries.filter(e => !e.isDir).length;
      entryPoints.push({ path: `${dir}/`, kind: 'test', count });
      break;
    }
  }

  return { entryPoints, routes: routes.slice(0, 50), cliCommands };
}
