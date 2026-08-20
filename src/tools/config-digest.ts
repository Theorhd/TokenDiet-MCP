import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { resolveRoot, resolveSecurePath } from '../core/paths.js';
import { readFileSafe } from '../core/utils.js';
import type { ConfigOutput, ConfigDigest } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface ConfigDigestOptions {
  path?: string;
}

export async function getConfigDigest(
  root: string | undefined,
  cache: CacheManager,
  options: ConfigDigestOptions = {},
): Promise<ConfigOutput> {
  const projectRoot = resolveRoot(root);
  const singleFile = options.path;

  if (singleFile) {
    const fullPath = resolveSecurePath(projectRoot, singleFile);
    const digest = parseConfigFile(fullPath);
    return { configs: digest ? [digest] : [] };
  }

  const configs: ConfigDigest[] = [];
  const knownConfigs = [
    'package.json', 'tsconfig.json', 'jsconfig.json',
    'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'setup.cfg',
    'requirements.txt', 'Pipfile', 'Gemfile', '.ruby-version',
    'pom.xml', 'build.gradle', 'build.gradle.kts',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
    'tsup.config.ts', 'webpack.config.js',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    '.eslintrc.js', '.eslintrc.json', 'eslint.config.js', 'eslint.config.mjs',
    '.prettierrc', 'prettier.config.js', 'biome.json',
    '.github/workflows',
  ];

  for (const configName of knownConfigs) {
    const fullPath = join(projectRoot, configName);
    if (configName === '.github/workflows') {
      if (existsSync(fullPath)) {
        try {
          const files = readdirSync(fullPath);
          const ymlFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
          configs.push({
            file: '.github/workflows/',
            format: 'yaml',
            summary: { workflows: ymlFiles.length > 0 ? ymlFiles : 'CI/CD workflows detected' },
          });
        } catch { /* skip */ }
      }
      continue;
    }

    if (existsSync(fullPath)) {
      const digest = parseConfigFile(fullPath);
      if (digest) configs.push(digest);
    }
  }

  return { configs };
}

