import type { Parser, FileOverview, SymbolInfo, ImportInfo, ExportInfo } from '../types/index.js';
import { detectLanguage } from '../core/walker.js';
import { firstDocSentence } from '../core/utils.js';
import { TypeScriptParser } from './typescript.js';
import { PythonParser } from './python.js';
import { GoParser } from './go.js';
import { RustParser } from './rust.js';

// ─── Parser Registry ────────────────────────────────────────────
const parsers: Map<string, Parser> = new Map();

function register(parser: Parser): void {
  for (const ext of parser.extensions) {
    parsers.set(ext, parser);
  }
}

// Register built-in parsers
register(new TypeScriptParser());
register(new PythonParser());
register(new GoParser());
register(new RustParser());

/** Get parser for a file extension */
export function getParser(ext: string): Parser | undefined {
  return parsers.get(ext);
}

/** Parse a file using the appropriate parser */
export function parseFile(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const lang = detectLanguage(filePath);
  const parser = getParser(ext);

  if (parser) {
    try {
      return { ...parser.parseFile(filePath, content), language: lang, precision: parser.tier === 'tree-sitter' ? 'full' : 'approx' };
    } catch {
      // Fall through to generic
    }
  }

  // Generic fallback: basic symbol extraction
  return genericParse(lang, content);
}

// ─── Re-export ──────────────────────────────────────────────────
export { TypeScriptParser, PythonParser, GoParser, RustParser };

// ─── Generic fallback parser ────────────────────────────────────
function genericParse(language: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];

  // Very basic heuristics
  const patterns: Record<string, RegExp> = {
    function: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
    class: /^\s*(?:export\s+)?class\s+(\w+)/,
    const: /^\s*(?:export\s+)?const\s+(\w+)\s*[:=]/,
    let: /^\s*(?:export\s+)?let\s+(\w+)\s*[:=]/,
    var: /^\s*(?:export\s+)?var\s+(\w+)\s*[:=]/,
    type: /^\s*(?:export\s+)?type\s+(\w+)\s*=/,
    interface: /^\s*(?:export\s+)?interface\s+(\w+)/,
    enum: /^\s*(?:export\s+)?enum\s+(\w+)/,
    import: /^\s*import\s+(?:[\w*\s{},]+from\s+)?['"]([^'"]+)['"]/,
    python_def: /^\s*def\s+(\w+)\s*\(/,
    python_class: /^\s*class\s+(\w+)/,
    go_func: /^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/,
    rust_fn: /^\s*(?:pub\s+)?fn\s+(\w+)\s*[<(]/,
    rust_struct: /^\s*(?:pub\s+)?struct\s+(\w+)/,
    rust_impl: /^\s*impl\s+(\w+)/,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const [kind, pattern] of Object.entries(patterns)) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const name = match[1];
        if (name === 'if' || name === 'for' || name === 'while' || name === 'switch' || name === 'return') continue;

        let symbolKind: SymbolInfo['kind'] = 'function';
        if (kind.includes('class') || kind === 'python_class') symbolKind = 'class';
        else if (kind === 'interface') symbolKind = 'interface';
        else if (kind === 'type') symbolKind = 'type';
        else if (kind === 'enum') symbolKind = 'enum';
        else if (kind === 'struct' || kind === 'rust_struct') symbolKind = 'struct';
        else if (kind.includes('def') || kind.includes('func') || kind.includes('fn')) symbolKind = 'function';

        symbols.push({
          name,
          kind: symbolKind,
          line: i + 1,
          signature: line.trim().slice(0, 90),
          doc: '',
          exported: line.includes('export ') || line.includes('pub '),
        });
        break;
      }
    }
  }

  return {
    language,
    purpose: '',
    lines: lines.length,
    bytes: Buffer.byteLength(content),
    imports,
    exports: symbols.filter(s => s.exported).map(s => ({ ...s, kind: s.kind as ExportInfo['kind'] })),
    symbols,
    precision: 'approx',
  };
}
