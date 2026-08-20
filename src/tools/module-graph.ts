import { resolve, basename } from 'node:path';
import { resolveRoot, displayPath, toPosix } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { parseFile } from '../parsers/index.js';
import { readFileSafe, extractPackageName, resolveImportPath } from '../core/utils.js';
import type { ModuleGraph, GraphNode, GraphEdge } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface ModuleGraphOptions {
  module?: string;
  depth?: number;
  direction?: 'out' | 'in' | 'both';
  maxEdges?: number;
  aggregate?: boolean;
}

export async function getModuleGraph(
  root: string | undefined,
  cache: CacheManager,
  options: ModuleGraphOptions = {},
): Promise<ModuleGraph> {
  const projectRoot = resolveRoot(root);
  const {
    module,
    depth,
    direction = 'out',
    maxEdges = 200,
    aggregate = true,
  } = options;

  let allNodes: GraphNode[] = [];
  let allEdges: GraphEdge[] = [];
  const externalCounts: Record<string, number> = {};

  const indexedAt = cache.getIndexedAt();

  if (indexedAt) {
    // ── 1. Cache-first graph construction ──
    const files = cache.getAllFiles();
    const filesWithSymbols = new Map(cache.getFilesWithSymbols().map(f => [f.path, f]));
    const knownFiles = new Set<string>();

    for (const f of files) {
      const posixPath = toPosix(f.path);
      knownFiles.add(posixPath);
      allNodes.push({
        id: posixPath,
        lang: f.lang,
        exportCount: filesWithSymbols.get(f.path)?.lines ?? 0,
        size: f.bytes,
      });
    }

    const cachedImports = cache.getImportGraph('');
    for (const imp of cachedImports) {
      if (imp.isExternal) {
        const pkg = extractPackageName(imp.to);
        externalCounts[pkg] = (externalCounts[pkg] || 0) + 1;
      } else {
        const fromPosix = toPosix(imp.from);
        const resolvedTarget = resolveImportTarget(fromPosix, imp.to, knownFiles);
        if (resolvedTarget) {
          allEdges.push({
            from: fromPosix,
            to: resolvedTarget,
            kind: 'import',
            via: imp.names,
          });
        }
      }
    }
  } else {
    // ── 2. Fallback: walk and parse ──
    const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
    const sourceFiles = result.entries.filter(e => !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cs', 'rb', 'php'].includes(e.lang));
    const knownFilesSet = new Set(sourceFiles.map(f => toPosix(f.relative)));

    for (const file of sourceFiles) {
      const relPath = toPosix(file.relative);
      const content = readFileSafe(file.path);
      if (!content) continue;

      const parsed = parseFile(file.path, content);
      allNodes.push({
        id: relPath,
        lang: file.lang,
        exportCount: parsed.exports.length,
        size: file.size,
      });

      for (const imp of parsed.imports) {
        if (imp.isExternal) {
          const pkg = extractPackageName(imp.from);
          externalCounts[pkg] = (externalCounts[pkg] || 0) + 1;
          continue;
        }

        const candidates = resolveImportPath(file.path, imp.from);
        for (const candidate of candidates) {
          const candidateRel = toPosix(displayPath(projectRoot, candidate));
          if (knownFilesSet.has(candidateRel)) {
            allEdges.push({
              from: relPath,
              to: candidateRel,
              kind: 'import',
              via: imp.names,
            });
          }
        }
      }
    }
  }

  // ── 3. Module & Depth / Direction filtering ──
  let filteredNodes = allNodes;
  let filteredEdges = allEdges;

  if (module) {
    const targetModule = toPosix(displayPath(projectRoot, resolve(projectRoot, module))).replace(/\/$/, '');
    const activeNodes = new Set<string>();

    // Find initial matching nodes
    for (const n of allNodes) {
      if (n.id === targetModule || n.id.startsWith(targetModule + '/')) {
        activeNodes.add(n.id);
      }
    }

    if (depth !== undefined && depth > 0) {
      const nodeQueue: Array<{ id: string; d: number }> = Array.from(activeNodes).map(id => ({ id, d: 0 }));

      // Build adjacency maps
      const outAdj = new Map<string, string[]>();
      const inAdj = new Map<string, string[]>();
      for (const e of allEdges) {
        if (!outAdj.has(e.from)) outAdj.set(e.from, []);
        outAdj.get(e.from)!.push(e.to);

        if (!inAdj.has(e.to)) inAdj.set(e.to, []);
        inAdj.get(e.to)!.push(e.from);
      }

      // Traverse up to depth
      while (nodeQueue.length > 0) {
        const { id, d } = nodeQueue.shift()!;
        if (d >= depth) continue;

        if (direction === 'out' || direction === 'both') {
          const nextOut = outAdj.get(id) || [];
          for (const next of nextOut) {
            if (!activeNodes.has(next)) {
              activeNodes.add(next);
              nodeQueue.push({ id: next, d: d + 1 });
            }
          }
        }

        if (direction === 'in' || direction === 'both') {
          const nextIn = inAdj.get(id) || [];
          for (const next of nextIn) {
            if (!activeNodes.has(next)) {
              activeNodes.add(next);
              nodeQueue.push({ id: next, d: d + 1 });
            }
          }
        }
      }
    }

    filteredNodes = allNodes.filter(n => activeNodes.has(n.id));
    filteredEdges = allEdges.filter(e => activeNodes.has(e.from) && activeNodes.has(e.to));
  }

  // ── 4. Find hubs ──
  const inDegree = new Map<string, number>();
  for (const edge of filteredEdges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }
  const hubs = Array.from(inDegree.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id]) => id);

  // ── 5. Exact cycle detection via Tarjan's SCC in O(V + E) ──
  const cycles = findCyclesTarjan(filteredNodes.map(n => n.id), filteredEdges);

  // ── 6. Aggregate by directory if requested ──
  if (aggregate && !module) {
    const aggNodes = aggregateNodes(filteredNodes);
    const aggEdges = aggregateEdges(filteredEdges);
    return {
      scope: `dir:${toPosix(projectRoot).split('/').pop()}`,
      nodes: aggNodes,
      edges: aggEdges.slice(0, maxEdges),
      external: Object.fromEntries(
        Object.entries(externalCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 20),
      ),
      hubs: hubs.map(h => aggregateNodeId(h)).slice(0, 10),
      cycles: cycles.map(c => c.map(aggregateNodeId)),
      _truncated: aggEdges.length > maxEdges ? `${maxEdges} edges max reached` : undefined,
    };
  }

  return {
    scope: module ? `file:${module}` : `dir:${toPosix(projectRoot).split('/').pop()}`,
    nodes: filteredNodes,
    edges: filteredEdges.slice(0, maxEdges),
    external: Object.fromEntries(
      Object.entries(externalCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20),
    ),
    hubs,
    cycles,
    _truncated: filteredEdges.length > maxEdges ? `${maxEdges} edges max reached` : undefined,
  };
}

