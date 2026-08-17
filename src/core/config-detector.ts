import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSafe } from './utils.js';

// ─── Framework detection table ────────────────────────────────────
interface FrameworkSignature {
  name: string;
  category: 'framework' | 'build' | 'test' | 'linter' | 'runtime';
  configFiles?: string[];
  deps?: string[];
  filePatterns?: string[];
}

const SIGNATURES: FrameworkSignature[] = [
  // JavaScript/TypeScript
  { name: 'react', category: 'framework', deps: ['react', 'react-dom'], filePatterns: ['*.jsx', '*.tsx'] },
  { name: 'next.js', category: 'framework', configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'], deps: ['next'] },
  { name: 'vue', category: 'framework', deps: ['vue'], filePatterns: ['*.vue'] },
  { name: 'nuxt', category: 'framework', configFiles: ['nuxt.config.ts', 'nuxt.config.js'], deps: ['nuxt'] },
  { name: 'svelte', category: 'framework', deps: ['svelte'], filePatterns: ['*.svelte'] },
  { name: 'sveltekit', category: 'framework', deps: ['@sveltejs/kit'] },
  { name: 'angular', category: 'framework', configFiles: ['angular.json'], deps: ['@angular/core'] },
  { name: 'express', category: 'framework', deps: ['express'] },
  { name: 'fastify', category: 'framework', deps: ['fastify'] },
  { name: 'hono', category: 'framework', deps: ['hono'] },
  { name: 'koa', category: 'framework', deps: ['koa'] },
  { name: 'nest', category: 'framework', deps: ['@nestjs/core'] },
  { name: 'remix', category: 'framework', deps: ['@remix-run/node', '@remix-run/react'] },
  { name: 'astro', category: 'framework', deps: ['astro'] },

  // Build tools
  { name: 'vite', category: 'build', configFiles: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'] },
  { name: 'webpack', category: 'build', configFiles: ['webpack.config.js', 'webpack.config.ts'], deps: ['webpack'] },
  { name: 'rollup', category: 'build', configFiles: ['rollup.config.js', 'rollup.config.ts'], deps: ['rollup'] },
  { name: 'esbuild', category: 'build', deps: ['esbuild'] },
  { name: 'tsup', category: 'build', configFiles: ['tsup.config.ts'] },
  { name: 'turbopack', category: 'build', deps: ['@turbo/gen'] },
  { name: 'babel', category: 'build', configFiles: ['babel.config.js', '.babelrc'] },

  // Test frameworks
  { name: 'vitest', category: 'test', configFiles: ['vitest.config.ts', 'vitest.config.js'], deps: ['vitest'] },
  { name: 'jest', category: 'test', configFiles: ['jest.config.js', 'jest.config.ts'], deps: ['jest'] },
  { name: 'mocha', category: 'test', deps: ['mocha'] },
  { name: 'playwright', category: 'test', configFiles: ['playwright.config.ts', 'playwright.config.js'] },
  { name: 'cypress', category: 'test', configFiles: ['cypress.config.ts', 'cypress.config.js'] },
  { name: 'pytest', category: 'test', configFiles: ['pytest.ini', 'pyproject.toml'], deps: ['pytest'] },
  { name: 'rspec', category: 'test', deps: ['rspec'] },
  { name: 'go-test', category: 'test', filePatterns: ['*_test.go'] },

  // Linting/formatting
  { name: 'eslint', category: 'linter', configFiles: ['.eslintrc.js', '.eslintrc.json', 'eslint.config.js', 'eslint.config.mjs'] },
  { name: 'prettier', category: 'linter', configFiles: ['.prettierrc', 'prettier.config.js'] },
  { name: 'biome', category: 'linter', configFiles: ['biome.json'] },
  { name: 'ruff', category: 'linter', configFiles: ['ruff.toml', 'pyproject.toml'], deps: ['ruff'] },

  // Python
  { name: 'django', category: 'framework', configFiles: ['manage.py'], deps: ['django'] },
  { name: 'flask', category: 'framework', deps: ['flask'] },
  { name: 'fastapi', category: 'framework', deps: ['fastapi'] },
  { name: 'poetry', category: 'build', configFiles: ['pyproject.toml'] },

  // Go
  { name: 'go-mod', category: 'build', configFiles: ['go.mod'] },
  { name: 'gin', category: 'framework', deps: ['github.com/gin-gonic/gin'] },
  { name: 'echo', category: 'framework', deps: ['github.com/labstack/echo'] },
  { name: 'fiber', category: 'framework', deps: ['github.com/gofiber/fiber'] },

  // Rust
  { name: 'cargo', category: 'build', configFiles: ['Cargo.toml'] },
  { name: 'actix-web', category: 'framework', deps: ['actix-web'] },
  { name: 'rocket', category: 'framework', deps: ['rocket'] },
  { name: 'axum', category: 'framework', deps: ['axum'] },

  // Ruby
  { name: 'rails', category: 'framework', configFiles: ['config/routes.rb', 'config/application.rb'] },
  { name: 'sinatra', category: 'framework', deps: ['sinatra'] },

  // Java
  { name: 'spring-boot', category: 'framework', filePatterns: ['*Application.java'] },
  { name: 'gradle', category: 'build', configFiles: ['build.gradle', 'build.gradle.kts'] },
  { name: 'maven', category: 'build', configFiles: ['pom.xml'] },

  // Database
  { name: 'prisma', category: 'framework', configFiles: ['prisma/schema.prisma'] },
  { name: 'drizzle', category: 'framework', deps: ['drizzle-orm'] },
  { name: 'typeorm', category: 'framework', deps: ['typeorm'] },
  { name: 'sqlalchemy', category: 'framework', deps: ['sqlalchemy'] },

  // Misc
  { name: 'tailwindcss', category: 'framework', configFiles: ['tailwind.config.js', 'tailwind.config.ts'] },
  { name: 'graphql', category: 'framework', deps: ['graphql', '@apollo/server'] },
  { name: 'trpc', category: 'framework', deps: ['@trpc/server'] },
  { name: 'docker', category: 'runtime', configFiles: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'] },
];

// ─── Detection ────────────────────────────────────────────────────
export interface Detected {
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  linters: string[];
  runtimes: string[];
  packageManager: string;
}

export function detectAll(root: string, packageDeps?: Record<string, string>): Detected {
  const frameworks: string[] = [];
  const buildTools: string[] = [];
  const testFrameworks: string[] = [];
  const linters: string[] = [];
  const runtimes: string[] = [];

  const depNames = packageDeps
    ? new Set([...Object.keys(packageDeps), ...Object.keys(packageDeps).flatMap(k => [k, ...(packageDeps[k]?.split('/') ?? [])])])
    : new Set<string>();

  for (const sig of SIGNATURES) {
    let matched = false;

    // Check config files
    if (sig.configFiles) {
      for (const cf of sig.configFiles) {
        if (existsSync(join(root, cf))) {
          matched = true;
          break;
        }
      }
    }

    // Check dependencies
    if (!matched && sig.deps) {
      for (const dep of sig.deps) {
        if (depNames.has(dep)) {
          matched = true;
          break;
        }
      }
    }

    // Check file patterns (simple glob check via package info or known dirs)
    if (!matched && sig.filePatterns) {
      for (const pattern of sig.filePatterns) {
        if (pattern.includes('*')) {
          // We can't glob here, but we check if the extension is common
          // This is a heuristic — proper detection uses the walker
          matched = false;
        } else if (existsSync(join(root, pattern))) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      switch (sig.category) {
        case 'framework': frameworks.push(sig.name); break;
        case 'build': buildTools.push(sig.name); break;
        case 'test': testFrameworks.push(sig.name); break;
        case 'linter': linters.push(sig.name); break;
        case 'runtime': runtimes.push(sig.name); break;
      }
    }
  }

  // Package manager detection
  let packageManager = 'unknown';
  if (existsSync(join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (existsSync(join(root, 'yarn.lock'))) packageManager = 'yarn';
  else if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) packageManager = 'bun';
  else if (existsSync(join(root, 'package-lock.json'))) packageManager = 'npm';
  else if (existsSync(join(root, 'Cargo.lock'))) packageManager = 'cargo';
  else if (existsSync(join(root, 'go.sum'))) packageManager = 'go-mod';
  else if (existsSync(join(root, 'Pipfile.lock'))) packageManager = 'pipenv';
  else if (existsSync(join(root, 'poetry.lock'))) packageManager = 'poetry';
  else if (existsSync(join(root, 'Gemfile.lock'))) packageManager = 'bundler';
  else if (existsSync(join(root, 'gradle.lockfile'))) packageManager = 'gradle';
  else if (existsSync(join(root, 'package.json'))) packageManager = 'npm'; // fallback

  return { frameworks, buildTools, testFrameworks, linters, runtimes, packageManager };
}

/** Parse package.json and return relevant fields */
export function parsePackageJson(root: string): Record<string, unknown> | null {
  const pkgPath = join(root, 'package.json');
  const content = readFileSafe(pkgPath);
  if (!content) return null;

  try {
    const pkg = JSON.parse(content);
    return {
      name: pkg.name,
      type: pkg.type ?? 'commonjs',
      workspaces: pkg.workspaces,
      dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).length : 0,
      depNames: pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 30) : [],
      devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0,
      devDepNames: pkg.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 30) : [],
      scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
      main: pkg.main,
      bin: pkg.bin,
      engines: pkg.engines,
    };
  } catch {
    return null;
  }
}
