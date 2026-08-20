import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CacheManager } from './core/cache.js';
import { resolveRoot } from './core/paths.js';
import { treeSitterManager } from './parsers/treesitter.js';

// Tools
import { getProjectSummary } from './tools/project-summary.js';
import { getDirectoryTree } from './tools/directory-tree.js';
import { getFileOverview } from './tools/file-overview.js';
import { getModuleGraph } from './tools/module-graph.js';
import { searchSymbols } from './tools/search-symbols.js';
import { getConfigDigest } from './tools/config-digest.js';
import { getEntryPoints } from './tools/entry-points.js';
import { getArchitectureNotes } from './tools/architecture-notes.js';
import { refreshIndex } from './tools/refresh.js';
import { findDeadCode } from './tools/find-dead-code.js';
import { getGlobalProject } from './tools/global-project.js';
import { getSymbolBody } from './tools/symbol-body.js';
import { getTypeDefinitions } from './tools/type-definitions.js';
import { getSymbolReferences } from './tools/symbol-references.js';
import { getChangedSymbols } from './tools/changed-symbols.js';
import { getFoldedFile } from './tools/folded-file.js';
import { getImpactAnalysis } from './tools/impact-analysis.js';
import { getDiffSummary } from './tools/diff-summary.js';
import { getWorkspaces } from './tools/workspaces.js';

// ─── Cache Pool for Server Lifecycle ──────────────────────────────
const MAX_CACHE_POOL_SIZE = 8;
const cachePool = new Map<string, CacheManager>();

export function getPooledCache(root?: string): CacheManager {
  const projectRoot = resolveRoot(root);
  let cache = cachePool.get(projectRoot);
  if (!cache) {
    if (cachePool.size >= MAX_CACHE_POOL_SIZE) {
      const oldestKey = cachePool.keys().next().value;
      if (oldestKey) {
        const oldCache = cachePool.get(oldestKey);
        try { oldCache?.close(); } catch {}
        cachePool.delete(oldestKey);
      }
    }
    cache = new CacheManager(projectRoot);
    cachePool.set(projectRoot, cache);
  }
  return cache;
}

export function closeAllCaches(): void {
  for (const cache of cachePool.values()) {
    try {
      cache.close();
    } catch {
      // Ignore
    }
  }
  cachePool.clear();
}

