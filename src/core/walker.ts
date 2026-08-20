import { openSync, readSync, closeSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import ignore from 'ignore';
import { toPosix } from './paths.js';

// ─── Always-skip patterns ───────────────────────────────────────
const ALWAYS_SKIP = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt',
  'target', 'vendor', '.venv', 'venv', '__pycache__', '.tox',
  'coverage', '.nyc_output', '.cache', '.turbo', '.parcel-cache',
]);

const ALLOWED_DOT_NAMES = new Set([
  '.github', '.circleci', '.cargo', '.gitlab-ci.yml',
  '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml',
  '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yaml', '.prettierrc.yml',
  '.env.example', '.env.template', '.env.sample',
  '.dockerignore', '.editorconfig', '.babelrc',
]);

const SKIP_EXTENSIONS = new Set([
  '.min.js', '.min.css', '.map', '.lock', '.wasm',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.webm', '.mov', '.avi',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.sqlite', '.db', '.sqlite3',
  '.pyc', '.pyo', '.class',
]);

// ─── Language detection by extension ────────────────────────────
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const multi = filePath.split('.').slice(-2).join('.').toLowerCase();
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
    py: 'py', pyi: 'py',
    go: 'go',
    rs: 'rs',
    java: 'java',
    rb: 'rb', erb: 'rb',
    cs: 'cs',
    php: 'php',
    css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'md', mdx: 'mdx',
    sql: 'sql',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    dockerfile: 'dockerfile',
    xml: 'xml',
    graphql: 'graphql', gql: 'graphql',
    proto: 'proto',
  };
  return map[multi] ?? map[ext] ?? 'other';
}

/** Check if a file should be skipped based on extension */
export function shouldSkipFile(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? filePath;
  for (const skip of SKIP_EXTENSIONS) {
    if (name.endsWith(skip)) return true;
  }
  // Skip lockfiles
  if (name === 'package-lock.json' || name === 'yarn.lock' ||
      name === 'pnpm-lock.yaml' || name === 'Cargo.lock' ||
      name === 'Gemfile.lock' || name === 'poetry.lock' ||
      name === 'Pipfile.lock') {
    return true;
  }
  // Skip minified
  if (name.includes('.min.') && (name.endsWith('.js') || name.endsWith('.css'))) return true;
  return false;
}

// ─── Gitignore loading ──────────────────────────────────────────
function loadGitignore(dir: string): ignore.Ignore | null {
  try {
    const giPath = join(dir, '.gitignore');
    const fd = openSync(giPath, 'r');
    const buffer = Buffer.alloc(16384);
    let content = '';
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      content += buffer.toString('utf-8', 0, bytesRead);
    }
    closeSync(fd);
    const ig = ignore();
    ig.add(content);
    return ig;
  } catch {
    return null;
  }
}

// ─── Walker types ───────────────────────────────────────────────
export interface WalkEntry {
  path: string;       // absolute path
  relative: string;   // relative to root in POSIX /
  isDir: boolean;
  size: number;       // 0 for dirs
  lang: string;
}

export interface WalkOptions {
  maxDepth?: number;       // default 8
  maxFiles?: number;       // default 20000
  includeTests?: boolean;
  dirsOnly?: boolean;
}

export interface WalkResult {
  entries: WalkEntry[];
  skipped: number;
  partial: boolean;
}

