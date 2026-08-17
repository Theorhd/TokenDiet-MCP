import type { Parser, FileOverview, SymbolInfo, ImportInfo, ExportInfo } from '../types/index.js';
import { firstDocSentence } from '../core/utils.js';

export class PythonParser implements Parser {
  readonly language = 'python';
  readonly extensions = ['py', 'pyi'];
  readonly tier: 'tree-sitter' | 'regex' = 'regex';

  parseFile(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
    const lines = content.split('\n');
    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];

    let inDocstring = false;
    let docstringDelim = '';
    let pendingDoc: string | null = null;
    let inClass = 0;
    let classIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      const indent = line.search(/\S/);

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        if (!trimmed) pendingDoc = null;
        continue;
      }

      // Handle docstrings
      if (inDocstring) {
        if (trimmed.includes(docstringDelim)) {
          inDocstring = false;
          docstringDelim = '';
        }
        continue;
      }

      // Start of docstring
      const docStart = trimmed.match(/^("""|''')/);
      if (docStart) {
        const content = trimmed.replace(/^("""|''')/, '').replace(/("""|''')$/, '');
        if (trimmed.endsWith(docStart[0]!) && trimmed.length > 3) {
          // Single-line docstring
          pendingDoc = firstDocSentence(content);
        } else if (trimmed.endsWith(docStart[0]!)) {
          pendingDoc = firstDocSentence(content);
        } else {
          inDocstring = true;
          docstringDelim = docStart[0]!;
          pendingDoc = firstDocSentence(content);
        }
        continue;
      }

      // Track class context
      if (inClass > 0 && indent <= classIndent) {
        inClass = 0;
        classIndent = 0;
      }

      let sym: SymbolInfo | null = null;

      // Function definition
      const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?\s*:/);
      if (funcMatch) {
        const name = funcMatch[1] ?? '';
        const params = (funcMatch[2] ?? '').replace(/\n/g, ' ').slice(0, 50);
        const ret = funcMatch[3] ? ` -> ${funcMatch[3]}` : '';
        sym = {
          name,
          kind: inClass > 0 ? 'method' : 'function',
          line: i + 1,
          signature: `def ${name}(${params})${ret}`.slice(0, 90),
          doc: pendingDoc ?? '',
          exported: !name.startsWith('_'),
        };
      }

      // Class definition
      if (!sym) {
        const classMatch = trimmed.match(/^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/);
        if (classMatch) {
          const name = classMatch[1] ?? '';
          const bases = classMatch[2] ? `(${classMatch[2]})` : '';
          sym = {
            name,
            kind: 'class',
            line: i + 1,
            signature: `class ${name}${bases}`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: !name.startsWith('_'),
          };
          inClass = 1;
          classIndent = indent;
        }
      }

      // Decorated function/class — capture the next def/class
      if (trimmed.startsWith('@')) {
        // Store the decorator as context for the next symbol
        const decorator = trimmed.slice(1).split(/[(\s]/)[0] ?? '';
        // Look ahead for the decorated entity
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = (lines[j] ?? '').trim();
          const nextIndent = (lines[j] ?? '').search(/\S/);
          if (nextLine.startsWith('@')) continue; // chained decorators
          if (!nextLine || nextLine.startsWith('#')) continue;

          // Only match if at same indentation level
          const nextFuncMatch = nextLine.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
          if (nextFuncMatch) {
            sym = {
              name: nextFuncMatch[1] ?? '',
              kind: inClass > 0 ? 'method' : 'function',
              line: j + 1,
              signature: `@${decorator}\ndef ${nextFuncMatch[1]}(${(nextFuncMatch[2] ?? '').slice(0, 50)})`.slice(0, 90),
              doc: pendingDoc ?? '',
              exported: !(nextFuncMatch[1] ?? '').startsWith('_'),
            };
            i = j;
            break;
          }

          const nextClassMatch = nextLine.match(/^class\s+(\w+)/);
          if (nextClassMatch) {
            sym = {
              name: nextClassMatch[1] ?? '',
              kind: 'class',
              line: j + 1,
              signature: `@${decorator}\nclass ${nextClassMatch[1]}`.slice(0, 90),
              doc: pendingDoc ?? '',
              exported: !(nextClassMatch[1] ?? '').startsWith('_'),
            };
            i = j;
            break;
          }
          break;
        }
      }

      // ── Imports ──
      const importFrom = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)$/);
      if (importFrom) {
        const module = importFrom[1] ?? '';
        const items = (importFrom[2] ?? '').split(',').map(s => {
          const parts = s.trim().split(/\s+as\s+/);
          return (parts[0] ?? '').trim();
        });
        imports.push({
          from: module || 'builtin',
          names: items,
          isExternal: module !== '' && !module.startsWith('.'),
          isDefault: false,
        });
      }

      if (sym) {
        symbols.push(sym);
      }
      pendingDoc = null;
    }

    // Purpose detection
    let purpose = '';
    const filename = filePath.split('/').pop()?.toLowerCase() ?? '';
    if (filename.includes('test')) purpose = 'Test file';
    else if (filename === '__init__.py') purpose = 'Package init';
    else if (filename.includes('model')) purpose = 'Data models';
    else if (filename.includes('view')) purpose = 'Views';
    else if (filename.includes('url')) purpose = 'URL routing';
    else if (filename.includes('admin')) purpose = 'Admin interface';
    else if (filename.includes('serializer')) purpose = 'Serializers';
    else if (filename.includes('migration')) purpose = 'Database migration';

    return {
      language: 'python',
      purpose,
      lines: lines.length,
      bytes: Buffer.byteLength(content),
      imports,
      exports: symbols.filter(s => s.exported).map(s => ({
        name: s.name,
        kind: s.kind as ExportInfo['kind'],
        line: s.line,
        signature: s.signature,
        doc: s.doc,
        exported: true,
      })),
      symbols,
      precision: 'approx',
    };
  }
}