// ─── MCP Server Factory ──────────────────────────────────────────
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'tokendiet',
    version: '0.4.0',
  });

  // Shared root parameter schema
  const rootSchema = z.object({
    root: z.string().optional().describe('Project root directory (absolute path). Defaults to current working directory.'),
  });

  // ── 1. get_project_summary ────────────────────────────────────
  server.registerTool(
    'get_project_summary',
    {
      description: 'Get a high-level overview of the project: languages, frameworks, build system, structure, and stats. Call this FIRST when exploring a new project.',
      inputSchema: rootSchema.extend({
        refresh: z.boolean().optional().default(false).describe('Force full re-index'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getProjectSummary(params.root, cache, params.refresh);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 2. get_directory_tree ─────────────────────────────────────
  server.registerTool(
    'get_directory_tree',
    {
      description: 'Get a visual directory tree of the project. Shows file types, sizes, and entry points. Respects .gitignore.',
      inputSchema: rootSchema.extend({
        depth: z.number().optional().default(3).describe('Maximum depth to traverse (1-8)'),
        dirsOnly: z.boolean().optional().default(false).describe('Only show directories'),
        includeTests: z.boolean().optional().default(true).describe('Include test files and directories'),
        maxEntries: z.number().optional().default(200).describe('Maximum number of entries to return'),
        format: z.enum(['text', 'json']).optional().default('text').describe('Output format: text (token-efficient) or json'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getDirectoryTree(params.root, cache, {
        depth: params.depth,
        dirsOnly: params.dirsOnly,
        includeTests: params.includeTests,
        maxEntries: params.maxEntries,
        format: params.format,
      });
      return {
        content: [{ type: 'text', text: result }],
      };
    },
  );

  // ── 3. get_file_overview ─────────────────────────────────────
  server.registerTool(
    'get_file_overview',
    {
      description: 'Get a structured overview of a file: exported symbols (functions, classes, types, interfaces), imports, and purpose. No implementation code — signatures only. Token-efficient alternative to reading the file.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file, relative to project root or absolute'),
        root: z.string().optional().describe('Project root directory'),
        detail: z.enum(['signatures', 'names', 'bodies']).optional().default('signatures').describe('Detail level: signatures (default), names only, or bodies (first few lines)'),
        maxSymbols: z.number().optional().default(100).describe('Maximum symbols to return'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getFileOverview(params.root, cache, {
        path: params.path,
        detail: params.detail,
        maxSymbols: params.maxSymbols,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 4. get_module_graph ───────────────────────────────────────
  server.registerTool(
    'get_module_graph',
    {
      description: 'Get the import/export dependency graph between modules. Shows how files depend on each other, external dependencies, hubs (high in-degree), and cycles.',
      inputSchema: rootSchema.extend({
        module: z.string().optional().describe('Focus on a specific module (file or directory path)'),
        depth: z.number().optional().describe('How deep to traverse dependencies'),
        direction: z.enum(['out', 'in', 'both']).optional().default('out').describe('Dependency direction: out (what this imports), in (what imports this), both'),
        maxEdges: z.number().optional().default(200).describe('Maximum edges to return'),
        aggregate: z.boolean().optional().default(true).describe('Aggregate by directory for whole-project view'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getModuleGraph(params.root, cache, {
        module: params.module,
        depth: params.depth,
        direction: params.direction,
        maxEdges: params.maxEdges,
        aggregate: params.aggregate,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 5. search_symbols ─────────────────────────────────────────
  server.registerTool(
    'search_symbols',
    {
      description: 'Search for symbols (functions, classes, interfaces, etc.) by name across the entire project. Case-insensitive, supports * globs.',
      inputSchema: rootSchema.extend({
        query: z.string().describe('Symbol name to search for (case-insensitive, substring match)'),
        kind: z.enum(['function', 'class', 'interface', 'type', 'enum', 'const', 'struct', 'trait', 'method', 'all']).optional().default('all').describe('Filter by symbol kind'),
        language: z.string().optional().describe('Filter by language (typescript, javascript, python, go, rust, java, c_sharp, ruby)'),
        filePattern: z.string().optional().describe('Filter by file pattern (e.g., "*.ts", "src/**")'),
        limit: z.number().optional().default(30).describe('Maximum results'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await searchSymbols(params.root, cache, {
        query: params.query,
        kind: params.kind,
        language: params.language,
        filePattern: params.filePattern,
        limit: params.limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 6. get_config_digest ──────────────────────────────────────
  server.registerTool(
    'get_config_digest',
    {
      description: 'Parse and summarize configuration files (package.json, tsconfig, Cargo.toml, etc.). Returns only the architecturally-relevant settings, not the full file.',
      inputSchema: rootSchema.extend({
        path: z.string().optional().describe('Path to a specific config file. If omitted, auto-detects all common config files.'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getConfigDigest(params.root, cache, {
        path: params.path,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 7. get_entry_points ───────────────────────────────────────
  server.registerTool(
    'get_entry_points',
    {
      description: 'Identify how to enter and run the application: main files, CLI commands, API routes, test directories.',
      inputSchema: rootSchema,
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getEntryPoints(params.root, cache);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 8. get_architecture_notes ─────────────────────────────────
  server.registerTool(
    'get_architecture_notes',
    {
      description: 'Extract architecture documentation if it exists (ARCHITECTURE.md, ADRs, design docs). Returns headings, key concepts, and excerpts — not the full documents.',
      inputSchema: rootSchema.extend({
        maxWords: z.number().optional().default(800).describe('Maximum words per source document'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getArchitectureNotes(params.root, cache, {
        maxWords: params.maxWords,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 9. refresh_index ──────────────────────────────────────────
  server.registerTool(
    'refresh_index',
    {
      description: 'Force an incremental/full re-index of the project cache. Call after major refactors or when the cache seems stale.',
      inputSchema: rootSchema,
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await refreshIndex(params.root, cache);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 10. find_dead_code ─────────────────────────────────────────
  server.registerTool(
    'find_dead_code',
    {
      description: 'Find potentially dead code: exported symbols never imported by other files, and files never imported by any other file. Uses the cached import graph when available — run refresh_index first on large projects. Results are candidates, not certainties — always verify before deleting.',
      inputSchema: rootSchema.extend({
        includeTests: z.boolean().optional().default(false).describe('Include test files in the analysis'),
        ignorePatterns: z.array(z.string()).optional().describe('Glob patterns for files to skip (e.g., "src/generated/**")'),
        minConfidence: z.enum(['high', 'medium']).optional().default('medium').describe('Minimum confidence threshold. "high" returns only exports from files with zero incoming imports. "medium" also returns exports whose names are never imported directly.'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await findDeadCode(params.root, cache, {
        includeTests: params.includeTests,
        ignorePatterns: params.ignorePatterns,
        minConfidence: params.minConfidence,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 11. get_global_project ─────────────────────────────────────
  server.registerTool(
    'get_global_project',
    {
      description: 'Get everything you need to understand a project in a single call. Bundles get_project_summary + get_directory_tree + get_config_digest + get_entry_points. Call this FIRST when exploring a new project — replaces calling those 4 tools individually. Saves 4 round-trips.',
      inputSchema: rootSchema.extend({
        refresh: z.boolean().optional().default(false).describe('Force full re-index before analysis'),
        depth: z.number().optional().default(3).describe('Directory tree depth (1-8)'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getGlobalProject(params.root, cache, {
        refresh: params.refresh,
        depth: params.depth,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 12. get_symbol_body ───────────────────────────────────────
  server.registerTool(
    'get_symbol_body',
    {
      description: 'Extract only the implementation body and doc of a specific function, class, method, or struct without reading the whole file. Saves 90-95% tokens vs reading full files.',
      inputSchema: rootSchema.extend({
        path: z.string().describe('Path to the file containing the symbol'),
        symbol: z.string().describe('Exact name of the symbol (function, method, class) to extract'),
        maxLines: z.number().optional().default(150).describe('Maximum lines of the body to return'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getSymbolBody(params.root, cache, {
        path: params.path,
        symbol: params.symbol,
        maxLines: params.maxLines,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 13. get_type_definitions ───────────────────────────────────
  server.registerTool(
    'get_type_definitions',
    {
      description: 'Extract and aggregate all type definitions, interfaces, structs, enums, and schemas across a file, directory, or project. Returns clean signatures without implementation code.',
      inputSchema: rootSchema.extend({
        path: z.string().optional().describe('Filter types to a specific file or directory path (optional)'),
        limit: z.number().optional().default(50).describe('Maximum number of type definitions to return'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getTypeDefinitions(params.root, cache, {
        path: params.path,
        limit: params.limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 14. get_symbol_references ──────────────────────────────────
  server.registerTool(
    'get_symbol_references',
    {
      description: 'Find all occurrences, usages, and imports of a specific symbol across the entire codebase. Returns compact preview snippets and line numbers.',
      inputSchema: rootSchema.extend({
        symbol: z.string().describe('Symbol name to search for references of'),
        path: z.string().optional().describe('Definition file path (optional)'),
        limit: z.number().optional().default(30).describe('Maximum references to return'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getSymbolReferences(params.root, cache, {
        symbol: params.symbol,
        path: params.path,
        limit: params.limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 15. get_changed_symbols ────────────────────────────────────
  server.registerTool(
    'get_changed_symbols',
    {
      description: 'Analyze git working tree or commit diffs and return added, modified, and deleted symbol names per file instead of raw diffs. Saves 80% tokens vs full git diff.',
      inputSchema: rootSchema.extend({
        stagedOnly: z.boolean().optional().default(false).describe('Only inspect staged git changes'),
        base: z.string().optional().describe('Git base reference to diff against (e.g., "HEAD~1" or "main")'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getChangedSymbols(params.root, cache, {
        stagedOnly: params.stagedOnly,
        base: params.base,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 16. get_folded_file ────────────────────────────────────────
  server.registerTool(
    'get_folded_file',
    {
      description: 'Return a file with all function and class bodies folded ({ /* ... N lines folded */ }), showing only structure, imports, types, and signatures. Option to unfold specific symbols.',
      inputSchema: rootSchema.extend({
        path: z.string().describe('Path to the file to fold'),
        unfoldSymbols: z.array(z.string()).optional().describe('List of specific symbol names to keep unfolded'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getFoldedFile(params.root, cache, {
        path: params.path,
        unfoldSymbols: params.unfoldSymbols,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 17. get_impact_analysis ────────────────────────────────────
  server.registerTool(
    'get_impact_analysis',
    {
      description: 'Analyze reverse dependency impact: find all files and test suites that depend on a given file or module directly or transitively. Computes blast radius score.',
      inputSchema: rootSchema.extend({
        path: z.string().describe('Target file or module path to analyze impact for'),
        maxDepth: z.number().optional().default(5).describe('Maximum transitive dependency depth to explore'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getImpactAnalysis(params.root, cache, {
        path: params.path,
        maxDepth: params.maxDepth,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 18. get_diff_summary ───────────────────────────────────────
  server.registerTool(
    'get_diff_summary',
    {
      description: 'Get a semantic summary of changes between git commits/branches or working tree with impact analysis and test blast radius.',
      inputSchema: rootSchema.extend({
        base: z.string().optional().describe('Git base reference (e.g. "main" or "HEAD~1")'),
        stagedOnly: z.boolean().optional().default(false).describe('Only inspect staged git changes'),
      }),
    },
    async (params) => {
      const cache = getPooledCache(params.root);
      const result = await getDiffSummary(params.root, cache, {
        base: params.base,
        stagedOnly: params.stagedOnly,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // ── 19. get_workspaces ─────────────────────────────────────────
  server.registerTool(
    'get_workspaces',
    {
      description: 'Detect monorepo architecture and package topology (pnpm workspaces, npm/yarn workspaces, turbo, lerna, cargo, go.work).',
      inputSchema: rootSchema,
    },
    async (params) => {
      const result = await getWorkspaces(params.root);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

export async function startServer(): Promise<void> {
  // Pre-initialize Tree-sitter manager in the background
  try {
    await treeSitterManager.init();
  } catch {
    // Non-fatal
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  process.on('SIGINT', () => {
    closeAllCaches();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    closeAllCaches();
    process.exit(0);
  });

  await server.connect(transport);
  console.error('TokenDiet MCP server running on stdio');
}
