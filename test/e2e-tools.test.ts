import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { CacheManager } from '../src/core/cache.js';

// Import all 16 tools
import { getGlobalProject } from '../src/tools/global-project.js';
import { getProjectSummary } from '../src/tools/project-summary.js';
import { getDirectoryTree } from '../src/tools/directory-tree.js';
import { getFileOverview } from '../src/tools/file-overview.js';
import { getModuleGraph } from '../src/tools/module-graph.js';
import { searchSymbols } from '../src/tools/search-symbols.js';
import { getConfigDigest } from '../src/tools/config-digest.js';
import { getEntryPoints } from '../src/tools/entry-points.js';
import { getArchitectureNotes } from '../src/tools/architecture-notes.js';
import { refreshIndex } from '../src/tools/refresh.js';
import { findDeadCode } from '../src/tools/find-dead-code.js';
import { getSymbolBody } from '../src/tools/symbol-body.js';
import { getTypeDefinitions } from '../src/tools/type-definitions.js';
import { getSymbolReferences } from '../src/tools/symbol-references.js';
import { getChangedSymbols } from '../src/tools/changed-symbols.js';
import { getFoldedFile } from '../src/tools/folded-file.js';

describe('Comprehensive E2E Tool Suite (16 tools)', () => {
  let cache: CacheManager;
  const projectRoot = resolve(process.cwd());

  beforeAll(async () => {
    cache = new CacheManager(projectRoot);
    await refreshIndex(projectRoot, cache);
  });

  afterAll(() => {
    cache.close();
  });

  // 1. get_global_project
  it('Tool 1: get_global_project executes without errors and returns structured project data', async () => {
    const res = await getGlobalProject(projectRoot, cache, { depth: 2 });
    expect(res).toBeDefined();
    expect(res.summary.name).toBe('tokendiet-mcp');
    expect(res.tree).toContain('src/');
    expect(res.configs.length).toBeGreaterThan(0);
    expect(res.entryPoints.length).toBeGreaterThan(0);
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  // 2. get_project_summary
  it('Tool 2: get_project_summary returns languages, topDirs and build tools', async () => {
    const res = await getProjectSummary(projectRoot, cache, false);
    expect(res).toBeDefined();
    expect(res.name).toBe('tokendiet-mcp');
    expect(res.kind).toBe('app');
    expect(res.topLevelStructure.some(d => d.name === 'src/')).toBe(true);
    expect(res.languages.some(l => l.lang === 'ts')).toBe(true);
  });

  // 3. get_directory_tree
  it('Tool 3: get_directory_tree returns text and json representations correctly', async () => {
    const textRes = await getDirectoryTree(projectRoot, cache, { depth: 2, format: 'text' });
    expect(typeof textRes).toBe('string');
    expect(textRes).toContain('src/');

    const jsonRes = await getDirectoryTree(projectRoot, cache, { depth: 2, format: 'json' });
    const parsed = JSON.parse(jsonRes);
    expect(parsed.tree).toBeDefined();
  });

  // 4. get_file_overview
  it('Tool 4: get_file_overview handles both cache hits, misses, and detail modes', async () => {
    const sigs = await getFileOverview(projectRoot, cache, { path: 'src/server.ts', detail: 'signatures' });
    expect(sigs.file).toBe('src/server.ts');
    expect(sigs.symbols.length).toBeGreaterThan(0);
    expect(sigs.imports.length).toBeGreaterThan(0);

    const names = await getFileOverview(projectRoot, cache, { path: 'src/server.ts', detail: 'names' });
    expect(names.symbols[0]?.signature).toBe('');
  });

  // 5. get_module_graph
  it('Tool 5: get_module_graph calculates internal edges and external modules', async () => {
    const aggregated = await getModuleGraph(projectRoot, cache, { aggregate: true });
    expect(aggregated.nodes.length).toBeGreaterThan(0);
    expect(aggregated.external).toBeDefined();

    const detailed = await getModuleGraph(projectRoot, cache, { aggregate: false });
    expect(detailed.edges.length).toBeGreaterThan(0);
  });

  // 6. search_symbols
  it('Tool 6: search_symbols finds symbols by name, kind, and filePattern', async () => {
    const res = await searchSymbols(projectRoot, cache, { query: 'createServer' });
    expect(res.matches.some(m => m.name === 'createServer')).toBe(true);

    const kindFiltered = await searchSymbols(projectRoot, cache, { query: 'CacheManager', kind: 'class' });
    expect(kindFiltered.matches.every(m => m.kind === 'class')).toBe(true);

    const patternFiltered = await searchSymbols(projectRoot, cache, { query: 'parse', filePattern: 'src/parsers/**' });
    expect(patternFiltered.matches.every(m => m.file.startsWith('src/parsers/'))).toBe(true);
  });

  // 7. get_config_digest
  it('Tool 7: get_config_digest parses package.json, tsconfig.json, and tsup.config.ts', async () => {
    const allConfigs = await getConfigDigest(projectRoot, cache, {});
    expect(allConfigs.configs.length).toBeGreaterThanOrEqual(2);

    const tsConfig = await getConfigDigest(projectRoot, cache, { path: 'tsup.config.ts' });
    expect(tsConfig.configs[0]?.file).toBe('tsup.config.ts');
  });

  // 8. get_entry_points
  it('Tool 8: get_entry_points detects main, bin, cli scripts, and tests', async () => {
    const res = await getEntryPoints(projectRoot, cache);
    expect(res.entryPoints.some(e => e.kind === 'main')).toBe(true);
    expect(res.entryPoints.some(e => e.kind === 'cli')).toBe(true);
    expect(res.cliCommands.length).toBeGreaterThan(0);
  });

  // 9. get_architecture_notes
  it('Tool 9: get_architecture_notes extracts sections and headings', async () => {
    const res = await getArchitectureNotes(projectRoot, cache, { maxWords: 500 });
    expect(res.found.length).toBeGreaterThan(0);
    expect(res.sources.length).toBeGreaterThan(0);
  });

  // 10. refresh_index
  it('Tool 10: refresh_index updates SQLite database and returns stats', async () => {
    const res = await refreshIndex(projectRoot, cache);
    expect(res.reindexed).toBeGreaterThanOrEqual(0);
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  // 11. find_dead_code
  it('Tool 11: find_dead_code runs without crashing and identifies unused candidates', async () => {
    const res = await findDeadCode(projectRoot, cache, { minConfidence: 'high' });
    expect(res.summary).toBeDefined();
    expect(typeof res.summary.totalUnusedExports).toBe('number');
    expect(Array.isArray(res.unusedExports)).toBe(true);
  });

  // 12. get_symbol_body
  it('Tool 12: get_symbol_body extracts target function without surrounding file', async () => {
    const res = await getSymbolBody(projectRoot, cache, { path: 'src/core/utils.ts', symbol: 'formatBytes' });
    expect(res.file).toBe('src/core/utils.ts');
    expect(res.symbol).toBe('formatBytes');
    expect(res.body).toContain('function formatBytes');
    expect(res.endLine).toBeGreaterThan(res.line);
  });

  // 13. get_type_definitions
  it('Tool 13: get_type_definitions extracts interfaces and type aliases', async () => {
    const res = await getTypeDefinitions(projectRoot, cache, { path: 'src/types/index.ts' });
    expect(res.types.length).toBeGreaterThan(0);
    expect(res.types.every(t => ['interface', 'type', 'enum', 'struct', 'trait'].includes(t.kind))).toBe(true);
  });

  // 14. get_symbol_references
  it('Tool 14: get_symbol_references finds occurrences of a symbol in codebase', async () => {
    const res = await getSymbolReferences(projectRoot, cache, { symbol: 'CacheManager' });
    expect(res.symbol).toBe('CacheManager');
    expect(res.references.length).toBeGreaterThan(0);
  });

  // 15. get_changed_symbols
  it('Tool 15: get_changed_symbols reports git status and changed symbol lists', async () => {
    const res = await getChangedSymbols(projectRoot, cache, {});
    expect(res.branch).toBeDefined();
    expect(Array.isArray(res.changedFiles)).toBe(true);
  });

  // 16. get_folded_file
  it('Tool 16: get_folded_file collapses inner code blocks', async () => {
    const res = await getFoldedFile(projectRoot, cache, { path: 'src/server.ts' });
    expect(res.file).toBe('src/server.ts');
    expect(res.foldedLines).toBeGreaterThan(0);
    expect(res.content).toContain('lines folded');
  });

  // ─── Edge cases tests ──────────────────────────────────────────
  it('Edge case: get_symbol_body throws on missing symbol', async () => {
    await expect(
      getSymbolBody(projectRoot, cache, { path: 'src/server.ts', symbol: 'non_existent_symbol' })
    ).rejects.toThrow("Symbol 'non_existent_symbol' not found");
  });

  it('Edge case: get_file_overview throws on missing file', async () => {
    await expect(
      getFileOverview(projectRoot, cache, { path: 'src/missing-file.xyz' })
    ).rejects.toThrow("File not found");
  });

  it('Edge case: search_symbols handles special regex characters without throwing', async () => {
    const res = await searchSymbols(projectRoot, cache, { query: '$' });
    expect(res).toBeDefined();
    expect(Array.isArray(res.matches)).toBe(true);
  });

  it('Edge case: get_symbol_references handles empty string', async () => {
    await expect(
      getSymbolReferences(projectRoot, cache, { symbol: '   ' })
    ).rejects.toThrow("Symbol name is required");
  });

  it('Edge case: get_directory_tree handles dirsOnly and custom depth', async () => {
    const res = await getDirectoryTree(projectRoot, cache, { depth: 1, dirsOnly: true });
    expect(res).toContain('src/');
    expect(res).not.toContain('package.json');
  });
});
