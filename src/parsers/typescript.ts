import type { Parser, FileOverview, SymbolInfo, ImportInfo, ExportInfo } from '../types/index.js';
import { firstDocSentence } from '../core/utils.js';

// ─── TypeScript / JavaScript Regex Parser ────────────────────────
export class TypeScriptParser implements Parser {
  readonly language = 'typescript';
  readonly extensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'];
  readonly tier: 'tree-sitter' | 'regex' = 'regex';

  parseFile(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
    const lines = content.split('\n');
    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    // State machine
    let inMultilineComment = false;
    let inTemplateLiteral = false;
    let pendingDoc: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i] ?? '';
      const trimmed = line.trim();

      // Handle multiline template literals
      if (inTemplateLiteral) {
        if (countUnescapedBackticks(line) % 2 === 1) {
          inTemplateLiteral = false;
        }
        continue;
      }

      // Skip empty lines
      if (!trimmed) {
        pendingDoc = null;
        continue;
      }

      // Handle multiline comments
      if (inMultilineComment) {
        if (trimmed.includes('*/')) {
          inMultilineComment = false;
          line = line.substring(line.indexOf('*/') + 2);
        } else {
          continue;
        }
      }

      // Extract doc comments
      const docMatch = trimmed.match(/^\/\*\*\s*(.*?)\s*\*\/\s*$/);
      if (docMatch) {
        pendingDoc = firstDocSentence(docMatch[1] ?? '');
        continue;
      }

      if (trimmed.startsWith('/**')) {
        pendingDoc = firstDocSentence(trimmed.replace('/**', '').trim());
        if (!trimmed.includes('*/')) inMultilineComment = true;
        continue;
      }

