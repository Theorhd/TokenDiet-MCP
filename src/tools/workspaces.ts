import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRoot, toPosix } from '../core/paths.js';
import { readFileSafe } from '../core/utils.js';

export interface WorkspacePackage {
  name: string;
  path: string;
  version?: string;
  dependencies?: string[];
  devDependencies?: string[];
  scripts?: Record<string, string>;
}

export interface WorkspacesOutput {
  isMonorepo: boolean;
  monorepoType?: 'pnpm' | 'npm-yarn' | 'turbo' | 'lerna' | 'cargo' | 'go-work';
  rootPackageName?: string;
  packages: WorkspacePackage[];
  totalPackages: number;
}

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

  for (const pattern of globs) {
    const baseDir = join(projectRoot, pattern.replace(/\/\*.*$/, ''));
    if (!existsSync(baseDir)) continue;

    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const pkgDir = join(baseDir, ent.name);
          const pkgJson = join(pkgDir, 'package.json');
          if (existsSync(pkgJson)) {
            try {
              const data = JSON.parse(readFileSync(pkgJson, 'utf-8'));
              packages.push({
                name: data.name || ent.name,
                path: toPosix(pkgDir.replace(projectRoot + '/', '')),
                version: data.version,
                dependencies: data.dependencies ? Object.keys(data.dependencies) : undefined,
                devDependencies: data.devDependencies ? Object.keys(data.devDependencies) : undefined,
                scripts: data.scripts,
              });
            } catch {
              // Ignore invalid JSON
            }
          }
        }
      }
    } catch {
      // Ignore read error
    }
  }

  return packages;
}
