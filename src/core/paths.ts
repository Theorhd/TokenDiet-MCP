import { resolve, relative, normalize, basename, join, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Expand tilde ~ in path */
export function expandHome(filePath: string): string {
  if (!filePath) return filePath;
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return join(homedir(), filePath.slice(2));
  }
  return filePath;
}

/** Convert path separators to POSIX / */
export function toPosix(filePath: string): string {
  return filePath.split(sep).join('/');
}

/** Canonicalize and resolve a project root */
export function resolveRoot(root?: string): string {
  const candidate = root ?? process.env.INIT_CWD ?? process.cwd();
  const expanded = expandHome(candidate);
  const resolved = resolve(expanded);
  if (!existsSync(resolved)) {
    throw new Error(`Project root does not exist: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Project root is not a directory: ${resolved}`);
  }
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Check if a target path is safely contained inside the root directory */
export function isPathInside(root: string, targetPath: string): boolean {
  try {
    const resolvedRoot = resolveRoot(root);
    const resolvedTarget = resolve(resolvedRoot, expandHome(targetPath));
    const rel = relative(resolvedRoot, resolvedTarget);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      return false;
    }
    try {
      if (existsSync(resolvedTarget)) {
        const realTarget = realpathSync(resolvedTarget);
        const realRel = relative(resolvedRoot, realTarget);
        if (realRel === '..' || realRel.startsWith('..' + sep) || isAbsolute(realRel)) {
          return false;
        }
      }
    } catch {}
    return true;
  } catch {
    return false;
  }
}

/** Resolve a target path securely within root, throwing if path traversal is attempted */
export function resolveSecurePath(root: string, targetPath: string): string {
  const resolvedRoot = resolveRoot(root);
  const resolvedTarget = resolve(resolvedRoot, expandHome(targetPath));
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Access denied: path '${targetPath}' escapes project root`);
  }
  try {
    if (existsSync(resolvedTarget)) {
      const realTarget = realpathSync(resolvedTarget);
      const realRel = relative(resolvedRoot, realTarget);
      if (realRel === '..' || realRel.startsWith('..' + sep) || isAbsolute(realRel)) {
        throw new Error(`Access denied: symlink path '${targetPath}' escapes project root`);
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes('Access denied')) throw err;
  }
  return resolvedTarget;
}

/** Get a stable display path relative to root in POSIX format */
export function displayPath(root: string, filePath: string): string {
  const rel = relative(root, filePath);
  if (rel.startsWith('..')) {
    return toPosix(filePath);
  }
  return toPosix(normalize(rel));
}

/** Cache directory: macOS ~/Library/Caches/tokendiet, else XDG_CACHE_HOME */
export function getCacheDir(): string {
  if (process.env.TOKENDIET_CACHE_DIR) {
    return resolve(expandHome(process.env.TOKENDIET_CACHE_DIR));
  }
  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library', 'Caches', 'tokendiet');
  }
  const xdg = process.env.XDG_CACHE_HOME ?? resolve(homedir(), '.cache');
  return resolve(expandHome(xdg), 'tokendiet');
}

/** Stable SHA-256 hash for project root → DB filename */
export function hashRoot(root: string): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 16);
}

/** Guess file role from path */
export function guessRole(filePath: string): string {
  const normalized = toPosix(filePath);
  const b = basename(filePath);
  if (/^(index|main|app|server)\.\w+$/.test(b)) return 'entry-point';
  if (/\.(test|spec)\.\w+$/.test(normalized) || normalized.includes('/test/') || normalized.includes('/tests/') || normalized.includes('/__tests__/')) return 'test';
  if (normalized.includes('/component')) return 'component';
  if (/\.config\.\w+$/.test(b) || normalized.includes('/config/')) return 'config';
  if (normalized.includes('/util') || normalized.includes('/helper')) return 'utility';
  if (normalized.includes('/hook') || normalized.includes('/composable')) return 'hook';
  if (normalized.includes('/middleware')) return 'middleware';
  if (normalized.includes('/route') || normalized.includes('/page')) return 'route';
  if (normalized.includes('/service') || normalized.includes('/api')) return 'service';
  if (normalized.includes('/model') || normalized.includes('/schema') || normalized.includes('/entity')) return 'model';
  return 'source';
}
