import { resolveRoot, displayPath, resolveSecurePath } from '../core/paths.js';
import { readFileSafe } from '../core/utils.js';
import { parseFile } from '../parsers/index.js';
import type { SymbolBodyOutput, SymbolKind } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface SymbolBodyOptions {
  path: string;
  symbol: string;
  maxLines?: number;
}

export async function getSymbolBody(
  root: string | undefined,
  cache: CacheManager,
  options: SymbolBodyOptions,
): Promise<SymbolBodyOutput> {
  const projectRoot = resolveRoot(root);
  const filePath = resolveSecurePath(projectRoot, options.path);
  const { symbol: targetName, maxLines = 150 } = options;

  const content = readFileSafe(filePath);
  if (content === null) {
    throw new Error(`File not found: ${filePath}`);
  }

  const lines = content.split('\n');
  const parsed = parseFile(filePath, content);
  const targetSym = parsed.symbols.find(s => s.name === targetName || s.name.endsWith(`.${targetName}`) || s.name.endsWith(`::${targetName}`));

  if (!targetSym) {
    throw new Error(`Symbol '${targetName}' not found in ${options.path}`);
  }

  const startLineIdx = targetSym.line - 1; // 0-indexed
  const isPython = filePath.endsWith('.py') || filePath.endsWith('.pyi');

  let endLineIdx = startLineIdx;

  if (isPython) {
    const startIndent = lines[startLineIdx]?.search(/\S/) ?? 0;
    endLineIdx = startLineIdx + 1;
    for (let i = startLineIdx + 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        endLineIdx = i + 1;
        continue;
      }
      const indent = line.search(/\S/);
      if (indent <= startIndent) {
        break;
      }
      endLineIdx = i + 1;
    }
  } else {
    // Brace-counting for TS, JS, Go, Rust, etc.
    let braceCount = 0;
    let started = false;
    for (let i = startLineIdx; i < lines.length; i++) {
      let line = lines[i] ?? '';
      const commentIdx = line.indexOf('//');
      if (commentIdx !== -1) {
        line = line.slice(0, commentIdx);
      }
      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
          if (started && braceCount <= 0) {
            endLineIdx = i + 1;
            break;
          }
        }
      }
      if (started && braceCount <= 0) {
        endLineIdx = i + 1;
        break;
      }
      endLineIdx = i + 1;
    }
  }

  // Include preceding doc comments if any
  let docStartLineIdx = startLineIdx;
  for (let i = startLineIdx - 1; i >= Math.max(0, startLineIdx - 15); i--) {
    const prevLine = (lines[i] ?? '').trim();
    if (prevLine.startsWith('*') || prevLine.startsWith('/**') || prevLine.startsWith('*/') ||
        prevLine.startsWith('//') || prevLine.startsWith('///') || prevLine.startsWith('#')) {
      docStartLineIdx = i;
    } else {
      break;
    }
  }

  const selectedLines = lines.slice(docStartLineIdx, endLineIdx);
  let truncated: string | undefined;
  let bodyText = selectedLines.join('\n');

  if (selectedLines.length > maxLines) {
    bodyText = selectedLines.slice(0, maxLines).join('\n') + `\n// ... [truncated: ${selectedLines.length - maxLines} lines omitted]`;
    truncated = `Body truncated at ${maxLines} lines (total: ${selectedLines.length})`;
  }

  return {
    file: displayPath(projectRoot, filePath),
    symbol: targetSym.name,
    kind: targetSym.kind,
    line: docStartLineIdx + 1,
    endLine: endLineIdx,
    signature: targetSym.signature,
    doc: targetSym.doc,
    body: bodyText,
    _truncated: truncated,
  };
}
