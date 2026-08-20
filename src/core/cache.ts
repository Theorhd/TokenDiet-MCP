import { DatabaseSync, StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir, hashRoot } from './paths.js';
import type { CacheEntry, FileOverview, SymbolInfo, ImportInfo, ExportInfo, Precision } from '../types/index.js';

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  mtime REAL NOT NULL,
  size INTEGER NOT NULL,
  lang TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'regex',
  lines INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  precision TEXT NOT NULL DEFAULT 'approx',
  purpose TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  end_line INTEGER,
  signature TEXT NOT NULL,
  doc TEXT NOT NULL DEFAULT '',
  exported INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  from_module TEXT NOT NULL,
  names TEXT NOT NULL,
  is_external INTEGER NOT NULL,
  is_default INTEGER NOT NULL,
  FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_path);
CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(path, mtime, size);
`;

interface PrecompiledStatements {
  getMeta: StatementSync;
  setMeta: StatementSync;
  getFileMtime: StatementSync;
  getFileUnchanged: StatementSync;
  upsertFile: StatementSync;
  deleteSymbolsByFile: StatementSync;
  insertSymbol: StatementSync;
  deleteImportsByFile: StatementSync;
  insertImport: StatementSync;
  getFileOverview: StatementSync;
  getSymbolsForFile: StatementSync;
  getImportsForFile: StatementSync;
  getAllFiles: StatementSync;
  getFilesWithSymbols: StatementSync;
  getFilesByExt: StatementSync;
  searchSymbolsExact: StatementSync;
  searchSymbolsPrefix: StatementSync;
  searchSymbolsContains: StatementSync;
  getStats: StatementSync;
  getLanguages: StatementSync;
  getImportGraph: StatementSync;
  deleteFile: StatementSync;
}

export class CacheManager {
  private db: DatabaseSync;
  private dbPath: string;
  private root: string;
  private stmts!: PrecompiledStatements;

  constructor(root: string) {
    this.root = root;
    const cacheDir = getCacheDir();
    mkdirSync(cacheDir, { recursive: true });

    const rootHash = hashRoot(root);
    this.dbPath = join(cacheDir, `${rootHash}.db`);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA busy_timeout=10000');
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.db.exec('PRAGMA cache_size=-32000');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.initSchema();
    this.prepareStatements();
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  }

  private initSchema(): void {
    // 1. Ensure base tables and indices exist
    this.db.exec(SCHEMA);

    // 2. Migration: ensure end_line exists on symbols
    try {
      const tableInfo = this.db.prepare('PRAGMA table_info(symbols)').all() as Array<{ name: string }>;
      const hasEndLine = tableInfo.some(col => col.name === 'end_line');
      if (!hasEndLine) {
        this.db.exec('ALTER TABLE symbols ADD COLUMN end_line INTEGER');
      }
    } catch {
      // Ignore
    }

    // 3. Migration: ensure purpose exists on files
    try {
      const filesInfo = this.db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
      const hasPurpose = filesInfo.some(col => col.name === 'purpose');
      if (!hasPurpose) {
        this.db.exec('ALTER TABLE files ADD COLUMN purpose TEXT NOT NULL DEFAULT ""');
      }
    } catch {
      // Ignore
    }

    // 4. Migration: ensure from_module exists on imports
    try {
      const importsInfo = this.db.prepare('PRAGMA table_info(imports)').all() as Array<{ name: string }>;
      const hasFromModule = importsInfo.some(col => col.name === 'from_module');
      if (!hasFromModule && importsInfo.length > 0) {
        const hasModule = importsInfo.some(col => col.name === 'module');
        if (hasModule) {
          this.db.exec('ALTER TABLE imports RENAME COLUMN module TO from_module');
        } else {
          this.db.exec('DROP TABLE IF EXISTS imports');
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS imports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              file_path TEXT NOT NULL,
              from_module TEXT NOT NULL,
              names TEXT NOT NULL,
              is_external INTEGER NOT NULL,
              is_default INTEGER NOT NULL,
              FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
            );
          `);
        }
      }
    } catch {
      // Ignore
    }

    // 5. Update user_version
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  private prepareStatements(): void {
    this.stmts = {
      getMeta: this.db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
      getFileMtime: this.db.prepare('SELECT mtime FROM files WHERE path = ?'),
      getFileUnchanged: this.db.prepare('SELECT mtime, size FROM files WHERE path = ?'),
      upsertFile: this.db.prepare(`
        INSERT OR REPLACE INTO files (path, mtime, size, lang, tier, lines, bytes, precision, purpose)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      deleteSymbolsByFile: this.db.prepare('DELETE FROM symbols WHERE file_path = ?'),
      insertSymbol: this.db.prepare(`
        INSERT INTO symbols (file_path, name, kind, line, end_line, signature, doc, exported)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      deleteImportsByFile: this.db.prepare('DELETE FROM imports WHERE file_path = ?'),
      insertImport: this.db.prepare(`
        INSERT INTO imports (file_path, from_module, names, is_external, is_default)
        VALUES (?, ?, ?, ?, ?)
      `),
      getFileOverview: this.db.prepare(`
        SELECT path, lang, tier, lines, bytes, precision, purpose
        FROM files WHERE path = ?
      `),
      getSymbolsForFile: this.db.prepare(`
        SELECT name, kind, line, end_line, signature, doc, exported
        FROM symbols WHERE file_path = ?
        ORDER BY line
      `),
      getImportsForFile: this.db.prepare(`
        SELECT from_module, names, is_external, is_default
        FROM imports WHERE file_path = ?
      `),
      getAllFiles: this.db.prepare('SELECT path, lang, bytes FROM files'),
      getFilesWithSymbols: this.db.prepare(`
        SELECT DISTINCT f.path, f.lang, f.lines
        FROM files f
        JOIN symbols s ON f.path = s.file_path
      `),
      getFilesByExt: this.db.prepare(`
        SELECT path, lang, lines, bytes FROM files
        WHERE path LIKE ? ESCAPE '\\'
      `),
      searchSymbolsExact: this.db.prepare(`
        SELECT s.name, s.kind, s.line, s.end_line, s.signature, s.doc, s.exported, s.file_path as file
        FROM symbols s
        WHERE s.name = ?
        LIMIT ?
      `),
      searchSymbolsPrefix: this.db.prepare(`
        SELECT s.name, s.kind, s.line, s.end_line, s.signature, s.doc, s.exported, s.file_path as file
        FROM symbols s
        WHERE s.name LIKE (? || '%') ESCAPE '\\'
        LIMIT ?
      `),
      searchSymbolsContains: this.db.prepare(`
        SELECT s.name, s.kind, s.line, s.end_line, s.signature, s.doc, s.exported, s.file_path as file
        FROM symbols s
        WHERE s.name LIKE ('%' || ? || '%') ESCAPE '\\'
        LIMIT ?
      `),
      getStats: this.db.prepare(`
        SELECT COUNT(*) as fileCount, SUM(bytes) as totalBytes, SUM(lines) as totalLines
        FROM files
      `),
      getLanguages: this.db.prepare(`
        SELECT lang, COUNT(*) as fileCount, SUM(lines) as totalLines
        FROM files
        GROUP BY lang
      `),
      getImportGraph: this.db.prepare(`
        SELECT file_path as "from", from_module as "to", names, is_external as isExternal
        FROM imports
        WHERE (? = '' OR file_path LIKE (? || '%') ESCAPE '\\')
      `),
      deleteFile: this.db.prepare('DELETE FROM files WHERE path = ?'),
    };
  }

  withTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ── File Operations ─────────────────────────────────────────────

  getFileMtime(path: string): number | null {
    const row = this.stmts.getFileMtime.get(path) as { mtime: number } | undefined;
    return row ? row.mtime : null;
  }

  isFileUnchanged(path: string, mtime: number, size: number): boolean {
    const row = this.stmts.getFileUnchanged.get(path) as { mtime: number; size: number } | undefined;
    if (!row) return false;
    return Math.abs(row.mtime - mtime) < 0.001 && row.size === size;
  }

  upsertFile(
    path: string,
    mtime: number,
    size: number,
    lang: string,
    tier: string,
    lines: number,
    bytes: number,
    precision: Precision = 'approx',
    symbols: SymbolInfo[] = [],
    imports: ImportInfo[] = [],
    purpose: string = '',
  ): void {
    if (this.isFileUnchanged(path, mtime, size)) {
      return;
    }

    this.stmts.upsertFile.run(path, mtime, size, lang, tier, lines, bytes, precision, purpose);
    this.stmts.deleteSymbolsByFile.run(path);

    for (const sym of symbols) {
      this.stmts.insertSymbol.run(
        path,
        sym.name,
        sym.kind,
        sym.line,
        sym.endLine ?? null,
        sym.signature,
        sym.doc || '',
        sym.exported ? 1 : 0,
      );
    }

    this.stmts.deleteImportsByFile.run(path);

    for (const imp of imports) {
      this.stmts.insertImport.run(
        path,
        imp.from,
        JSON.stringify(imp.names),
        imp.isExternal ? 1 : 0,
        imp.isDefault ? 1 : 0,
      );
    }
  }

  removeStaleFiles(validPaths: Set<string>): number {
    const allFiles = this.stmts.getAllFiles.all() as Array<{ path: string }>;
    let removed = 0;

    for (const f of allFiles) {
      if (!validPaths.has(f.path)) {
        this.stmts.deleteFile.run(f.path);
        this.stmts.deleteSymbolsByFile.run(f.path);
        this.stmts.deleteImportsByFile.run(f.path);
        removed++;
      }
    }

    return removed;
  }

  getFileOverview(path: string): {
    lang: string;
    tier: string;
    lines: number;
    bytes: number;
    precision: string;
    purpose: string;
    symbols: SymbolInfo[];
    imports: ImportInfo[];
  } | null {
    const file = this.stmts.getFileOverview.get(path) as {
      lang: string;
      tier: string;
      lines: number;
      bytes: number;
      precision: string;
      purpose: string;
    } | undefined;

    if (!file) return null;

    const rawSymbols = this.stmts.getSymbolsForFile.all(path) as Array<{
      name: string;
      kind: string;
      line: number;
      end_line: number | null;
      signature: string;
      doc: string;
      exported: number;
    }>;

    const rawImports = this.stmts.getImportsForFile.all(path) as Array<{
      from_module: string;
      names: string;
      is_external: number;
      is_default: number;
    }>;

    return {
      lang: file.lang,
      tier: file.tier,
      lines: file.lines,
      bytes: file.bytes,
      precision: file.precision,
      purpose: file.purpose,
      symbols: rawSymbols.map(s => ({
        name: s.name,
        kind: s.kind as SymbolInfo['kind'],
        line: s.line,
        endLine: s.end_line ?? undefined,
        signature: s.signature,
        doc: s.doc,
        exported: Boolean(s.exported),
      })),
      imports: rawImports.map(i => ({
        from: i.from_module,
        names: JSON.parse(i.names),
        isExternal: Boolean(i.is_external),
        isDefault: Boolean(i.is_default),
      })),
    };
  }

  getAllFiles(): Array<{ path: string; lang: string; bytes: number }> {
    return this.stmts.getAllFiles.all() as Array<{ path: string; lang: string; bytes: number }>;
  }

  getFilesWithSymbols(): Array<{ path: string; lang: string; lines: number }> {
    return this.stmts.getFilesWithSymbols.all() as Array<{ path: string; lang: string; lines: number }>;
  }

  getFilesByExt(ext: string): Array<{ path: string; lang: string; lines: number; bytes: number }> {
    const escapedExt = escapeLike(ext);
    return this.stmts.getFilesByExt.all(`%.${escapedExt}`) as Array<{
      path: string;
      lang: string;
      lines: number;
      bytes: number;
    }>;
  }

  // ── Symbol Search ───────────────────────────────────────────────

  searchSymbols(
    query: string,
    kind?: string,
    limit = 30,
    filePattern?: string,
  ): Array<SymbolInfo & { file: string }> {
    const escapedQuery = escapeLike(query);
    let rows: Array<{
      name: string;
      kind: string;
      line: number;
      end_line: number | null;
      signature: string;
      doc: string;
      exported: number;
      file: string;
    }>;

    let sql = `
      SELECT s.name, s.kind, s.line, s.end_line, s.signature, s.doc, s.exported, s.file_path as file
      FROM symbols s
      WHERE s.name LIKE ('%' || ? || '%') ESCAPE '\\'
    `;
    const params: (string | number)[] = [escapedQuery];

    if (kind && kind !== 'all') {
      sql += ' AND s.kind = ?';
      params.push(kind);
    }

    if (filePattern) {
      const globPattern = filePattern.replace(/\*/g, '%');
      sql += ` AND s.file_path LIKE ? ESCAPE '\\'`;
      params.push(globPattern);
    }

    sql += ' ORDER BY CASE WHEN s.name = ? THEN 0 WHEN s.name LIKE (? || \'%\') ESCAPE \'\\\' THEN 1 ELSE 2 END, s.exported DESC LIMIT ?';
    params.push(query, escapedQuery, limit);

    try {
      rows = this.db.prepare(sql).all(...params) as typeof rows;
    } catch {
      rows = [];
    }

    return rows.map(r => ({
      name: r.name,
      kind: r.kind as SymbolInfo['kind'],
      line: r.line,
      endLine: r.end_line ?? undefined,
      signature: r.signature,
      doc: r.doc,
      exported: Boolean(r.exported),
      file: r.file,
    }));
  }

  // ── Import Graph ────────────────────────────────────────────────

  getImportGraph(prefix = ''): Array<{ from: string; to: string; names: string[]; isExternal: boolean }> {
    const escapedPrefix = escapeLike(prefix);
    const rows = this.stmts.getImportGraph.all(prefix, escapedPrefix) as Array<{
      from: string;
      to: string;
      names: string;
      isExternal: number;
    }>;

    return rows.map(r => ({
      from: r.from,
      to: r.to,
      names: JSON.parse(r.names),
      isExternal: Boolean(r.isExternal),
    }));
  }

  // ── Stats ───────────────────────────────────────────────────────

  getStats(): { fileCount: number; totalBytes: number; totalLines: number } {
    const row = this.stmts.getStats.get() as {
      fileCount: number;
      totalBytes: number | null;
      totalLines: number | null;
    } | undefined;

    return {
      fileCount: row?.fileCount ?? 0,
      totalBytes: row?.totalBytes ?? 0,
      totalLines: row?.totalLines ?? 0,
    };
  }

  getLanguageBreakdown(): Array<{ lang: string; fileCount: number; totalLines: number }> {
    return this.stmts.getLanguages.all() as Array<{
      lang: string;
      fileCount: number;
      totalLines: number;
    }>;
  }

  // ── Metadata ────────────────────────────────────────────────────

  getIndexedAt(): string | null {
    const row = this.stmts.getMeta.get('indexed_at') as { value: string } | undefined;
    return row ? row.value : null;
  }

  setIndexed(): void {
    this.stmts.setMeta.run('indexed_at', new Date().toISOString());
  }

  clear(): void {
    this.db.exec('DELETE FROM symbols');
    this.db.exec('DELETE FROM imports');
    this.db.exec('DELETE FROM files');
    this.db.exec('DELETE FROM meta');
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore if already closed
    }
  }
}

function escapeLike(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
