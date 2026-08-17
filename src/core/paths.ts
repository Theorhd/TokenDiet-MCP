import { resolve, relative, normalize, basename } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, realpathSync } from 'node:fs';

/** Canonicalize and resolve a project root */
export function resolveRoot(root?: string): string {
  const candidate = root ?? process.env.INIT_CWD ?? process.cwd();
  const resolved = resolve(candidate);
  if (!existsSync(resolved)) {
    throw new Error(`Project root does not exist: ${resolved}`);
  }
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Get a stable display path relative to root */
export function displayPath(root: string, filePath: string): string {
  const rel = relative(root, filePath);
  return rel.startsWith('..') ? filePath : normalize(rel);
}

/** Cache directory: macOS ~/Library/Caches/tokendiet, else XDG_CACHE_HOME */
export function getCacheDir(): string {
  if (process.env.TOKENDIET_CACHE_DIR) {
    return resolve(process.env.TOKENDIET_CACHE_DIR);
  }
  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library', 'Caches', 'tokendiet');
  }
  const xdg = process.env.XDG_CACHE_HOME ?? resolve(homedir(), '.cache');
  return resolve(xdg, 'tokendiet');
}

/** Simple hash for project root → DB filename */
export function hashRoot(root: string): string {
  let hash = 0;
  for (let i = 0; i < root.length; i++) {
    const ch = root.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/** Guess file role from path */
export function guessRole(filePath: string): string {
  const b = basename(filePath);
  if (/^(index|main|app|server)\.\w+$/.test(b)) return 'entry-point';
  if (/\.(test|spec)\.\w+$/.test(filePath) || filePath.includes('/test/') || filePath.includes('/__tests__/')) return 'test';
  if (filePath.includes('/component')) return 'component';
  if (/\.config\.\w+$/.test(b) || filePath.includes('/config/')) return 'config';
  if (filePath.includes('/util') || filePath.includes('/helper')) return 'utility';
  if (filePath.includes('/hook') || filePath.includes('/composable')) return 'hook';
  if (filePath.includes('/middleware')) return 'middleware';
  if (filePath.includes('/route') || filePath.includes('/page')) return 'route';
  if (filePath.includes('/service') || filePath.includes('/api')) return 'service';
  if (filePath.includes('/model') || filePath.includes('/schema') || filePath.includes('/entity')) return 'model';
  return 'source';
}