// ─── Walk implementation ────────────────────────────────────────
export function walk(root: string, options: WalkOptions = {}): WalkResult {
  const {
    maxDepth = 8,
    maxFiles = 20000,
    includeTests = true,
    dirsOnly = false,
  } = options;

  const entries: WalkEntry[] = [];
  let skipped = 0;
  let partial = false;

  const visitedRealPaths = new Set<string>();
  try {
    visitedRealPaths.add(realpathSync(root));
  } catch {
    // Ignore error getting root realpath
  }

  // Stack of gitignore instances: root-level → current dir
  const igStack: ignore.Ignore[] = [];
  const rootIg = loadGitignore(root);
  if (rootIg) igStack.push(rootIg);

  function shouldIgnore(relPath: string): boolean {
    const name = relPath.split('/').pop() ?? relPath;
    if (ALWAYS_SKIP.has(name)) return true;
    if (name.startsWith('.') && !ALLOWED_DOT_NAMES.has(name)) return true; // hidden files/dirs unless allowed
    for (const ig of igStack) {
      if (ig.ignores(relPath)) return true;
    }
    return false;
  }

  function walkDir(currentDir: string, depth: number): boolean {
    if (depth > maxDepth) return false;
    if (entries.length >= maxFiles) {
      partial = true;
      return false;
    }

    let contents: string[];
    try {
      contents = readdirSync(currentDir);
    } catch {
      skipped++;
      return true;
    }

    for (const name of contents.sort()) {
      if (entries.length >= maxFiles) {
        partial = true;
        return false;
      }

      const fullPath = join(currentDir, name);
      const relPath = toPosix(relative(root, fullPath));

      let isDir = false;
      let size = 0;
      try {
        const st = statSync(fullPath);
        isDir = st.isDirectory();
        size = st.size;
      } catch {
        skipped++;
        continue;
      }

      if (shouldIgnore(relPath)) {
        skipped++;
        continue;
      }

      // Handle symlinks and cycle prevention
      if (isDir) {
        let dirRealPath = fullPath;
        try {
          dirRealPath = realpathSync(fullPath);
        } catch {
          skipped++;
          continue;
        }

        if (visitedRealPaths.has(dirRealPath)) {
          skipped++;
          continue; // Prevent infinite cycle
        }
        visitedRealPaths.add(dirRealPath);

        entries.push({ path: fullPath, relative: relPath, isDir: true, size: 0, lang: '' });

        // Load any .gitignore at this level
        const dirIg = loadGitignore(fullPath);
        if (dirIg) igStack.push(dirIg);

        walkDir(fullPath, depth + 1);

        if (dirIg) igStack.pop();
      } else if (!dirsOnly) {
        if (shouldSkipFile(name)) {
          skipped++;
          continue;
        }

        // Skip test files if not including
        const firstSeg = relPath.split('/')[0];
        if (!includeTests && (
          name.includes('.test.') ||
          name.includes('.spec.') ||
          relPath.includes('/test/') ||
          relPath.includes('/tests/') ||
          relPath.includes('/__tests__/') ||
          firstSeg === 'test' ||
          firstSeg === 'tests' ||
          firstSeg === '__tests__'
        )) {
          skipped++;
          continue;
        }

        entries.push({
          path: fullPath,
          relative: relPath,
          isDir: false,
          size,
          lang: detectLanguage(name),
        });
      }
    }

    return true;
  }

  walkDir(root, 0);
  return { entries, skipped, partial };
}

/** Count lines in a file quickly via 64KB chunk streaming without large memory allocations */
export function countLines(filePath: string): number {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const buffer = Buffer.alloc(65536);
    let bytesRead = 0;
    let lines = 0;
    let hasBytes = false;

    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hasBytes = true;
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 10) { // '\n'
          lines++;
        }
      }
    }
    closeSync(fd);
    fd = null;
    return hasBytes ? lines + 1 : 0;
  } catch {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    return 0;
  }
}

/** Get file count for a directory entry */
export function countFilesInDir(entries: WalkEntry[], dirRelative: string): number {
  const normDir = toPosix(dirRelative);
  return entries.filter(e => !e.isDir && e.relative.startsWith(normDir + '/')).length;
}

/** Get total LOC for files in a directory */
export function countLocInDir(entries: WalkEntry[], dirRelative: string): number {
  const normDir = toPosix(dirRelative);
  return entries
    .filter(e => !e.isDir && e.relative.startsWith(normDir + '/'))
    .reduce((sum, e) => sum + countLines(e.path), 0);
}
