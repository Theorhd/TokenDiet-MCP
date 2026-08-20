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
  endLine?: number;
  signature: string;       // ≤ 90 chars, truncated with …
  doc: string;             // first sentence of docblock, ≤ 200 chars
  exported: boolean;       // always true here, but used in SymbolInfo
}

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  line: number;
  endLine?: number;
  signature: string;
  doc: string;
  exported: boolean;
}

// ─── File Overview ──────────────────────────────────────────────
export type Precision = 'full' | 'approx';

export interface FileOverview {
  file: string;
  language: string;
  tier?: 'tree-sitter' | 'regex';
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

// ─── Symbol Body ────────────────────────────────────────────────
export interface SymbolBodyOutput {
  file: string;
  symbol: string;
  kind: SymbolKind;
  line: number;
  endLine: number;
  signature: string;
  doc: string;
  body: string;
  _truncated?: string;
}

// ─── Type Definitions ───────────────────────────────────────────
export interface TypeDefItem {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  signature: string;
  doc: string;
}

export interface TypeDefinitionsOutput {
  types: TypeDefItem[];
  totalTypes: number;
  _truncated?: string;
}

// ─── Symbol References ──────────────────────────────────────────
export interface SymbolReference {
  file: string;
  line: number;
  preview: string;
  isImport: boolean;
}

export interface SymbolReferencesOutput {
  symbol: string;
  references: SymbolReference[];
  totalReferences: number;
  _truncated?: string;
}

// ─── Changed Symbols ────────────────────────────────────────────
export interface ChangedSymbolsOptions {
  stagedOnly?: boolean;
  base?: string;
}

export interface ChangedFileSummary {
  file: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  addedSymbols: string[];
  modifiedSymbols: string[];
  removedSymbols: string[];
}

export interface ChangedSymbolsOutput {
  branch: string;
  changedFiles: ChangedFileSummary[];
  totalFilesChanged: number;
}

// ─── Folded File ────────────────────────────────────────────────
export interface FoldedFileOutput {
  file: string;
  language: string;
  totalLines: number;
  foldedLines: number;
  content: string;
}

// ─── Impact Analysis ────────────────────────────────────────────
export interface ImpactAnalysisOutput {
  target: string;
  directDependents: string[];
  indirectDependents: Array<{ file: string; depth: number }>;
  impactedTests: string[];
  totalImpactedFiles: number;
  blastRadius: 'low' | 'medium' | 'high' | 'critical';
}

// ─── Diff Summary ───────────────────────────────────────────────
export interface DiffSummaryOutput {
  branch: string;
  filesChanged: number;
  totalAddedSymbols: number;
  totalModifiedSymbols: number;
  totalRemovedSymbols: number;
  criticalChanges: Array<{
    file: string;
    impactedFiles: number;
    impactedTests: string[];
    blastRadius: string;
  }>;
  summaryText: string;
}

// ─── Workspaces ─────────────────────────────────────────────────
export interface WorkspacePackage {
  name: string;
  path: string;
  version?: string;
  dependencies?: string[];
  devDependencies?: string[];
  scripts?: Record<string, string>;
}

export interface WorkspacesOutput {
  isMonorepo: boolean;
  monorepoType?: 'pnpm' | 'npm-yarn' | 'turbo' | 'lerna' | 'cargo' | 'go-work';
  rootPackageName?: string;
  packages: WorkspacePackage[];
  totalPackages: number;
}

// ─── Tool Context ───────────────────────────────────────────────
export interface ToolContext {
  root: string;
  cache: unknown;
}
