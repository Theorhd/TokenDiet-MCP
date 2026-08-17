import type { Parser, FileOverview, SymbolInfo, ImportInfo, ExportInfo } from '../types/index.js';
import { firstDocSentence } from '../core/utils.js';

export class RustParser implements Parser {
  readonly language = 'rust';
  readonly extensions = ['rs'];
  readonly tier: 'tree-sitter' | 'regex' = 'regex';

  parseFile(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> {
    const lines = content.split('\n');
    const symbols: SymbolInfo[] = [];
    const imports: ImportInfo[] = [];
    let pendingDoc: string | null = null;
    let inImpl = '';
    let inTraitImpl = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      if (!trimmed) {
        pendingDoc = null;
        continue;
      }

      // Rust comments
      if (trimmed.startsWith('///')) {
        if (!pendingDoc) pendingDoc = trimmed.replace('///', '').trim();
        else pendingDoc += ' ' + trimmed.replace('///', '').trim();
        continue;
      }
      if (trimmed.startsWith('//!')) continue;
      if (trimmed.startsWith('//')) continue;
      if (trimmed.startsWith('/*')) {
        const endIdx = trimmed.indexOf('*/');
        if (endIdx > 2) pendingDoc = firstDocSentence(trimmed.slice(2, endIdx));
        continue;
      }

      // Detect attribute macros
      if (trimmed.startsWith('#[')) continue;

      // ── Imports ──
      const useMatch = trimmed.match(/^use\s+(.+?);/);
      if (useMatch && !trimmed.includes('{')) {
        const path = (useMatch[1] ?? '').replace(/::/g, '/');
        imports.push({
          from: path,
          names: [path.split('::').pop() ?? path],
          isExternal: !path.startsWith('crate') && !path.startsWith('self') && !path.startsWith('super'),
          isDefault: false,
        });
        continue;
      }

      // Multi-item use: use module::{A, B, C};
      const multiUse = trimmed.match(/^use\s+(.+?)::\{([^}]+)\};/);
      if (multiUse) {
        const base = (multiUse[1] ?? '').replace(/::/g, '/');
        const items = (multiUse[2] ?? '').split(',').map(s => s.trim());
        for (const item of items) {
          imports.push({
            from: `${base}/${item}`,
            names: [item],
            isExternal: !base.startsWith('crate') && !base.startsWith('self') && !base.startsWith('super'),
            isDefault: false,
          });
        }
        continue;
      }

      // ── End of impl block ──
      if (inImpl && trimmed === '}') {
        inImpl = '';
        continue;
      }
      if (inTraitImpl && trimmed === '}') {
        inTraitImpl = '';
        continue;
      }

      let sym: SymbolInfo | null = null;

      // ── Function ──
      const fnMatch = trimmed.match(/^(?:pub(?:\s*\(\s*(?:crate|super|self|in\s+\w+)\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*->\s*(.+?))?(?:\s*\{)?/);
      if (fnMatch) {
        const name = fnMatch[1] ?? '';
        const params = (fnMatch[2] ?? '').slice(0, 50);
        const ret = fnMatch[3] ? ` -> ${fnMatch[3].trim()}` : '';
        sym = {
          name: inImpl ? `${inImpl}::${name}` : name,
          kind: inImpl ? 'method' : 'function',
          line: i + 1,
          signature: `fn ${name}(${params})${ret}`.slice(0, 90),
          doc: pendingDoc ?? '',
          exported: trimmed.startsWith('pub'),
        };
      }

      // ── Struct ──
      if (!sym) {
        const structMatch = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)(?:<[^>]+>)?(?:\s*\{|\s*\(|\s*;)/);
        if (structMatch) {
          sym = {
            name: structMatch[1] ?? '',
            kind: 'struct',
            line: i + 1,
            signature: `struct ${structMatch[1]}${trimmed.includes('(') ? '(...)' : '{...}'}`.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: trimmed.startsWith('pub'),
          };
        }
      }

      // ── Enum ──
      if (!sym) {
        const enumMatch = trimmed.match(/^(?:pub\s+)?enum\s+(\w+)/);
        if (enumMatch) {
          sym = {
            name: enumMatch[1] ?? '',
            kind: 'enum',
            line: i + 1,
            signature: `enum ${enumMatch[1]}{...}`,
            doc: pendingDoc ?? '',
            exported: trimmed.startsWith('pub'),
          };
        }
      }

      // ── Trait ──
      if (!sym) {
        const traitMatch = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/);
        if (traitMatch) {
          sym = {
            name: traitMatch[1] ?? '',
            kind: 'trait',
            line: i + 1,
            signature: `trait ${traitMatch[1]}{...}`,
            doc: pendingDoc ?? '',
            exported: trimmed.startsWith('pub'),
          };
        }
      }

      // ── Impl block start ──
      if (!sym) {
        const implMatch = trimmed.match(/^impl\s+(?:<[^>]+>\s+)?(\w+)/);
        if (implMatch) {
          inImpl = implMatch[1] ?? '';
          if (trimmed.includes('for')) {
            const forMatch = trimmed.match(/impl\s+(?:<[^>]+>\s+)?(\w+(?:\s*<[^>]+>)?)\s+for\s+(\w+)/);
            if (forMatch) {
              inTraitImpl = forMatch[2] ?? '';
            }
          }
        }
      }

      // ── Type alias ──
      if (!sym) {
        const typeMatch = trimmed.match(/^(?:pub\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/);
        if (typeMatch) {
          sym = {
            name: typeMatch[1] ?? '',
            kind: 'type',
            line: i + 1,
            signature: `type ${typeMatch[1]} = ...`,
            doc: pendingDoc ?? '',
            exported: trimmed.startsWith('pub'),
          };
        }
      }

      // ── const / static ──
      if (!sym) {
        const constMatch = trimmed.match(/^(?:pub\s+)?(?:const|static)\s+(?:mut\s+)?(\w+)/);
        if (constMatch) {
          sym = {
            name: constMatch[1] ?? '',
            kind: 'const',
            line: i + 1,
            signature: trimmed.slice(0, 90),
            doc: pendingDoc ?? '',
            exported: trimmed.startsWith('pub'),
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
    if (filename === 'main.rs') purpose = 'Application entry point';
    else if (filename === 'lib.rs') purpose = 'Library root';
    else if (filename === 'mod.rs') purpose = 'Module declarations';
    else if (filename.includes('test')) purpose = 'Test module';
    else if (filename.includes('error')) purpose = 'Error types';
    else if (filename.includes('model') || filename.includes('types')) purpose = 'Data types';

    return {
      language: 'rust',
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