      if (trimmed.startsWith('//')) continue;
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inMultilineComment = true;
        continue;
      }

      // Comments in the middle of a line — strip
      let codeLine = line;
      // Remove inline comments (but not inside strings)
      const commentIdx = codeLine.indexOf('//');
      if (commentIdx > 0 && !isInsideString(codeLine, commentIdx)) {
        codeLine = codeLine.substring(0, commentIdx);
      }

      if (countUnescapedBackticks(codeLine) % 2 === 1) {
        inTemplateLiteral = true;
      }

      const cleanLine = codeLine.trim();

      // ── Imports ──
      const importMatch = cleanLine.match(
        /^import\s+(?:(?:type\s+)?\{([^}]+)\}|(?:type\s+)?(\w+)(?:\s*,\s*\{([^}]+)\})?|(\* as \w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/,
      );
      if (importMatch) {
        const from = importMatch[6] ?? '';
        const rawNames: string[] = [];
        if (importMatch[1]) rawNames.push(...importMatch[1].split(',').map(s => s.trim()).filter(Boolean));
        if (importMatch[2]) rawNames.push(importMatch[2]);
        if (importMatch[3]) rawNames.push(...importMatch[3].split(',').map(s => s.trim()).filter(Boolean));
        if (importMatch[4]) rawNames.push(importMatch[4].replace('* as ', '').trim());

        const names = rawNames.map(n => {
          const stripped = n.replace(/^type\s+/, '').trim();
          if (stripped.includes(' as ')) {
            return stripped.split(/\s+as\s+/)[0]?.trim() ?? stripped;
          }
          return stripped;
        }).filter(Boolean);

        imports.push({
          from,
          names,
          isExternal: !from.startsWith('.') && !from.startsWith('/'),
          isDefault: !!importMatch[2],
        });
        pendingDoc = null;
        continue;
      }

      // Dynamic import
      const dynImport = cleanLine.match(/import\(['"]([^'"]+)['"]\)/);
      if (dynImport) {
        imports.push({
          from: dynImport[1] ?? '',
          names: ['*'],
          isExternal: !(dynImport[1] ?? '').startsWith('.'),
          isDefault: false,
        });
      }

      // CommonJS require: const { a, b } = require('./x') or const x = require('./x')
      const requireMatch = cleanLine.match(/(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/);
      if (requireMatch) {
        const from = requireMatch[3] ?? '';
        const names: string[] = [];
        if (requireMatch[1]) {
          names.push(...requireMatch[1].split(',').map(s => {
            const part = s.trim();
            if (part.includes(':')) return part.split(':')[0]?.trim() ?? part;
            return part;
          }).filter(Boolean));
        } else if (requireMatch[2]) {
          names.push(requireMatch[2]);
        }
        imports.push({
          from,
          names,
          isExternal: !from.startsWith('.') && !from.startsWith('/'),
          isDefault: !!requireMatch[2],
        });
      }

      // ── Exports ──
      const isExport = cleanLine.startsWith('export ');

      // export * from '...' or export * as ns from '...'
      const starExport = cleanLine.match(/^export\s+\*\s*(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/);
      if (starExport) {
        const from = starExport[1] ?? '';
        imports.push({ from, names: [], isExternal: !from.startsWith('.'), isDefault: false });
        pendingDoc = null;
        continue;
      }

      // export { x, y } from '...'
      const reExport = cleanLine.match(/^export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
      if (reExport) {
        const rawNames = reExport[1]?.split(',').map(s => s.trim()) ?? [];
        const from = reExport[2] ?? '';
        const names = rawNames.map(n => {
          if (n.includes(' as ')) {
            return n.split(/\s+as\s+/)[0]?.trim() ?? n;
          }
          return n;
        }).filter(Boolean);
        imports.push({ from, names, isExternal: !from.startsWith('.'), isDefault: false });
        for (const name of names) {
          exports.push({ name, kind: 'const', line: i + 1, signature: `re-export from ${from}`, doc: '', exported: true });
        }
        pendingDoc = null;
        continue;
      }

      // export default ...
      const defaultExport = cleanLine.match(/^export\s+default\s+(?:function\s+(\w+)|class\s+(\w+)|(\w+))/);
      if (defaultExport) {
        const name = defaultExport[1] || defaultExport[2] || defaultExport[3] || 'default';
        const kind = defaultExport[1] ? 'function' : defaultExport[2] ? 'class' : 'const';
        const sym = { name, kind, line: i + 1, signature: cleanLine.slice(0, 90), doc: pendingDoc ?? '', exported: true } satisfies SymbolInfo;
        symbols.push(sym);
        exports.push({ ...sym, kind: kind as ExportInfo['kind'] });
        pendingDoc = null;
        continue;
      }

      // ── Symbol extraction ──
      let sym: SymbolInfo | null = null;

      // Function declaration (supports single-line and multiline parameter lists)
      const funcMatch = cleanLine.match(
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)(?:\)(?:\s*:\s*(\S+(?:\s*\|?\s*\S+)*))?)?/,
      );
      if (funcMatch) {
        const name = funcMatch[1] ?? '';
        let params = (funcMatch[2] ?? '').trim();
        let retType = funcMatch[3] ?? 'void';
        if (!cleanLine.includes(')')) {
          const nextSlice = lines
            .slice(i, Math.min(i + 6, lines.length))
            .map(l => l.trim())
            .join(' ');
          const multiMatch = nextSlice.match(
            /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/,
          );
          if (multiMatch) {
            params = (multiMatch[1] ?? '').trim();
            retType = (multiMatch[2] ?? 'void').trim();
          }
        }
        sym = {
          name,
          kind: 'function',
          line: i + 1,
          signature: `${name}(${params.slice(0, 60)}) => ${retType}`.slice(0, 90),
          doc: pendingDoc ?? '',
          exported: isExport,
        };
      }

      // Arrow function / const function / exported const
      if (!sym) {
        const arrowMatch = cleanLine.match(
          /^(?:export\s+)?const\s+(\w+)\s*(?:=\s*(?:async\s+)?\(([^)]*)\)(?:\s*:\s*(\S+(?:\s*\|?\s*\S+)*))?\s*=>|:\s*(?:React\.)?FC|:\s*\(([^)]*)\)\s*=>\s*\S+)/,
        );
        if (arrowMatch) {
          const name = arrowMatch[1] ?? '';
          const isReactComponent = cleanLine.includes(': FC') || cleanLine.includes(': React.FC') || cleanLine.includes(': FunctionComponent');
          sym = {
            name,
            kind: cleanLine.includes('=>') ? 'function' : 'const',
            line: i + 1,
            signature: `${name}: ${isReactComponent ? 'React.FC' : 'const'}`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: isExport,
          };
        } else if (isExport) {
          const constMatch = cleanLine.match(/^export\s+const\s+(\w+)\s*(?::\s*[^=]+)?\s*=/);
          if (constMatch && constMatch[1]) {
            sym = {
              name: constMatch[1],
              kind: 'const',
              line: i + 1,
              signature: cleanLine.replace(/\{.*$/, '').trim().slice(0, 90),
              doc: pendingDoc ?? '',
              exported: true,
            };
          }
        }
      }

      // Class declaration
      if (!sym) {
        const classMatch = cleanLine.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+(?:\s*,\s*\w+)*))?(?:\s+implements\s+([^{]+))?/);
        if (classMatch) {
          const name = classMatch[1] ?? '';
          const extendsCls = classMatch[2] ? ` extends ${classMatch[2]}` : '';
          const impl = classMatch[3] ? ` implements ${classMatch[3].trim()}` : '';
          sym = {
            name,
            kind: 'class',
            line: i + 1,
            signature: `class ${name}${extendsCls}${impl}`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: isExport,
          };
        }
      }

      // Interface declaration
      if (!sym) {
        const ifaceMatch = cleanLine.match(/^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?/);
        if (ifaceMatch) {
          sym = {
            name: ifaceMatch[1] ?? '',
            kind: 'interface',
            line: i + 1,
            signature: `interface ${ifaceMatch[1]}${ifaceMatch[2] ? ` extends ${ifaceMatch[2].trim()}` : ''}`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: isExport,
          };
        }
      }

      // Type alias
      if (!sym) {
        const typeMatch = cleanLine.match(/^(?:export\s+)?type\s+(\w+)(?:\s*<[^>]+>)?\s*=\s*(.+)/);
        if (typeMatch) {
          sym = {
            name: typeMatch[1] ?? '',
            kind: 'type',
            line: i + 1,
            signature: `type ${typeMatch[1]} = ${(typeMatch[2] ?? '').slice(0, 50)}`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: isExport,
          };
        }
      }

      // Enum
      if (!sym) {
        const enumMatch = cleanLine.match(/^(?:export\s+)?enum\s+(\w+)/);
        if (enumMatch) {
          sym = {
            name: enumMatch[1] ?? '',
            kind: 'enum',
            line: i + 1,
            signature: `enum ${enumMatch[1]}`,
            doc: pendingDoc ?? '',
            exported: isExport,
          };
        }
      }

      // Class method
      if (!sym && /^\s{2,}(?:public|private|protected|static|async|readonly)\s/.test(codeLine)) {
        const methodMatch = cleanLine.match(/^(?:public|private|protected|static|async|readonly|\s)+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\S+))?/);
        if (methodMatch && methodMatch[1] && !['if', 'for', 'while', 'switch', 'return', 'throw', 'new', 'const', 'let', 'var'].includes(methodMatch[1])) {
          sym = {
            name: methodMatch[1],
            kind: 'method',
            line: i + 1,
            signature: `${methodMatch[1]}(${(methodMatch[2] ?? '').slice(0, 40)})`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: false,
          };
        }
      }

      if (sym) {
        symbols.push(sym);
        if (sym.exported) {
          exports.push({ ...sym, kind: sym.kind as ExportInfo['kind'] });
        }
      }

      pendingDoc = null;
    }

    // Deduplicate symbols by name
    const seen = new Set<string>();
    const uniqueSymbols = symbols.filter(s => {
      const key = `${s.kind}:${s.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Deduplicate imports by merging names per module
    const seenImports = new Map<string, ImportInfo>();
    for (const imp of imports) {
      const existing = seenImports.get(imp.from);
      if (existing) {
        for (const n of imp.names) {
          if (!existing.names.includes(n)) existing.names.push(n);
        }
        if (imp.isDefault) existing.isDefault = true;
      } else {
        seenImports.set(imp.from, { ...imp, names: [...imp.names] });
      }
    }
    const uniqueImports = Array.from(seenImports.values());

    // Heuristic purpose detection
    let purpose = '';
    const filename = filePath.split('/').pop()?.toLowerCase() ?? '';
    if (/\.(test|spec)\./.test(filename)) purpose = 'Test file';
    else if (filename.includes('config')) purpose = 'Configuration';
    else if (filename.includes('index')) purpose = 'Module entry point';
    else if (filename.includes('util') || filename.includes('helper')) purpose = 'Utility functions';
    else if (filename.includes('type') || filename.includes('schema')) purpose = 'Type definitions';
    else if (filename.includes('hook') || filename.includes('composable')) purpose = 'React hook / composable';
    else if (filename.includes('context') || filename.includes('provider')) purpose = 'React context provider';
    else if (filename.includes('service')) purpose = 'Service layer';
    else if (filename.includes('component')) purpose = 'UI component';
    else if (symbols.length > 0) purpose = `${symbols.length} exported symbols`;

    return {
      language: 'typescript',
      tier: 'regex',
      purpose,
      lines: lines.length,
      bytes: Buffer.byteLength(content),
      imports: uniqueImports,
      exports,
      symbols: uniqueSymbols,
      precision: 'approx',
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
function isInsideString(line: string, idx: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < idx; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (ch === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;
    else if (ch === '\\' && (inSingle || inDouble || inBacktick)) i++; // skip escaped char
  }

  return inSingle || inDouble || inBacktick;
}

function countUnescapedBackticks(line: string): number {
  let count = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '`' && !inSingle && !inDouble) count++;
  }
  return count;
}
