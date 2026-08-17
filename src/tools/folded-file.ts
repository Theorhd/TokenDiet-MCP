import { resolve } from 'node:path';
import { resolveRoot, displayPath } from '../core/paths.js';
import { readFileSafe } from '../core/utils.js';
import { parseFile } from '../parsers/index.js';
import { detectLanguage } from '../core/walker.js';
import type { FoldedFileOutput } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface FoldedFileOptions {
  path: string;
  unfoldSymbols?: string[];
}

export async function getFoldedFile(
  root: string | undefined,
  cache: CacheManager,
  options: FoldedFileOptions,
): Promise<FoldedFileOutput> {
  const projectRoot = resolveRoot(root);
  const filePath = resolve(projectRoot, options.path);
  const { unfoldSymbols = [] } = options;

  const content = readFileSafe(filePath);
  if (content === null) {
    throw new Error(`File not found: ${filePath}`);
  }

  const lines = content.split('\n');
  const totalLines = lines.length;
  const parsed = parseFile(filePath, content);
  const unfoldSet = new Set(unfoldSymbols);
  const isPython = filePath.endsWith('.py') || filePath.endsWith('.pyi');

  // Identify ranges to fold
  const foldRanges: Array<{ start: number; end: number; symbol: string; linesCount: number }> = [];

  for (const sym of parsed.symbols) {
    if (unfoldSet.has(sym.name) || sym.kind === 'type' || sym.kind === 'interface') {
      continue;
    }

    const startLineIdx = sym.line - 1;
    let endLineIdx = startLineIdx;

    if (isPython) {
      const startIndent = lines[startLineIdx]?.search(/\S/) ?? 0;
      for (let i = startLineIdx + 1; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const indent = line.search(/\S/);
        if (indent <= startIndent) break;
        endLineIdx = i;
      }
    } else {
      let braceCount = 0;
      let started = false;
      for (let i = startLineIdx; i < lines.length; i++) {
        const line = lines[i] ?? '';
        for (let c = 0; c < line.length; c++) {
          if (line[c] === '{') {
            braceCount++;
            started = true;
          } else if (line[c] === '}') {
            braceCount--;
            if (started && braceCount <= 0) {
              endLineIdx = i;
              break;
            }
          }
        }
        if (started && braceCount <= 0) break;
      }
    }

    if (endLineIdx > startLineIdx + 1) {
      foldRanges.push({
        start: startLineIdx,
        end: endLineIdx,
        symbol: sym.name,
        linesCount: endLineIdx - startLineIdx,
      });
    }
  }

  // Merge / replace folded lines
  // Sort ranges by start line ascending
  foldRanges.sort((a, b) => a.start - b.start);

  const outputLines: string[] = [];
  let currentIdx = 0;
  let foldedLinesCount = 0;

  for (const range of foldRanges) {
    if (range.start < currentIdx) continue; // skip nested inside already folded range

    // Push preceding lines
    while (currentIdx <= range.start) {
      outputLines.push(lines[currentIdx] ?? '');
      currentIdx++;
    }

    // Fold the inner block
    const foldedCount = range.end - range.start;
    foldedLinesCount += foldedCount;

    if (isPython) {
      const indent = ' '.repeat((lines[range.start]?.search(/\S/) ?? 0) + 4);
      outputLines.push(`${indent}... # [${foldedCount} lines folded]`);
    } else {
      const lastLine = lines[range.end] ?? '';
      const closeBraceMatch = lastLine.match(/^\s*\}/);
      if (closeBraceMatch) {
        outputLines.push(`  /* ... ${foldedCount} lines folded */`);
        outputLines.push(lastLine);
      } else {
        outputLines.push(`  /* ... ${foldedCount} lines folded */`);
      }
    }

    currentIdx = range.end + 1;
  }

  while (currentIdx < lines.length) {
    outputLines.push(lines[currentIdx] ?? '');
    currentIdx++;
  }

  return {
    file: displayPath(projectRoot, filePath),
    language: detectLanguage(filePath),
    totalLines,
    foldedLines: foldedLinesCount,
    content: outputLines.join('\n'),
  };
}
