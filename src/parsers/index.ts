import type { Parser, FileOverview, SymbolInfo, ImportInfo, ExportInfo } from '../types/index.js';
import { detectLanguage } from '../core/walker.js';
import { TypeScriptParser } from './typescript.js';
import { PythonParser } from './python.js';
import { GoParser } from './go.js';
import { RustParser } from './rust.js';
import { treeSitterManager, TreeSitterManager } from './treesitter.js';

// ─── Parser Registry ────────────────────────────────────────────
const parsers: Map<string, Parser> = new Map();

function register(parser: Parser): void {
  for (const ext of parser.extensions) {
    parsers.set(ext, parser);
  }
}

// Register built-in fallback parsers
register(new TypeScriptParser());
register(new PythonParser());
register(new GoParser());
register(new RustParser());

/** Get parser for a file extension */
export function getParser(ext: string): Parser | undefined {
  return parsers.get(ext);
}

/** Parse a file using Tree-Sitter first with transparent fallback to Regex */
export function parseFile(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const lang = detectLanguage(filePath);

  // 1. Try Tree-Sitter AST parser
  const tsResult = treeSitterManager.parse(filePath, content);
  if (tsResult) {
    return tsResult;
  }

  // 2. Specialized Regex Parser fallback
  const parser = getParser(ext);
  if (parser) {
    try {
      return {
        ...parser.parseFile(filePath, content),
        language: lang,
        tier: parser.tier ?? 'regex',
        precision: parser.tier === 'tree-sitter' ? 'full' : 'approx',
      };
    } catch {
      // Fall through to generic
    }
  }

  // 3. Generic fallback: basic symbol extraction
  return genericParse(lang, content);
}

// ─── Re-exports ──────────────────────────────────────────────────
export { TypeScriptParser, PythonParser, GoParser, RustParser, treeSitterManager, TreeSitterManager };

// ─── Generic fallback parser ────────────────────────────────────
function genericParse(language: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
  const lines = content.split('\n');
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];

  // Extended heuristic regex patterns
  const patterns: Record<string, RegExp> = {
    function: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
    class: /^\s*(?:export\s+|public\s+|private\s+|protected\s+|final\s+|abstract\s+)*class\s+(\w+)/,
    const: /^\s*(?:export\s+)?const\s+(\w+)\s*[:=]/,
    let: /^\s*(?:export\s+)?let\s+(\w+)\s*[:=]/,
    var: /^\s*(?:export\s+)?var\s+(\w+)\s*[:=]/,
    type: /^\s*(?:export\s+)?type\s+(\w+)\s*=/,
    interface: /^\s*(?:export\s+|public\s+|internal\s+)?interface\s+(\w+)/,
    enum: /^\s*(?:export\s+|public\s+)?enum\s+(\w+)/,
    import: /^\s*(?:import|using|require)\s+(?:[\w*\s{},]+from\s+)?['"]?([^'";]+)['"]?/,
    python_def: /^\s*def\s+(\w+)\s*[({:]/,
    python_class: /^\s*class\s+(\w+)/,
    go_func: /^\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/,
    rust_fn: /^\s*(?:pub\s+)?fn\s+(\w+)\s*[<(]/,
    rust_struct: /^\s*(?:pub\s+)?struct\s+(\w+)/,
    rust_impl: /^\s*impl\s+(\w+)/,
    java_method: /^\s*(?:public|private|protected|static|final|native|synchronized|abstract|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{?/,
    ruby_def: /^\s*def\s+(\w+)/,
    php_func: /^\s*(?:public|private|protected|static|\s)*function\s+(\w+)\s*\(/,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const [kind, pattern] of Object.entries(patterns)) {
      const match = line.match(pattern);
      if (match && match[1]) {
        if (kind === 'import') {
          const mod = match[1].trim();
          imports.push({
            from: mod,
            names: [],
            isExternal: !mod.startsWith('.') && !mod.startsWith('/'),
            isDefault: true,
          });
          break;
        }

        const name = match[1];
        if (['if', 'for', 'while', 'switch', 'return', 'catch', 'throw', 'new', 'try'].includes(name)) continue;

        let symbolKind: SymbolInfo['kind'] = 'function';
        if (kind.includes('class') || kind === 'python_class') symbolKind = 'class';
        else if (kind === 'interface') symbolKind = 'interface';
        else if (kind === 'type') symbolKind = 'type';
        else if (kind === 'enum') symbolKind = 'enum';
        else if (kind === 'struct' || kind === 'rust_struct') symbolKind = 'struct';
        else if (kind.includes('def') || kind.includes('func') || kind.includes('fn') || kind.includes('method')) symbolKind = 'function';

        symbols.push({
          name,
          kind: symbolKind,
          line: i + 1,
          signature: line.trim().slice(0, 90),
          doc: '',
          exported: line.includes('export ') || line.includes('pub ') || line.includes('public '),
        });
        break;
      }
    }
  }

  return {
    language,
    tier: 'regex',
    purpose: '',
    lines: lines.length,
    bytes: Buffer.byteLength(content),
    imports,
    exports: symbols.filter(s => s.exported).map(s => ({ ...s, kind: s.kind as ExportInfo['kind'] })),
    symbols,
    precision: 'approx',
  };
}
