import type { Parser, FileOverview, SymbolInfo, ImportInfo, ExportInfo } from '../types/index.js';
import { firstDocSentence } from '../core/utils.js';

export class GoParser implements Parser {
  readonly language = 'go';
  readonly extensions = ['go'];
  readonly tier: 'tree-sitter' | 'regex' = 'regex';

  parseFile(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
    const lines = content.split('\n');
    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];
    let inMultilineImport = false;
    let pendingDoc: string | null = null;
    let inStruct = false;
    let structName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) {
        pendingDoc = null;
        continue;
      }

      // Go comments
      if (trimmed.startsWith('//')) {
        // Capture doc comments (lines starting with // functionName ...)
        const docMatch = trimmed.match(/^\/\/\s+(\w+)\s+(.+)/);
        if (docMatch) {
          pendingDoc = firstDocSentence(docMatch[2] ?? '');
        }
        continue;
      }
      if (trimmed.startsWith('/*')) {
        const endIdx = trimmed.indexOf('*/');
        if (endIdx > 2) {
          pendingDoc = firstDocSentence(trimmed.slice(2, endIdx).trim());
        }
        continue;
      }

      // ── Package declaration ──
      const pkgMatch = trimmed.match(/^package\s+(\w+)/);
      if (pkgMatch) {
        symbols.push({
          name: `package ${pkgMatch[1]}`,
          kind: 'module',
          line: i + 1,
          signature: `package ${pkgMatch[1]}`,
          doc: '',
          exported: true,
        });
        continue;
      }

      // ── Imports ──
      if (trimmed === 'import (') {
        inMultilineImport = true;
        continue;
      }
      if (inMultilineImport && trimmed === ')') {
        inMultilineImport = false;
        continue;
      }
      if (inMultilineImport) {
        const imp = trimmed.replace(/^"|"$/g, '').replace(/^\w+\s+"|"$/g, '');
        imports.push({
          from: imp,
          names: ['*'],
          isExternal: !imp.startsWith('.'),
          isDefault: false,
        });
        continue;
      }
      const singleImport = trimmed.match(/^import\s+(?:\w+\s+)?["“]([^"”]+)["”]/);
      if (singleImport) {
        imports.push({
          from: singleImport[1] ?? '',
          names: ['*'],
          isExternal: true,
          isDefault: false,
        });
        continue;
      }

      let sym: SymbolInfo | null = null;

      // ── Function ──
      const funcMatch = trimmed.match(/^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(?([^)]*)\)?)?(?:\s*\{)?/);
      if (funcMatch) {
        const receiver = funcMatch[1] ? `(${funcMatch[1]} ${funcMatch[2]}) ` : '';
        const name = funcMatch[3] ?? '';
        const params = (funcMatch[4] ?? '').slice(0, 50);
        const returns = funcMatch[5] ? ` ${funcMatch[5]}` : '';
        sym = {
          name: receiver ? `${funcMatch[2]}.${name}` : name,
          kind: receiver ? 'method' : 'function',
          line: i + 1,
          signature: `func ${receiver}${name}(${params})${returns}`.slice(0, 90),
          doc: pendingDoc ?? '',
          exported: /^[A-Z]/.test(name),
        };
      }

      // ── Struct ──
      if (!sym) {
        const structMatch = trimmed.match(/^type\s+(\w+)\s+struct\s*\{/);
        if (structMatch) {
          sym = {
            name: structMatch[1] ?? '',
            kind: 'struct',
            line: i + 1,
            signature: `type ${structMatch[1]} struct{...}`,
            doc: pendingDoc ?? '',
            exported: /^[A-Z]/.test(structMatch[1] ?? ''),
          };
          inStruct = true;
          structName = structMatch[1] ?? '';
        }
      }

      // ── Interface ──
      if (!sym) {
        const ifaceMatch = trimmed.match(/^type\s+(\w+)\s+interface\s*\{/);
        if (ifaceMatch) {
          sym = {
            name: ifaceMatch[1] ?? '',
            kind: 'interface',
            line: i + 1,
            signature: `type ${ifaceMatch[1]} interface{...}`,
            doc: pendingDoc ?? '',
            exported: /^[A-Z]/.test(ifaceMatch[1] ?? ''),
          };
        }
      }

      // ── Type alias ──
      if (!sym) {
        const typeMatch = trimmed.match(/^type\s+(\w+)\s+(\S+)/);
        if (typeMatch && !['struct', 'interface'].includes(typeMatch[2] ?? '')) {
          sym = {
            name: typeMatch[1] ?? '',
            kind: 'type',
            line: i + 1,
            signature: `type ${typeMatch[1]} ${typeMatch[2]}`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: /^[A-Z]/.test(typeMatch[1] ?? ''),
          };
        }
      }

      // ── Variable / Constant ──
      if (!sym) {
        const varMatch = trimmed.match(/^(?:var|const)\s+(\w+)\s/);
        if (varMatch) {
          sym = {
            name: varMatch[1] ?? '',
            kind: 'const',
            line: i + 1,
            signature: trimmed.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: /^[A-Z]/.test(varMatch[1] ?? ''),
          };
        }
      }

      if (sym) {
        symbols.push(sym);
      }
      pendingDoc = null;
    }

    let purpose = '';
    const filename = filePath.split('/').pop()?.toLowerCase() ?? '';
    if (filename.endsWith('_test.go')) purpose = 'Test file';
    else if (filename === 'main.go') purpose = 'Application entry point';
    else if (filename.includes('handler')) purpose = 'HTTP handler';
    else if (filename.includes('model')) purpose = 'Data model';
    else if (filename.includes('service')) purpose = 'Service layer';
    else if (filename.includes('repository')) purpose = 'Data access layer';
    else if (filename.includes('middleware')) purpose = 'Middleware';

    return {
      language: 'go',
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