function parseConfigFile(filePath: string): ConfigDigest | null {
  const content = readFileSafe(filePath);
  if (!content) return null;

  const filename = basename(filePath);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  try {
    if (filename === 'package.json') {
      const pkg = JSON.parse(content);
      return {
        file: 'package.json',
        format: 'json',
        summary: {
          name: pkg.name,
          type: pkg.type ?? 'commonjs',
          engines: pkg.engines,
          scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
          deps: { count: pkg.dependencies ? Object.keys(pkg.dependencies).length : 0, top: pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 20) : [] },
          devDeps: { count: pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0, top: pkg.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 20) : [] },
          hasLockfile: existsSync(filePath.replace('package.json', 'package-lock.json')) ||
                       existsSync(filePath.replace('package.json', 'pnpm-lock.yaml')) ||
                       existsSync(filePath.replace('package.json', 'yarn.lock')),
        },
      };
    }

    if (filename === 'tsconfig.json' || filename === 'jsconfig.json') {
      const cfg = JSON.parse(content);
      return {
        file: filename,
        format: 'json',
        summary: {
          target: cfg.compilerOptions?.target,
          module: cfg.compilerOptions?.module,
          moduleResolution: cfg.compilerOptions?.moduleResolution,
          strict: cfg.compilerOptions?.strict ?? false,
          jsx: cfg.compilerOptions?.jsx,
          paths: cfg.compilerOptions?.paths ? Object.keys(cfg.compilerOptions.paths).length : 0,
          baseUrl: cfg.compilerOptions?.baseUrl,
          outDir: cfg.compilerOptions?.outDir,
          declaration: cfg.compilerOptions?.declaration ?? false,
          incremental: cfg.compilerOptions?.incremental ?? false,
        },
      };
    }

    if (filename === 'Cargo.toml') {
      // Simple TOML extraction (no full parser needed)
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      const editionMatch = content.match(/^edition\s*=\s*"([^"]+)"/m);
      const versionMatch = content.match(/^version\s*=\s*"([^"]+)"/m);
      const deps = content.match(/^\[dependencies\]/m) ? 'present' : 'none';
      const devDeps = content.match(/^\[dev-dependencies\]/m) ? 'present' : 'none';
      const binSections = content.match(/^\[\[bin\]\]/gm);
      return {
        file: 'Cargo.toml',
        format: 'toml',
        summary: {
          name: nameMatch?.[1],
          version: versionMatch?.[1],
          edition: editionMatch?.[1],
          hasDependencies: deps,
          hasDevDependencies: devDeps,
          bins: binSections?.length ?? 0,
        },
      };
    }

    if (filename === 'go.mod') {
      const moduleMatch = content.match(/^module\s+(.+)$/m);
      const goVersion = content.match(/^go\s+(.+)$/m);
      const requireCount = (content.match(/^require\s+/gm) || []).length;
      return {
        file: 'go.mod',
        format: 'text',
        summary: {
          module: moduleMatch?.[1],
          goVersion: goVersion?.[1],
          requireCount,
        },
      };
    }

    if (filename === 'pyproject.toml') {
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const buildMatch = content.match(/\[build-system\]/);
      const requires = content.match(/requires\s*=\s*\[([^\]]+)\]/);
      return {
        file: 'pyproject.toml',
        format: 'toml',
        summary: {
          name: nameMatch?.[1],
          hasBuildSystem: !!buildMatch,
          buildRequires: requires?.[1]?.replace(/"/g, '').split(',').map(s => s.trim()),
          tools: extractPyprojectTools(content),
        },
      };
    }

    if (filename === 'requirements.txt') {
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const deps = lines.map(l => l.split('==')[0]?.split('>=')[0]?.split('<=')[0]?.split('~=')[0]?.trim()).filter(Boolean);
      return {
        file: 'requirements.txt',
        format: 'text',
        summary: {
          totalDeps: deps.length,
          top: deps.slice(0, 30),
        },
      };
    }

    if (filename === 'Gemfile') {
      const gemCount = (content.match(/^\s*gem\s+/gm) || []).length;
      const rubyVersion = content.match(/ruby\s+['"]([^'"]+)['"]/);
      return {
        file: 'Gemfile',
        format: 'text',
        summary: {
          gems: gemCount,
          rubyVersion: rubyVersion?.[1],
        },
      };
    }

    if (filename === 'Dockerfile') {
      const fromMatch = content.match(/^FROM\s+(.+)$/m);
      const stages = (content.match(/^FROM\s+/gm) || []).length;
      return {
        file: 'Dockerfile',
        format: 'text',
        summary: {
          stages,
          baseImage: fromMatch?.[1],
        },
      };
    }

    if (filename.startsWith('docker-compose')) {
      const serviceCount = (content.match(/^\s{2}\w+:/gm) || []).length;
      return {
        file: filename,
        format: 'yaml',
        summary: { services: serviceCount },
      };
    }

    // Generic JSON/YAML configs (biome, eslint, etc.)
    if (ext === 'json' || filename.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content);
        return {
          file: filename,
          format: 'json',
          summary: { keys: Object.keys(parsed).slice(0, 20), type: Array.isArray(parsed) ? 'array' : 'object' },
        };
      } catch { /* skip */ }
    }

    // JavaScript / TypeScript configs (vite, next, tsup, webpack, eslint, prettier)
    if (['ts', 'js', 'mjs', 'cjs'].includes(ext)) {
      const exportsFound: string[] = [];
      const defaultExport = content.match(/export\s+default\s+(?:defineConfig\s*\(\s*)?([^{\n]+)/);
      if (defaultExport) {
        exportsFound.push('default');
      }

      const namedExports = content.match(/export\s+(?:const|function|let|var)\s+(\w+)/g);
      if (namedExports) {
        for (const ne of namedExports) {
          const name = ne.split(/\s+/).pop();
          if (name) exportsFound.push(name);
        }
      }

      const plugins: string[] = [];
      const pluginMatches = content.match(/\b([A-Za-z0-9_]+Plugin|[A-Za-z0-9_]+Preset)\b/g);
      if (pluginMatches) {
        for (const pm of Array.from(new Set(pluginMatches)).slice(0, 5)) {
          plugins.push(pm);
        }
      }

      return {
        file: filename,
        format: 'typescript',
        summary: {
          fileType: ext,
          exports: exportsFound.length > 0 ? exportsFound : ['module'],
          plugins: plugins.length > 0 ? plugins : undefined,
        },
      };
    }
  } catch {
    return null;
  }

  return null;
}

function extractPyprojectTools(content: string): string[] {
  const tools: string[] = [];
  const known = ['pytest', 'ruff', 'mypy', 'black', 'isort', 'poetry', 'hatch', 'setuptools', 'flit'];
  for (const tool of known) {
    if (content.includes(`[tool.${tool}]`)) tools.push(tool);
  }
  return tools;
}
