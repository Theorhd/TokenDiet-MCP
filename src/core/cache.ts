import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getCacheDir, hashRoot } from './paths.js';
import type { SymbolInfo, ImportInfo, CacheEntry, Precision } from '../types/index.js';

// ─── Schema ─────────────────────────────────────────────────────
const SCHEMA_VERSION = 1;

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
  tier TEXT NOT NULL,
  lines INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  precision TEXT NOT NULL DEFAULT 'approx',
  purpose TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS symbols (
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT DEFAULT '',
  line INTEGER NOT NULL,
  doc TEXT DEFAULT '',
  exported INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imports (
  file_path TEXT NOT NULL,
  from_path TEXT NOT NULL,
  names TEXT NOT NULL,
  is_external INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_path);
CREATE INDEX IF NOT EXISTS idx_imports_target ON imports(from_path);
`;

// ─── Cache Manager ──────────────────────────────────────────────
export class CacheManager {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(root: string) {
    const cacheDir = getCacheDir();
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    const rootHash = hashRoot(root);
    this.dbPath = join(cacheDir, `${rootHash}.db`);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.initSchema();
  }

  private initSchema(): void {
    try {
      // Ensure meta table exists before we try to read from it
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    } catch (e) {
      // Ignore
    }

    let currentVersion: string | undefined;
    try {
      currentVersion = this.getMeta('schema_version');
    } catch (e) {
      // If meta table still somehow doesn't exist, assume undefined
    }

    if (currentVersion !== String(SCHEMA_VERSION)) {
      // Drop and recreate for version bump
      this.db.exec('DROP TABLE IF EXISTS symbols');
      this.db.exec('DROP TABLE IF EXISTS imports');
      this.db.exec('DROP TABLE IF EXISTS files');
      this.db.exec('DROP TABLE IF EXISTS meta');
      this.db.exec(SCHEMA);
      this.setMeta('schema_version', String(SCHEMA_VERSION));
    } else {
      this.db.exec(SCHEMA);
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
  }

  withTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ─── Meta ─────────────────────────────────────────────────────
  private getMeta(key: string): string | undefined {
    const stmt = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  // ─── File operations ──────────────────────────────────────────
  getFileMtime(path: string): number | undefined {
    const stmt = this.db.prepare('SELECT mtime FROM files WHERE path = ?');
    const row = stmt.get(path) as { mtime: number } | undefined;
    return row?.mtime;
  }

  upsertFile(
    path: string,
    mtime: number,
    size: number,
    lang: string,
    tier: 'tree-sitter' | 'regex' | 'skip',
    lines: number,
    bytes: number,
    precision: Precision,
    symbols?: SymbolInfo[],
    imports?: ImportInfo[],
    purpose: string = '',
  ): void {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, mtime, size, lang, tier, lines, bytes, precision, purpose)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    upsert.run(path, mtime, size, lang, tier, lines, bytes, precision, purpose);

    // Clear old symbols/imports
    this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(path);
    this.db.prepare('DELETE FROM imports WHERE file_path = ?').run(path);

    // Insert new symbols
    if (symbols && symbols.length > 0) {
      const insertSym = this.db.prepare(
        'INSERT INTO symbols (file_path, name, kind, signature, line, doc, exported) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const s of symbols) {
        insertSym.run(path, s.name, s.kind, s.signature, s.line, s.doc, s.exported ? 1 : 0);
      }
    }

    // Insert new imports
    if (imports && imports.length > 0) {
      const insertImp = this.db.prepare(
        'INSERT INTO imports (file_path, from_path, names, is_external) VALUES (?, ?, ?, ?)',
      );
      for (const imp of imports) {
        insertImp.run(path, imp.from, imp.names.join(','), imp.isExternal ? 1 : 0);
      }
    }
  }

  getFileOverview(path: string): { lang: string; purpose: string; lines: number; bytes: number; precision: string; symbols: SymbolInfo[]; imports: ImportInfo[] } | null {
    const fileStmt = this.db.prepare('SELECT lang, lines, bytes, precision, purpose FROM files WHERE path = ?');
    const fileRow = fileStmt.get(path) as { lang: string; lines: number; bytes: number; precision: string; purpose: string } | undefined;
    if (!fileRow) return null;

    const symStmt = this.db.prepare('SELECT name, kind, signature, line, doc, exported FROM symbols WHERE file_path = ? ORDER BY line');
    const rows = symStmt.all(path) as Array<Record<string, unknown>>;
    const symbols: SymbolInfo[] = rows.map(r => ({
      name: r.name as string,
      kind: r.kind as SymbolInfo['kind'],
      signature: r.signature as string,
      line: r.line as number,
      doc: r.doc as string,
      exported: !!(r.exported as number),
    }));

    const impStmt = this.db.prepare('SELECT from_path, names, is_external FROM imports WHERE file_path = ?');
    const impRows = impStmt.all(path) as Array<Record<string, unknown>>;
    const imports: ImportInfo[] = impRows.map(r => ({
      from: r.from_path as string,
      names: (r.names as string ? (r.names as string).split(',').filter(Boolean) : []),
      isExternal: (r.is_external as number) === 1,
      isDefault: false,
    }));

    return {
      lang: fileRow.lang,
      purpose: fileRow.purpose || '',
      lines: fileRow.lines,
      bytes: fileRow.bytes,
      precision: fileRow.precision,
      symbols,
      imports,
    };
  }

  getImportGraph(rootPrefix: string): { from: string; to: string; names: string[]; isExternal: boolean }[] {
    const stmt = this.db.prepare(
      `SELECT file_path, from_path, names, is_external FROM imports WHERE file_path LIKE ?`,
    );
    const rows = stmt.all(rootPrefix + '%') as { file_path: string; from_path: string; names: string; is_external: number }[];
    return rows.map(r => ({
      from: r.file_path,
      to: r.from_path,
      names: r.names.split(','),
      isExternal: r.is_external === 1,
    }));
  }

  searchSymbols(
    query: string,
    kind?: string,
    limit = 30,
    filePattern?: string,
  ): { name: string; kind: string; file: string; line: number; signature: string; exported: number }[] {
    const likeQuery = `%${query}%`;
    const conditions: string[] = ['name LIKE ?'];
    const params: string[] = [likeQuery];

    if (kind && kind !== 'all') {
      conditions.push('kind = ?');
      params.push(kind);
    }

    if (filePattern) {
      const sqlPattern = filePattern.replace(/\*\*/g, '%').replace(/\*/g, '%');
      conditions.push('file_path LIKE ?');
      params.push(`%${sqlPattern}%`);
    }

    const sql = `SELECT name, kind, file_path as file, line, signature, exported FROM symbols WHERE ${conditions.join(' AND ')} LIMIT ?`;
    params.push(String(limit));

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as { name: string; kind: string; file: string; line: number; signature: string; exported: number }[];
  }

  getFilesByExt(ext: string): { path: string; lang: string }[] {
    const stmt = this.db.prepare('SELECT path, lang FROM files WHERE path LIKE ?');
    return stmt.all(`%.${ext}`) as { path: string; lang: string }[];
  }

  removeStaleFiles(validPaths: Set<string>): number {
    const stmt = this.db.prepare('SELECT path FROM files');
    const allFiles = stmt.all() as { path: string }[];
    const toDelete: string[] = [];
    for (const { path } of allFiles) {
      if (!validPaths.has(path)) {
        toDelete.push(path);
      }
    }
    if (toDelete.length > 0) {
      const deleteStmt = this.db.prepare('DELETE FROM files WHERE path = ?');
      this.withTransaction(() => {
        for (const path of toDelete) {
          deleteStmt.run(path);
        }
      });
    }
    return toDelete.length;
  }

  getStats(): { fileCount: number; indexedBytes: number } {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number };
    const totalBytes = this.db.prepare('SELECT SUM(bytes) as b FROM files').get() as { b: number };
    return { fileCount: count?.c ?? 0, indexedBytes: totalBytes?.b ?? 0 };
  }

  getAllFiles(): { path: string; lang: string; lines: number; bytes: number }[] {
    return this.db.prepare('SELECT path, lang, lines, bytes FROM files').all() as { path: string; lang: string; lines: number; bytes: number }[];
  }

  getFilesWithSymbols(): { path: string; lang: string; lines: number; bytes: number }[] {
    return this.db.prepare(
      'SELECT DISTINCT f.path, f.lang, f.lines, f.bytes FROM files f INNER JOIN symbols s ON f.path = s.file_path',
    ).all() as { path: string; lang: string; lines: number; bytes: number }[];
  }

  getSymbolCount(path: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM symbols WHERE file_path = ?').get(path) as { c: number };
    return row?.c ?? 0;
  }

  // ─── Index management ─────────────────────────────────────────
  clear(): void {
    this.db.exec('DELETE FROM symbols');
    this.db.exec('DELETE FROM imports');
    this.db.exec('DELETE FROM files');
    this.setMeta('indexed_at', '');
  }

  setIndexed(): void {
    this.setMeta('indexed_at', new Date().toISOString());
  }

  getIndexedAt(): string | undefined {
    return this.getMeta('indexed_at');
  }
}
