import { walk, countLines, countFilesInDir, countLocInDir } from '../core/walker.js';
import { resolveRoot, displayPath } from '../core/paths.js';
import { formatBytes } from '../core/utils.js';
import type { CacheManager } from '../core/cache.js';

export interface DirectoryTreeOptions {
  path?: string;
  depth?: number;
  dirsOnly?: boolean;
  includeTests?: boolean;
  maxEntries?: number;
  format?: 'text' | 'json';
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  lang: string;
  children: TreeNode[];
  fileCount: number;
  totalLoc: number;
  entryPoint: boolean;
}

export async function getDirectoryTree(
  root: string | undefined,
  cache: CacheManager,
  options: DirectoryTreeOptions = {},
): Promise<string> {
  const projectRoot = resolveRoot(root);
  const {
    depth = 3,
    dirsOnly = false,
    includeTests = true,
    maxEntries = 200,
    format = 'text',
  } = options;

  const result = walk(projectRoot, {
    maxDepth: depth,
    includeTests,
    dirsOnly,
    maxFiles: maxEntries,
  });

  if (format === 'json') {
    return JSON.stringify({
      tree: buildJsonTree(result.entries, projectRoot, depth),
      _partial: result.partial || undefined,
      _truncated: result.partial ? `${result.skipped} entries skipped` : undefined,
    });
  }

  // Build text tree
  return buildTextTree(result.entries, projectRoot, depth, result.partial);
}

function buildTextTree(
  entries: { path: string; relative: string; isDir: boolean; size: number; lang: string }[],
  root: string,
  maxDepth: number,
  partial: boolean,
): string {
  const lines: string[] = [];
  const rootName = root.split('/').pop() ?? root;

  // Count files in root
  const rootFiles = entries.filter(e => !e.isDir && !e.relative.includes('/')).length;
  const rootLoc = entries
    .filter(e => !e.isDir && !e.relative.includes('/'))
    .reduce((sum, e) => sum + countLines(e.path), 0);
  const rootSize = entries
    .filter(e => !e.isDir && !e.relative.includes('/'))
    .reduce((sum, e) => sum + e.size, 0);

  lines.push(`${rootName}/ (${rootFiles} files, ${rootLoc} LOC, ${formatBytes(rootSize)})`);

  // Build a tree structure
  const tree = buildTree(entries);
  renderTree(tree, '', true, root, lines, 0, maxDepth);

  if (partial) {
    lines.push('...');
    lines.push('(_truncated: max entries reached)');
  }

  return lines.join('\n');
}

interface DirNode {
  name: string;
  files: { name: string; path: string; size: number; lang: string }[];
  dirs: Map<string, DirNode>;
}

function buildTree(entries: { path: string; relative: string; isDir: boolean; size: number; lang: string }[]): DirNode {
  const root: DirNode = { name: '', files: [], dirs: new Map() };

  for (const entry of entries) {
    if (entry.relative === '' || entry.relative === '.') continue;
    const parts = entry.relative.split('/');

    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      if (i === parts.length - 1 && !entry.isDir) {
        current.files.push({ name: part, path: entry.path, size: entry.size, lang: entry.lang });
      } else if (entry.isDir || i < parts.length - 1) {
        if (!current.dirs.has(part)) {
          current.dirs.set(part, { name: part, files: [], dirs: new Map() });
        }
        current = current.dirs.get(part)!;
      }
    }
  }

  return root;
}

function renderTree(
  node: DirNode,
  prefix: string,
  isRoot: boolean,
  rootPath: string,
  lines: string[],
  depth: number,
  maxDepth: number,
): void {
  if (depth >= maxDepth) return;

  const dirs = Array.from(node.dirs.entries()).sort(([a], [b]) => a.localeCompare(b));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  const totalItems = dirs.length + files.length;

  for (let i = 0; i < dirs.length; i++) {
    const [name, dir] = dirs[i]!;
    const isLast = i === dirs.length - 1 && files.length === 0;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    const fileCount = countFilesRecursive(dir);
    const loc = countLocRecursive(dir, rootPath);
    const entryMarker = isEntryPoint(name) ? ' *' : '';
    lines.push(`${prefix}${connector}${name}/ (${fileCount} files, ${loc} LOC)${entryMarker}`);

    renderTree(dir, prefix + childPrefix, false, rootPath, lines, depth + 1, maxDepth);
  }

  for (let i = 0; i < Math.min(files.length, 50); i++) {
    const file = files[i]!;
    const isLast = i === Math.min(files.length, 50) - 1;
    const connector = isLast ? '└── ' : '├── ';
    const loc = countLines(file.path);
    const entryMarker = isEntryPoint(file.name) ? ' *' : '';
    lines.push(`${prefix}${connector}${file.name} [${file.lang} ${formatBytes(file.size)} ${loc}L]${entryMarker}`);
  }

  if (files.length > 50) {
    lines.push(`${prefix}└── ... and ${files.length - 50} more files`);
  }
}

function countFilesRecursive(node: DirNode): number {
  let count = node.files.length;
  for (const dir of node.dirs.values()) {
    count += countFilesRecursive(dir);
  }
  return count;
}

function countLocRecursive(node: DirNode, rootPath: string): number {
  let loc = 0;
  for (const file of node.files) {
    loc += countLines(file.path);
  }
  for (const dir of node.dirs.values()) {
    loc += countLocRecursive(dir, rootPath);
  }
  return loc;
}

function isEntryPoint(name: string): boolean {
  const entryNames = ['index.ts', 'index.tsx', 'index.js', 'index.jsx',
    'main.ts', 'main.tsx', 'main.js', 'app.ts', 'app.tsx',
    'server.ts', 'server.js', 'main.go', 'main.rs', 'main.py',
    '__init__.py', 'lib.rs', 'mod.rs'];
  return entryNames.includes(name);
}

// ─── JSON format ─────────────────────────────────────────────────
function buildJsonTree(
  entries: { path: string; relative: string; isDir: boolean; size: number; lang: string }[],
  root: string,
  maxDepth: number,
): Record<string, unknown> {
  const tree = buildTree(entries);
  return nodeToJson(tree, root, 0, maxDepth);
}

function nodeToJson(node: DirNode, rootPath: string, depth: number, maxDepth: number): Record<string, unknown> {
  const children: Record<string, unknown> = {};
  if (depth < maxDepth) {
    for (const [name, dir] of node.dirs) {
      children[name + '/'] = nodeToJson(dir, rootPath, depth + 1, maxDepth);
    }
  }
  const files: Record<string, { lang: string; size: number; loc: number }> = {};
  for (const file of node.files.slice(0, 100)) {
    files[file.name] = {
      lang: file.lang,
      size: file.size,
      loc: countLines(file.path),
    };
  }
  return { ...children, ...files };
}