/** Resolve relative or alias import spec to known file path */
function resolveImportTarget(
  fromFile: string,
  importSpec: string,
  knownFiles: Set<string>,
): string | null {
  const normFromFile = toPosix(fromFile);
  const lastSlash = normFromFile.lastIndexOf('/');
  const fromDir = lastSlash >= 0 ? normFromFile.substring(0, lastSlash) : '';

  let resolved: string;
  if (importSpec.startsWith('.')) {
    resolved = fromDir ? `${fromDir}/${importSpec}` : importSpec;
  } else if (importSpec.startsWith('/')) {
    resolved = importSpec.slice(1);
  } else {
    resolved = importSpec;
  }

  const parts = resolved.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') normalized.pop();
    else if (part !== '.' && part !== '') normalized.push(part);
  }
  resolved = normalized.join('/');

  if (knownFiles.has(resolved)) return resolved;

  const extMatch = resolved.match(/\.(js|jsx|mjs|cjs)$/);
  if (extMatch) {
    const base = resolved.slice(0, -extMatch[0].length);
    const altExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
    for (const ext of altExtensions) {
      const candidate = base + ext;
      if (candidate !== resolved && knownFiles.has(candidate)) return candidate;
    }
    for (const idx of ['/index.ts', '/index.js', '/index.tsx']) {
      const candidate = base + idx;
      if (knownFiles.has(candidate)) return candidate;
    }
  }

  const extensions = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
    '.py', '.go', '.rs', '.java', '.rb', '.cs', '.php',
    '/index.ts', '/index.js', '/index.tsx', '/index.py', '/index.go', '/index.rs',
  ];

  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}

/** Aggregate node IDs intelligently at subfolder level (e.g. src/core/* instead of src/*) */
function aggregateNodeId(id: string): string {
  const parts = toPosix(id).split('/');
  if (parts.length <= 1) return id;
  if (parts.length === 2) return `${parts[0]}/*`;
  return `${parts[0]}/${parts[1]}/*`;
}

function aggregateNodes(nodes: GraphNode[]): GraphNode[] {
  const groups = new Map<string, GraphNode>();
  for (const node of nodes) {
    const groupId = aggregateNodeId(node.id);
    const existing = groups.get(groupId);
    if (existing) {
      existing.exportCount += node.exportCount;
      existing.size += node.size;
    } else {
      groups.set(groupId, { ...node, id: groupId });
    }
  }
  return Array.from(groups.values());
}

function aggregateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];
  for (const edge of edges) {
    const from = aggregateNodeId(edge.from);
    const to = aggregateNodeId(edge.to);
    if (from === to) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ from, to, kind: edge.kind, via: [] });
  }
  return result;
}

/** Tarjan's Strongly Connected Components algorithm for O(V + E) cycle detection */
function findCyclesTarjan(nodeIds: string[], edges: GraphEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(node: string) {
    indices.set(node, index);
    lowlinks.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);

    const neighbors = adj.get(node) || [];
    for (const next of neighbors) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlinks.set(node, Math.min(lowlinks.get(node)!, lowlinks.get(next)!));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node)!, indices.get(next)!));
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== node);

      if (scc.length > 1 || (adj.get(node) || []).includes(node)) {
        sccs.push(scc);
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) {
      strongConnect(id);
    }
  }

  return sccs.slice(0, 10);
}
