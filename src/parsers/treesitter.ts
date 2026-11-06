import { existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'web-tree-sitter';
import type { FileOverview, SymbolInfo, ImportInfo, ExportInfo, Precision } from '../types/index.js';
import { firstDocSentence } from '../core/utils.js';

type SupportedTreeSitterLang =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c_sharp'
  | 'ruby'
  | 'php';

const EXTENSION_TO_LANG: Record<string, SupportedTreeSitterLang> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'c_sharp',
  rb: 'ruby',
  erb: 'ruby',
  php: 'php',
};

export class TreeSitterManager {
  private static instance: TreeSitterManager | null = null;
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;
  private languages = new Map<SupportedTreeSitterLang, Parser.Language>();
  private parsers = new Map<SupportedTreeSitterLang, Parser>();
  private wasmSearchPaths: string[] = [];

  constructor() {
    this.setupWasmSearchPaths();
  }

  static getInstance(): TreeSitterManager {
    if (!TreeSitterManager.instance) {
      TreeSitterManager.instance = new TreeSitterManager();
    }
    return TreeSitterManager.instance;
  }

  private setupWasmSearchPaths(): void {
    const searchDirs: string[] = [];

    try {
      const currentDir = typeof __dirname !== 'undefined'
        ? __dirname
        : dirname(fileURLToPath(import.meta.url));

      // 1. Check local dist/wasms
      searchDirs.push(join(currentDir, 'wasms'));
      searchDirs.push(join(currentDir, '..', 'wasms'));
      searchDirs.push(join(currentDir, '..', '..', 'wasms'));

      // 2. Check node_modules/tree-sitter-wasms/out
      let dir = currentDir;
      for (let i = 0; i < 6; i++) {
        searchDirs.push(join(dir, 'node_modules', 'tree-sitter-wasms', 'out'));
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // Fallback
    }

    searchDirs.push(resolve('node_modules/tree-sitter-wasms/out'));
    searchDirs.push(resolve('dist/wasms'));

    this.wasmSearchPaths = searchDirs.filter(d => existsSync(d));
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initializingPromise) return this.initializingPromise;

    this.initializingPromise = (async () => {
      let coreWasmPath = '';
      try {
        const currentDir = typeof __dirname !== 'undefined'
          ? __dirname
          : dirname(fileURLToPath(import.meta.url));

        const localCandidates = [
          join(currentDir, 'wasms', 'tree-sitter.wasm'),
          join(currentDir, '..', 'wasms', 'tree-sitter.wasm'),
          join(currentDir, '..', '..', 'wasms', 'tree-sitter.wasm'),
        ];
        for (const c of localCandidates) {
          if (existsSync(c)) {
            coreWasmPath = c;
            break;
          }
        }

        if (!coreWasmPath) {
          let dir = currentDir;
          for (let i = 0; i < 6; i++) {
            const candidate = join(dir, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
            if (existsSync(candidate)) {
              coreWasmPath = candidate;
              break;
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
        }
      } catch {
        // Fallback
      }

      if (!coreWasmPath) {
        const distCandidate = resolve('dist/wasms/tree-sitter.wasm');
        coreWasmPath = existsSync(distCandidate)
          ? distCandidate
          : resolve('node_modules/web-tree-sitter/tree-sitter.wasm');
      }

      await Parser.init({
        locateFile() {
          return coreWasmPath;
        },
      });

      this.initialized = true;

      // Preload available language WASMs
      const preloadLangs: SupportedTreeSitterLang[] = [
        'typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java', 'c_sharp', 'ruby', 'php',
      ];
      for (const lang of preloadLangs) {
        try {
          await this.getParser(lang);
        } catch {
          // Graceful fallback if WASM file is absent
        }
      }
    })();

    await this.initializingPromise;
  }

  private resolveWasmPath(lang: SupportedTreeSitterLang): string | null {
    const wasmName = `tree-sitter-${lang}.wasm`;
    for (const searchDir of this.wasmSearchPaths) {
      const candidate = join(searchDir, wasmName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private maxActiveGrammars = 12;
  private lruOrder: SupportedTreeSitterLang[] = [];

  private markUsed(lang: SupportedTreeSitterLang): void {
    this.lruOrder = this.lruOrder.filter(k => k !== lang);
    this.lruOrder.push(lang);
  }

  private evictOldestIfNeeded(): void {
    while (this.parsers.size >= this.maxActiveGrammars && this.lruOrder.length > 0) {
      const oldest = this.lruOrder.shift();
      if (oldest) {
        this.parsers.delete(oldest);
        this.languages.delete(oldest);
      }
    }
  }

  /** Release all loaded WASM parsers and language instances from memory */
  clearMemory(): void {
    this.parsers.clear();
    this.languages.clear();
    this.lruOrder = [];
  }

  async getParser(lang: SupportedTreeSitterLang): Promise<Parser | null> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.parsers.has(lang)) {
      this.markUsed(lang);
      return this.parsers.get(lang)!;
    }

    this.evictOldestIfNeeded();

    let language = this.languages.get(lang);
    if (!language) {
      const wasmPath = this.resolveWasmPath(lang);
      if (!wasmPath) {
        return null;
      }
      try {
        language = await Parser.Language.load(wasmPath);
        this.languages.set(lang, language);
      } catch {
        return null;
      }
    }

    const parser = new Parser();
    parser.setLanguage(language);
    this.parsers.set(lang, parser);
    this.markUsed(lang);
    return parser;
  }

  /** Synchronous parse using preloaded or on-demand cached parser */
  parse(filePath: string, content: string): Omit<FileOverview, 'file' | 'lastModified'> | null {
    if (process.env.TOKENDIET_DISABLE_TREE_SITTER === '1' || process.env.TOKENDIET_DISABLE_TREE_SITTER === 'true') {
      return null;
    }

    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const lang = EXTENSION_TO_LANG[ext];
    if (!lang) return null;

    if (!this.initialized) {
      // If not yet initialized asynchronously, fallback
      return null;
    }

    let parser = this.parsers.get(lang);
    if (!parser && this.languages.has(lang)) {
      const language = this.languages.get(lang)!;
      parser = new Parser();
      parser.setLanguage(language);
      this.parsers.set(lang, parser);
      this.markUsed(lang);
    }

    if (!parser) {
      return null;
    }

    try {
      const tree = parser.parse(content);
      const lines = content.split('\n');
      const symbols: SymbolInfo[] = [];
      const imports: ImportInfo[] = [];
      const exports: ExportInfo[] = [];

      this.extractAST(tree.rootNode, lang, content, lines, symbols, imports, exports);

      // Deduplicate symbols by name + kind
      const seen = new Set<string>();
      const uniqueSymbols = symbols.filter(s => {
        const key = `${s.kind}:${s.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Deduplicate exports by name + kind
      const seenExports = new Set<string>();
      const uniqueExports = exports.filter(e => {
        const key = `${e.kind}:${e.name}`;
        if (seenExports.has(key)) return false;
        seenExports.add(key);
        return true;
      });

      // Deduplicate imports
      const seenImports = new Map<string, ImportInfo>();
      for (const imp of imports) {
        const existing = seenImports.get(imp.from);
        if (existing) {
          for (const n of imp.names) {
            if (!existing.names.includes(n)) existing.names.push(n);
          }
        } else {
          seenImports.set(imp.from, { ...imp, names: [...imp.names] });
        }
      }

      // Detect purpose
      let purpose = '';
      const fname = basename(filePath).toLowerCase();
      if (/\.(test|spec)\./.test(fname)) purpose = 'Test file';
      else if (fname.includes('config')) purpose = 'Configuration';
      else if (fname.includes('index')) purpose = 'Module entry point';
      else if (fname.includes('util') || fname.includes('helper')) purpose = 'Utility functions';
      else if (fname.includes('type') || fname.includes('schema')) purpose = 'Type definitions';
      else if (fname.includes('hook') || fname.includes('composable')) purpose = 'React hook / composable';
      else if (fname.includes('service')) purpose = 'Service layer';
      else if (fname.includes('component')) purpose = 'UI component';
      else if (uniqueExports.length > 0) purpose = `${uniqueExports.length} exported symbols`;
      else if (uniqueSymbols.length > 0) purpose = `${uniqueSymbols.length} symbols`;

      return {
        language: lang === 'c_sharp' ? 'cs' : lang,
        tier: 'tree-sitter',
        purpose,
        lines: lines.length,
        bytes: Buffer.byteLength(content),
        imports: Array.from(seenImports.values()),
        exports: uniqueExports,
        symbols: uniqueSymbols,
        precision: 'full',
      };
    } catch {
      return null;
    }
  }

  private extractCleanSignature(node: Parser.SyntaxNode, lines: string[]): string {
    const startRow = node.startPosition.row;
    const bodyNode = node.childForFieldName('body');
    const endRow = bodyNode ? bodyNode.startPosition.row : Math.min(node.endPosition.row, startRow + 4);
    const slice = lines.slice(startRow, Math.min(endRow + 1, startRow + 6)).join(' ');
    return slice
      .replace(/\{[\s\S]*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
  }

  private extractAST(
    rootNode: Parser.SyntaxNode,
    lang: SupportedTreeSitterLang,
    content: string,
    lines: string[],
    symbols: SymbolInfo[],
    imports: ImportInfo[],
    exports: ExportInfo[],
  ): void {
    const FUNCTION_BODY_CONTAINERS = new Set([
      'function_declaration',
      'generator_function_declaration',
      'method_definition',
      'arrow_function',
      'function_expression',
      'function_definition',
      'method_declaration',
      'constructor_declaration',
      'function_item',
      'closure_expression',
      'lambda_expression',
      'method',
      'singleton_method',
      'anonymous_function_creation_expression',
    ]);

    const visit = (node: Parser.SyntaxNode, parentExported = false) => {
      const type = node.type;

      // ─── TS / JS ───
      if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
        if (type === 'export_statement') {
          const sourceNode = node.childForFieldName('source');
          const from = sourceNode ? sourceNode.text.replace(/['"]/g, '') : null;
          const clauseNames: Array<{ name: string; exportedAs: string }> = [];

          for (const child of node.children) {
            if (child.type === 'export_clause') {
              for (const spec of child.children) {
                if (spec.type === 'export_specifier') {
                  const nameNode = spec.childForFieldName('name');
                  const aliasNode = spec.childForFieldName('alias');
                  if (nameNode) {
                    clauseNames.push({
                      name: nameNode.text,
                      exportedAs: aliasNode ? aliasNode.text : nameNode.text,
                    });
                  }
                }
              }
            }
          }

          if (from) {
            imports.push({
              from,
              names: clauseNames.map(c => c.name),
              isExternal: !from.startsWith('.') && !from.startsWith('/'),
              isDefault: false,
            });
            for (const c of clauseNames) {
              exports.push({
                name: c.exportedAs,
                kind: 'const',
                line: node.startPosition.row + 1,
                signature: `export { ${c.exportedAs} } from '${from}'`.slice(0, 90),
                doc: '',
                exported: true,
              });
            }
          } else if (clauseNames.length > 0) {
            for (const c of clauseNames) {
              const existingSym = symbols.find(s => s.name === c.name);
              if (existingSym) {
                existingSym.exported = true;
                exports.push({ ...existingSym, name: c.exportedAs, exported: true });
              } else {
                exports.push({
                  name: c.exportedAs,
                  kind: 'const',
                  line: node.startPosition.row + 1,
                  signature: `export { ${c.exportedAs} }`.slice(0, 90),
                  doc: '',
                  exported: true,
                });
              }
            }
          }

          for (const child of node.children) {
            if (child.type !== 'export' && child.type !== 'export_clause') {
              visit(child, true);
            }
          }
          return;
        }

        if (type === 'import_statement') {
          const sourceNode = node.childForFieldName('source');
          if (sourceNode) {
            const from = sourceNode.text.replace(/['"]/g, '');
            const names: string[] = [];
            let isDefault = false;

            for (const child of node.children) {
              if (child.type === 'import_clause') {
                for (const clauseChild of child.children) {
                  if (clauseChild.type === 'identifier') {
                    names.push(clauseChild.text);
                    isDefault = true;
                  } else if (clauseChild.type === 'named_imports') {
                    for (const spec of clauseChild.children) {
                      if (spec.type === 'import_specifier') {
                        const nameNode = spec.childForFieldName('name');
                        if (nameNode) names.push(nameNode.text);
                      }
                    }
                  } else if (clauseChild.type === 'namespace_import') {
                    for (const nsChild of clauseChild.children) {
                      if (nsChild.type === 'identifier') names.push(nsChild.text);
                    }
                  }
                }
              }
            }
            imports.push({
              from,
              names,
              isExternal: !from.startsWith('.') && !from.startsWith('/'),
              isDefault,
            });
          }
          return;
        }

        // Functions
        if (type === 'function_declaration' || type === 'generator_function_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'function',
              line: startLine,
              endLine,
              signature: this.extractCleanSignature(node, lines),
              doc,
              exported: parentExported,
            };
            symbols.push(sym);
            if (parentExported) exports.push({ ...sym, kind: 'function' });
          }
          return; // Do not recurse into function body
        }

        // Classes
        if (type === 'class_declaration' || type === 'abstract_class_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'class',
              line: startLine,
              endLine,
              signature: this.extractCleanSignature(node, lines),
              doc,
              exported: parentExported,
            };
            symbols.push(sym);
            if (parentExported) exports.push({ ...sym, kind: 'class' });
          }
        }

        // Interfaces
        if (type === 'interface_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'interface',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: parentExported,
            };
            symbols.push(sym);
            if (parentExported) exports.push({ ...sym, kind: 'interface' });
          }
          return;
        }

        // Types
        if (type === 'type_alias_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'type',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).trim(),
              doc,
              exported: parentExported,
            };
            symbols.push(sym);
            if (parentExported) exports.push({ ...sym, kind: 'type' });
          }
          return;
        }

        // Enums
        if (type === 'enum_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'enum',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: parentExported,
            };
            symbols.push(sym);
            if (parentExported) exports.push({ ...sym, kind: 'enum' });
          }
          return;
        }

        // Methods
        if (type === 'method_definition') {
          const nameNode = node.childForFieldName('name');
          if (nameNode && nameNode.text !== 'constructor') {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const doc = this.extractLeadingDoc(node, lines);
            symbols.push({
              name,
              kind: 'method',
              line: startLine,
              endLine,
              signature: this.extractCleanSignature(node, lines),
              doc,
              exported: false,
            });
          }
          return; // Do not recurse into method body
        }

        // Top-level or exported Variables / Const arrows
        if (type === 'lexical_declaration' || type === 'variable_declaration') {
          const parentType = node.parent?.type;
          const isModuleScope =
            parentExported ||
            parentType === 'program' ||
            parentType === 'internal_module' ||
            parentType === 'module' ||
            parentType === 'statement_block' && (node.parent?.parent?.type === 'internal_module' || node.parent?.parent?.type === 'module');

          if (isModuleScope) {
            for (const declarator of node.children) {
              if (declarator.type === 'variable_declarator') {
                const nameNode = declarator.childForFieldName('name');
                const valueNode = declarator.childForFieldName('value');
                if (nameNode && nameNode.type === 'identifier') {
                  const name = nameNode.text;
                  const isFunction = valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression';
                  const startLine = declarator.startPosition.row + 1;
                  const endLine = declarator.endPosition.row + 1;
                  const sigLine = lines[startLine - 1] ?? '';
                  const doc = this.extractLeadingDoc(node, lines);
                  const kind = isFunction ? 'function' : 'const';
                  const sym: SymbolInfo = {
                    name,
                    kind,
                    line: startLine,
                    endLine,
                    signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
                    doc,
                    exported: parentExported,
                  };
                  symbols.push(sym);
                  if (parentExported) exports.push({ ...sym, kind: kind as ExportInfo['kind'] });
                }
              }
            }
          }
          return; // Do not recurse into variable initializer bodies
        }
      }

      // ─── Python ───
      else if (lang === 'python') {
        if (type === 'import_statement') {
          for (const child of node.children) {
            if (child.type === 'dotted_name') {
              imports.push({ from: child.text, names: [child.text], isExternal: true, isDefault: false });
            } else if (child.type === 'aliased_import') {
              const nameNode = child.childForFieldName('name');
              if (nameNode) {
                imports.push({ from: nameNode.text, names: [nameNode.text], isExternal: true, isDefault: false });
              }
            }
          }
          return;
        } else if (type === 'import_from_statement') {
          const moduleNode = node.childForFieldName('module_name');
          if (moduleNode) {
            const from = moduleNode.text;
            const names: string[] = [];
            for (const child of node.children) {
              if (child.type === 'dotted_name' && child !== moduleNode) names.push(child.text);
              else if (child.type === 'identifier') names.push(child.text);
              else if (child.type === 'aliased_import') {
                const orig = child.childForFieldName('name');
                if (orig) names.push(orig.text);
              }
            }
            imports.push({ from, names, isExternal: !from.startsWith('.'), isDefault: false });
          }
          return;
        } else if (type === 'function_definition') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractPythonDocstring(node) || this.extractLeadingDoc(node, lines);
            const inClass = node.parent?.type === 'block' && node.parent?.parent?.type === 'class_definition';
            const sym: SymbolInfo = {
              name,
              kind: inClass ? 'method' : 'function',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/:$/, '').trim(),
              doc,
              exported: !inClass && !name.startsWith('_'),
            };
            symbols.push(sym);
            if (sym.exported) exports.push({ ...sym, kind: 'function' });
          }
          return; // Do not recurse into Python function body
        } else if (type === 'class_definition') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractPythonDocstring(node) || this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'class',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/:$/, '').trim(),
              doc,
              exported: !name.startsWith('_'),
            };
            symbols.push(sym);
            if (sym.exported) exports.push({ ...sym, kind: 'class' });
          }
        }
      }

      // ─── Go ───
      else if (lang === 'go') {
        if (type === 'import_spec') {
          const pathNode = node.childForFieldName('path');
          if (pathNode) {
            const from = pathNode.text.replace(/"/g, '');
            imports.push({ from, names: [], isExternal: !from.startsWith('.'), isDefault: false });
          }
          return;
        } else if (type === 'function_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const isExported = name[0] === name[0]?.toUpperCase();
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'function',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: isExported,
            };
            symbols.push(sym);
            if (isExported) exports.push({ ...sym, kind: 'function' });
          }
          return;
        } else if (type === 'method_declaration') {
          const nameNode = node.childForFieldName('name');
          const receiverNode = node.childForFieldName('receiver');
          if (nameNode) {
            const name = nameNode.text;
            const isExported = name[0] === name[0]?.toUpperCase();
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name: receiverNode ? `${receiverNode.text}.${name}` : name,
              kind: 'method',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: isExported,
            };
            symbols.push(sym);
          }
          return;
        } else if (type === 'type_spec') {
          const nameNode = node.childForFieldName('name');
          const typeNode = node.childForFieldName('type');
          if (nameNode) {
            const name = nameNode.text;
            const isExported = name[0] === name[0]?.toUpperCase();
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const kind = typeNode?.type === 'struct_type' ? 'struct' : typeNode?.type === 'interface_type' ? 'interface' : 'type';
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind,
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: isExported,
            };
            symbols.push(sym);
            if (isExported) exports.push({ ...sym, kind });
          }
          return;
        }
      }

      // ─── Rust ───
      else if (lang === 'rust') {
        if (type === 'use_declaration') {
          const useText = node.text.replace(/^pub\s+/, '').replace(/^use\s+/, '').replace(/;$/, '');
          imports.push({ from: useText, names: [useText], isExternal: !useText.startsWith('crate::') && !useText.startsWith('super::') && !useText.startsWith('self::'), isDefault: false });
          return;
        } else if (type === 'function_item') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const isPub = node.children[0]?.type === 'visibility_modifier';
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'function',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: isPub,
            };
            symbols.push(sym);
            if (isPub) exports.push({ ...sym, kind: 'function' });
          }
          return;
        } else if (type === 'struct_item' || type === 'enum_item' || type === 'trait_item') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const isPub = node.children[0]?.type === 'visibility_modifier';
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const kind = type === 'struct_item' ? 'struct' : type === 'enum_item' ? 'enum' : 'trait';
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind,
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: isPub,
            };
            symbols.push(sym);
            if (isPub) exports.push({ ...sym, kind });
          }
          return;
        }
      }

      // ─── Java / C# ───
      else if (lang === 'java' || lang === 'c_sharp') {
        if (type === 'import_declaration' || type === 'using_directive') {
          const text = node.text.replace(/^(?:import|using)\s+(?:static\s+)?/, '').replace(/;$/, '').trim();
          if (text) {
            imports.push({ from: text, names: [text.split('.').pop() ?? text], isExternal: true, isDefault: false });
          }
          return;
        } else if (type === 'class_declaration' || type === 'interface_declaration' || type === 'enum_declaration' || type === 'struct_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const isExported = node.text.startsWith('public ') || node.text.includes('public class') || node.text.includes('public interface');
            const kind = type.includes('class') ? 'class' : type.includes('interface') ? 'interface' : type.includes('enum') ? 'enum' : 'struct';
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind,
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: isExported,
            };
            symbols.push(sym);
            if (isExported) exports.push({ ...sym, kind });
          }
        } else if (type === 'method_declaration' || type === 'constructor_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const isExported = node.text.includes('public ');
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            symbols.push({
              name,
              kind: 'method',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: isExported,
            });
          }
          return;
        }
      }

      // ─── Ruby ───
      else if (lang === 'ruby') {
        if (type === 'call') {
          const methodNode = node.childForFieldName('method');
          const argsNode = node.childForFieldName('arguments');
          if (methodNode && (methodNode.text === 'require' || methodNode.text === 'require_relative') && argsNode) {
            const mod = argsNode.text.replace(/^[\s('"]+|[\s)'"]+$/g, '');
            if (mod) {
              imports.push({
                from: mod,
                names: [],
                isExternal: methodNode.text === 'require' && !mod.startsWith('.'),
                isDefault: true,
              });
            }
          }
        } else if (type === 'class' || type === 'module') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const kind = type === 'class' ? 'class' : 'module';
            const sym: SymbolInfo = {
              name,
              kind,
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).trim(),
              doc,
              exported: true,
            };
            symbols.push(sym);
            exports.push({ ...sym, kind });
          }
        } else if (type === 'method' || type === 'singleton_method') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const sym: SymbolInfo = {
              name,
              kind: 'function',
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).trim(),
              doc,
              exported: !name.startsWith('_'),
            };
            symbols.push(sym);
            if (sym.exported) exports.push({ ...sym, kind: 'function' });
          }
          return;
        }
      }

      // ─── PHP ───
      else if (lang === 'php') {
        if (type === 'namespace_use_declaration') {
          const useText = node.text.replace(/^use\s+/i, '').replace(/;$/, '').trim();
          if (useText) {
            imports.push({ from: useText, names: [useText.split('\\').pop() ?? useText], isExternal: true, isDefault: false });
          }
          return;
        } else if (type === 'class_declaration' || type === 'interface_declaration' || type === 'trait_declaration' || type === 'enum_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const kind = type.includes('class') ? 'class' : type.includes('interface') ? 'interface' : type.includes('trait') ? 'trait' : 'enum';
            const sym: SymbolInfo = {
              name,
              kind,
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: true,
            };
            symbols.push(sym);
            exports.push({ ...sym, kind });
          }
        } else if (type === 'function_definition' || type === 'method_declaration') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const name = nameNode.text;
            const startLine = node.startPosition.row + 1;
            const endLine = node.endPosition.row + 1;
            const sigLine = lines[startLine - 1] ?? '';
            const doc = this.extractLeadingDoc(node, lines);
            const isPrivate = node.text.startsWith('private ') || node.text.startsWith('protected ');
            const kind = type === 'method_declaration' ? 'method' : 'function';
            const sym: SymbolInfo = {
              name,
              kind,
              line: startLine,
              endLine,
              signature: sigLine.slice(0, 90).replace(/\{.*$/, '').trim(),
              doc,
              exported: !isPrivate,
            };
            symbols.push(sym);
            if (!isPrivate && kind === 'function') exports.push({ ...sym, kind: 'function' });
          }
          return;
        }
      }

      // Skip recursing into function/method body containers
      if (FUNCTION_BODY_CONTAINERS.has(type)) {
        return;
      }

      // Recurse children
      for (const child of node.children) {
        if (type === 'export_statement') {
          visit(child, true);
        } else {
          visit(child, false);
        }
      }
    };

    visit(rootNode);
  }

  private extractLeadingDoc(node: Parser.SyntaxNode, lines: string[]): string {
    const startLine = node.startPosition.row;
    if (startLine <= 0) return '';
    let lineIdx = startLine - 1;
    let docLine = '';

    while (lineIdx >= 0) {
      const line = (lines[lineIdx] ?? '').trim();
      if (!line) {
        lineIdx--;
        continue;
      }
      if (line.endsWith('*/')) {
        let blockDoc = '';
        while (lineIdx >= 0) {
          const bLine = (lines[lineIdx] ?? '').trim();
          blockDoc = bLine + ' ' + blockDoc;
          if (bLine.startsWith('/*')) break;
          lineIdx--;
        }
        return firstDocSentence(blockDoc.replace(/\/\*+|\*+\/|\*/g, '').trim());
      }
      if (line.startsWith('//') || line.startsWith('#') || line.startsWith('///')) {
        docLine = line.replace(/^\/\/\/|^\/\/|^#/, '').trim();
        return firstDocSentence(docLine);
      }
      break;
    }
    return '';
  }

  private extractPythonDocstring(node: Parser.SyntaxNode): string {
    const body = node.childForFieldName('body');
    if (!body) return '';
    const firstStmt = body.children[0];
    if (firstStmt && firstStmt.type === 'expression_statement') {
      const stringNode = firstStmt.children[0];
      if (stringNode && stringNode.type === 'string') {
        const text = stringNode.text.replace(/^["']{1,3}|["']{1,3}$/g, '').trim();
        return firstDocSentence(text);
      }
    }
    return '';
  }
}

export const treeSitterManager = TreeSitterManager.getInstance();
