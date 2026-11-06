import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { resolveRoot, displayPath, toPosix } from '../core/paths.js';
import { readFileSafe } from '../core/utils.js';
import type { WorkspacePackage, WorkspacesOutput } from '../types/index.js';

export type { WorkspacePackage, WorkspacesOutput };

export async function getWorkspaces(root?: string): Promise<WorkspacesOutput> {
  const projectRoot = resolveRoot(root);

  // 1. Check pnpm-workspace.yaml
  const pnpmWsPath = join(projectRoot, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWsPath)) {
    const content = readFileSafe(pnpmWsPath) ?? '';
    const globs = parsePnpmWorkspaceGlobs(content);
    const packages = discoverPackagesFromGlobs(projectRoot, globs);
    return {
      isMonorepo: true,
      monorepoType: 'pnpm',
      packages,
      totalPackages: packages.length,
    };
  }

  // 2. Check root package.json workspaces
  const pkgJsonPath = join(projectRoot, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      let workspaces: string[] = [];
      if (Array.isArray(pkg.workspaces)) {
        workspaces = pkg.workspaces;
      } else if (pkg.workspaces?.packages && Array.isArray(pkg.workspaces.packages)) {
        workspaces = pkg.workspaces.packages;
      }

      if (workspaces.length > 0) {
        const isTurbo = existsSync(join(projectRoot, 'turbo.json'));
        const isLerna = existsSync(join(projectRoot, 'lerna.json'));
        const packages = discoverPackagesFromGlobs(projectRoot, workspaces);
        return {
          isMonorepo: true,
          monorepoType: isTurbo ? 'turbo' : isLerna ? 'lerna' : 'npm-yarn',
          rootPackageName: pkg.name,
          packages,
          totalPackages: packages.length,
        };
      }
    } catch {
      // Ignore parse error
    }
  }

  // 3. Check Cargo.toml workspace
  const cargoPath = join(projectRoot, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    const content = readFileSafe(cargoPath) ?? '';
    if (content.includes('[workspace]')) {
      const match = content.match(/members\s*=\s*\[([^\]]+)\]/);
      const globs = match ? match[1]!.split(',').map(s => s.replace(/["'\s]/g, '')).filter(Boolean) : ['*'];
      const packages = discoverPackagesFromGlobs(projectRoot, globs);
      return {
        isMonorepo: true,
        monorepoType: 'cargo',
        packages,
        totalPackages: packages.length,
      };
    }
  }

  // 4. Check go.work
  const goWorkPath = join(projectRoot, 'go.work');
  if (existsSync(goWorkPath)) {
    const content = readFileSafe(goWorkPath) ?? '';
    const useMatches = content.match(/use\s*\(([^)]+)\)/);
    const dirs = useMatches
      ? useMatches[1]!.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    const packages: WorkspacePackage[] = dirs.map(d => ({
      name: d.split('/').pop() || d,
      path: d,
    }));
    return {
      isMonorepo: true,
      monorepoType: 'go-work',
      packages,
      totalPackages: packages.length,
    };
  }

  // Single project
  return {
    isMonorepo: false,
    packages: [],
    totalPackages: 0,
  };
}

function parsePnpmWorkspaceGlobs(content: string): string[] {
  const globs: string[] = [];
  const lines = content.split('\n');
  let inPackages = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('packages:')) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed.startsWith('-')) {
        globs.push(trimmed.replace(/^-\s*['"]?/, '').replace(/['"]?$/, ''));
      } else if (!trimmed.startsWith('#') && trimmed !== '') {
        break;
      }
    }
  }
  return globs.length > 0 ? globs : ['packages/*'];
}

function discoverPackagesFromGlobs(projectRoot: string, globs: string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  const seenPaths = new Set<string>();

  const tryAddDir = (pkgDir: string): void => {
    const relPath = toPosix(displayPath(projectRoot, pkgDir));
    if (seenPaths.has(relPath)) return;

    const pkgJson = join(pkgDir, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        const data = JSON.parse(readFileSync(pkgJson, 'utf-8'));
        seenPaths.add(relPath);
        packages.push({
          name: data.name || basename(pkgDir),
          path: relPath,
          version: data.version,
          dependencies: data.dependencies ? Object.keys(data.dependencies) : undefined,
          devDependencies: data.devDependencies ? Object.keys(data.devDependencies) : undefined,
          scripts: data.scripts,
        });
        return;
      } catch {
        // Ignore invalid JSON
      }
    }

    const cargoToml = join(pkgDir, 'Cargo.toml');
    if (existsSync(cargoToml)) {
      const content = readFileSafe(cargoToml) ?? '';
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
      seenPaths.add(relPath);
      packages.push({
        name: nameMatch?.[1] ?? basename(pkgDir),
        path: relPath,
        version: versionMatch?.[1],
      });
    }
  };

  for (const pattern of globs) {
    if (!pattern.includes('*')) {
      const exactDir = join(projectRoot, pattern);
      try {
        if (existsSync(exactDir) && statSync(exactDir).isDirectory()) {
          tryAddDir(exactDir);
        }
      } catch {
        // Ignore stat error
      }
      continue;
    }

    const baseDir = join(projectRoot, pattern.replace(/\/?\*.*$/, ''));
    if (!existsSync(baseDir)) continue;

    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          tryAddDir(join(baseDir, ent.name));
        }
      }
    } catch {
      // Ignore read error
    }
  }

  return packages;
}
