import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Read file contents safely */
export function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Truncate text with ellipsis marker */
export function truncate(text: string, maxLen: number, suffix = '…'): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - suffix.length) + suffix;
}

/** Get first sentence of a JSDoc/docstring comment block */
export function firstDocSentence(comment: string): string {
  // Strip comment markers
  let cleaned = comment
    .replace(/^\/\*\*\s*/, '')
    .replace(/\s*\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '')
    .trim();

  // For Python docstrings
  cleaned = cleaned.replace(/^"""\s*/, '').replace(/\s*"""$/, '').trim();
  cleaned = cleaned.replace(/^'''\s*/, '').replace(/\s*'''$/, '').trim();

  // Take first sentence
  const match = cleaned.match(/^([^.!?]+[.!?])/);
  if (match) return truncate(match[1].trim(), 200);

  return truncate(cleaned.split('\n')[0]?.trim() ?? '', 200);
}

/** Check if file exists */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/** Token budget guard — estimate JSON tokens (~1 token per 3-4 chars for English) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Enforce a token budget on output */
export function enforceTokenBudget<T extends Record<string, unknown>>(
  data: T,
  maxTokens: number,
  truncationKey: string,
): T & { _truncated?: string } {
  const json = JSON.stringify(data);
  const tokens = estimateTokens(json);
  if (tokens <= maxTokens) return data;
  return { ...data, _truncated: `Output exceeds ${maxTokens} tokens (est. ${tokens}). Use more specific queries.` };
}

/** Resolve a relative import to possible files on disk */
export function resolveImportPath(
  fromFile: string,
  importSpec: string,
): string[] {
  // Skip external imports
  if (!importSpec.startsWith('.') && !importSpec.startsWith('/')) return [];

  const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  const resolved = join(fromDir, importSpec);

  const candidates: string[] = [];
  if (existsSync(resolved)) {
    candidates.push(resolved);
  }

  // If import ends with .js, .jsx, .mjs, .cjs, probe corresponding .ts/.tsx/.mts/.cts files
  const extMatch = resolved.match(/\.(js|jsx|mjs|cjs)$/);
  if (extMatch) {
    const base = resolved.slice(0, -extMatch[0].length);
    const altExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
    for (const ext of altExtensions) {
      const candidate = base + ext;
      if (candidate !== resolved && existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
    for (const idx of ['/index.ts', '/index.tsx', '/index.mts', '/index.js']) {
      const candidate = base + idx;
      if (existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  // Common extensions to probe if extension omitted or for directory imports
  const extensions = [
    '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java', '.rb',
    '/index.ts', '/index.tsx', '/index.mts', '/index.js', '/index.jsx',
    '/index.py', '/index.go', '/index.rs',
    '/__init__.py',
  ];

  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (existsSync(candidate)) {
      candidates.push(candidate);
    }
  }
  return Array.from(new Set(candidates));
}

/** Extract the module/package name from an import path */
export function extractPackageName(importPath: string): string {
  // Scoped packages: @scope/name/sub → @scope/name
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    if (parts.length >= 2) return parts.slice(0, 2).join('/');
  }
  return importPath.split('/')[0] ?? importPath;
}

/** Format bytes to human-readable */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Environment variable helpers */
export const ENV = {
  maxTokens: parseInt(process.env.TOKENDIET_MAX_TOKENS ?? '3000', 10),
  maxFiles: parseInt(process.env.TOKENDIET_MAX_FILES ?? '20000', 10),
  disableTreeSitter: process.env.TOKENDIET_DISABLE_TREE_SITTER === '1',
  cacheDir: process.env.TOKENDIET_CACHE_DIR,
};
