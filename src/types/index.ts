// ─── Symbol Kinds ───────────────────────────────────────────────
export type SymbolKind =
  | 'function' | 'method' | 'class' | 'interface' | 'type'
  | 'enum' | 'const' | 'let' | 'var' | 'struct' | 'trait'
  | 'module' | 'namespace';

// ─── Import / Export ────────────────────────────────────────────
export interface ImportInfo {
  from: string;
  names: string[];
  isExternal: boolean;
  isDefault: boolean;
}

export interface ExportInfo {
  name: string;
  kind: SymbolKind;
  line: number;
  signature: string;       // ≤ 90 chars, truncated with …
  doc: string;             // first sentence of docblock, ≤ 200 chars
  exported: boolean;       // always true here, but used in SymbolInfo
}

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  line: number;
  signature: string;
  doc: string;
  exported: boolean;
}

// ─── File Overview ──────────────────────────────────────────────
export type Precision = 'full' | 'approx';

export interface FileOverview {
  file: string;
  language: string;
  purpose: string;
  lines: number;
  bytes: number;
  lastModified: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
  precision: Precision;
}

// ─── Project Summary ────────────────────────────────────────────
export interface LanguageStat {
  lang: string;
  files: number;
  loc: number;
}

export interface TopLevelDir {
  name: string;
  role: string;
  fileCount: number;
}

export interface ProjectSummary {
  name: string;
  kind: 'app' | 'library' | 'monorepo' | 'mixed';
  languages: LanguageStat[];
  frameworks: string[];
  build: {
    tool: string;
    packageManager: string;
    hasLockfile: boolean;
  };
  workspaces: string[];
  stats: {
    fileCount: number;
    skippedCount: number;
    indexedBytes: number;
    dirsBySize: [string, number][];
  };
  topLevelStructure: TopLevelDir[];
  _partial?: boolean;
}

// ─── Module Graph ───────────────────────────────────────────────
export interface GraphNode {
  id: string;
  lang: string;
  exportCount: number;
  size: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'import' | 'export';
  via: string[];
}

export interface ModuleGraph {
  scope: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  external: Record<string, number>;
  hubs: string[];
  cycles: string[][];
  _truncated?: string;
}

// ─── Search ─────────────────────────────────────────────────────
export interface SearchResult {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  signature: string;
}

export interface SearchOutput {
  matches: SearchResult[];
  totalMatches: number;
  truncated: number;
}

// ─── Config Digest ──────────────────────────────────────────────
export interface ConfigDigest {
  file: string;
  format: string;
  summary: Record<string, unknown>;
}

export interface ConfigOutput {
  configs: ConfigDigest[];
}

// ─── Entry Points ───────────────────────────────────────────────
export interface EntryPoint {
  path: string;
  kind: 'main' | 'bin' | 'test' | 'route' | 'script' | 'cli';
  via?: string;
  count?: number;
}

export interface RouteInfo {
  method: string;
  path: string;
  handler: string;
  file: string;
}

export interface CliCommand {
  name: string;
  command: string;
  description: string;
}

export interface EntryPointsOutput {
  entryPoints: EntryPoint[];
  routes: RouteInfo[];
  cliCommands: CliCommand[];
}

// ─── Architecture Notes ─────────────────────────────────────────
export interface ArchNote {
  path: string;
  words: number;
  excerpt: string;
}

export interface ArchitectureNotes {
  found: string[];
  headings: string[];
  sources: ArchNote[];
  keyConcepts: string[];
}

// ─── Cache ──────────────────────────────────────────────────────
export interface CacheEntry {
  path: string;
  mtime: number;
  size: number;
  lang: string;
  tier: 'tree-sitter' | 'regex' | 'skip';
  lines: number;
  bytes: number;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  precision: Precision;
}

// ─── Parser Interface ───────────────────────────────────────────
export interface Parser {
  readonly language: string;
  readonly extensions: string[];
  readonly tier: 'tree-sitter' | 'regex';
  parseFile(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'>;
}

// ─── Dead Code Detection ────────────────────────────────────────
export interface DeadCodeItem {
  file: string;
  symbol: string;
  kind: SymbolKind | 'module';
  line: number;
  confidence: 'high' | 'medium';
  reason: string;
}

export interface DeadCodeOutput {
  unusedExports: DeadCodeItem[];
  unusedFiles: DeadCodeItem[];
  summary: {
    totalUnusedExports: number;
    totalUnusedFiles: number;
    filesAnalyzed: number;
    exportsAnalyzed: number;
    cacheUsed: boolean;
  };
}

// ─── Global Project (combined tool) ─────────────────────────────
export interface GlobalProjectOutput {
  summary: ProjectSummary;
  tree: string;
  configs: ConfigDigest[];
  entryPoints: EntryPoint[];
  routes: RouteInfo[];
  cliCommands: CliCommand[];
  elapsedMs: number;
}

// ─── Tool Context ───────────────────────────────────────────────
export interface ToolContext {
  root: string;
  cache: unknown; // CacheManager — circular ref avoided via interface
}
