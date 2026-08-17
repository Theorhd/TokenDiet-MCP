import { resolveRoot, displayPath } from '../core/paths.js';
import { walk } from '../core/walker.js';
import { parseFile } from '../parsers/index.js';
import { readFileSafe, extractPackageName } from '../core/utils.js';
import { resolveImportPath } from '../core/utils.js';
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
    depth = 2,
    direction = 'out',
    maxEdges = 200,
    aggregate = true,
  } = options;

  // Get all files
  const result = walk(projectRoot, { maxDepth: 8, includeTests: true });
  const sourceFiles = result.entries.filter(e => !e.isDir && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs'].includes(e.lang));

  // Parse imports for each file (use cache when available)
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const externalCounts: Record<string, number> = {};
  let edgeCount = 0;

  // If module is specified, focus on it
  const focusModule = module ? displayPath(projectRoot, resolveRoot(module)) : null;

  for (const file of sourceFiles) {
    const relPath = file.relative;
    if (focusModule && !relPath.startsWith(focusModule.replace(/\/$/, ''))) continue;

    const content = readFileSafe(file.path);
    if (!content) continue;

    const parsed = parseFile(file.path, content);
    nodeIds.add(relPath);

    nodes.push({
      id: relPath,
      lang: file.lang,
      exportCount: parsed.exports.length,
      size: file.size,
    });

    // Process imports as edges
    for (const imp of parsed.imports) {
      if (imp.isExternal) {
        const pkg = extractPackageName(imp.from);
        externalCounts[pkg] = (externalCounts[pkg] || 0) + 1;
        continue;
      }

      const candidates = resolveImportPath(file.path, imp.from);
      for (const candidate of candidates) {
        const candidateRel = displayPath(projectRoot, candidate);
        if (nodeIds.has(candidateRel) || sourceFiles.some(f => f.relative === candidateRel)) {
          edges.push({
            from: relPath,
            to: candidateRel,
            kind: 'import',
            via: imp.names,
          });

          edgeCount++;
          if (edgeCount >= maxEdges) break;
        }
      }
      if (edgeCount >= maxEdges) break;
    }
    if (edgeCount >= maxEdges) break;
  }

  // Find hubs (high in-degree nodes)
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }
  const hubs = Array.from(inDegree.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id]) => id);

  // Find cycles (simple SCC via DFS — simplified)
  const cycles = findCycles(nodes.map(n => n.id), edges);

  // Aggregate by directory if requested
  if (aggregate && !module) {
    return {
      scope: `dir:${projectRoot.split('/').pop()}`,
      nodes: aggregateNodes(nodes),
      edges: aggregateEdges(edges),
      external: Object.fromEntries(
        Object.entries(externalCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 20),
      ),
      hubs: hubs.map(h => aggregateNodeId(h)),
      cycles: cycles.map(c => c.map(aggregateNodeId)),
      _truncated: edgeCount >= maxEdges ? `${maxEdges} edges max reached` : undefined,
    };
  }

  return {
    scope: module ? `file:${module}` : `dir:${projectRoot.split('/').pop()}`,
    nodes,
    edges: edges.slice(0, maxEdges),
    external: Object.fromEntries(
      Object.entries(externalCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20),
    ),
    hubs,
    cycles,
    _truncated: edgeCount >= maxEdges ? `${maxEdges} edges max reached` : undefined,
  };
}

function aggregateNodeId(id: string): string {
  const parts = id.split('/');
  if (parts.length <= 1) return id;
  return parts.slice(0, -1).join('/') + '/*';
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
    if (from === to) continue; // skip same-group edges
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ from, to, kind: edge.kind, via: [] });
  }
  return result.slice(0, 200);
}

function findCycles(nodeIds: string[], edges: GraphEdge[]): string[][] {
  // Simple DFS-based cycle detection (limited to small cycles, ≤5 nodes)
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to);
  }

  const cycles: string[][] = [];
  const MAX_CYCLES = 5;

  function dfs(start: string, current: string, visited: Set<string>, path: string[], depth: number): void {
    if (depth > 5 || cycles.length >= MAX_CYCLES) return;
    const neighbors = adj.get(current) || [];
    for (const next of neighbors) {
      if (next === start && path.length >= 2) {
        cycles.push([...path, start]);
        if (cycles.length >= MAX_CYCLES) return;
      }
      if (!visited.has(next)) {
        visited.add(next);
        path.push(next);
        dfs(start, next, visited, path, depth + 1);
        path.pop();
        visited.delete(next);
      }
    }
  }

  for (const id of nodeIds) {
    if (cycles.length >= MAX_CYCLES) break;
    dfs(id, id, new Set([id]), [id], 1);
  }

  return cycles;
}
