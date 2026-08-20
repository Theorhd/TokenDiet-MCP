import { execFileSync } from 'node:child_process';
import { resolveRoot, toPosix, resolveSecurePath } from '../core/paths.js';
import { parseFile } from '../parsers/index.js';
import { readFileSafe } from '../core/utils.js';
import type { CacheManager } from '../core/cache.js';
import type { ChangedSymbolsOptions, ChangedSymbolsOutput, ChangedFileSummary } from '../types/index.js';

// Strict regex allowing only safe git ref characters, blocking options starting with '-'
const GIT_REF_REGEX = /^[a-zA-Z0-9_./^~@-]+$/;

function unquoteGitPath(pathStr: string): string {
  if (pathStr.startsWith('"') && pathStr.endsWith('"')) {
    return pathStr.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return pathStr;
}

export async function getChangedSymbols(
  root: string | undefined,
  cache: CacheManager,
  options: ChangedSymbolsOptions = {},
): Promise<ChangedSymbolsOutput> {
  const projectRoot = resolveRoot(root);
  const { stagedOnly = false, base } = options;

  if (base && (!GIT_REF_REGEX.test(base) || base.startsWith('-'))) {
    throw new Error(`Invalid git base reference: "${base}"`);
  }

  let branch = 'unknown';
  try {
    branch = execFileSync('git', ['-c', 'core.quotePath=false', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return { branch: 'not-a-git-repo', changedFiles: [], totalFilesChanged: 0 };
  }

  const changedFiles: ChangedFileSummary[] = [];

  try {
    let gitArgs: string[];
    if (base) {
      gitArgs = ['diff', '--name-status', base];
    } else if (stagedOnly) {
      gitArgs = ['diff', '--cached', '--name-status'];
    } else {
      gitArgs = ['status', '--porcelain'];
    }

    const statusOutput = execFileSync('git', ['-c', 'core.quotePath=false', ...gitArgs], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    if (!statusOutput) {
      return { branch, changedFiles: [], totalFilesChanged: 0 };
    }

    const lines = statusOutput.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let status: ChangedFileSummary['status'] = 'modified';
      let rawFilePath = '';

      if (base || stagedOnly) {
        const parts = trimmed.split(/\s+/);
        const statusCode = parts[0] ?? 'M';
        rawFilePath = parts.slice(1).join(' ');

        if (statusCode.startsWith('A')) status = 'added';
        else if (statusCode.startsWith('D')) status = 'deleted';
        else if (statusCode.startsWith('R')) {
          status = 'modified';
          // Git rename format: R100 oldPath newPath
          const renameParts = rawFilePath.split(/\s+/);
          rawFilePath = renameParts[renameParts.length - 1] ?? rawFilePath;
        } else status = 'modified';
      } else {
        const statusCode = trimmed.slice(0, 2).trim();
        rawFilePath = trimmed.slice(3).trim();

        if (statusCode === '??') status = 'untracked';
        else if (statusCode === 'A' || statusCode === 'AM') status = 'added';
        else if (statusCode === 'D') status = 'deleted';
        else status = 'modified';
      }

      const filePath = unquoteGitPath(rawFilePath);

      // Skip non-code files
      if (!filePath.match(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|cpp|h|hpp|cs|swift|kt)$/i)) {
        continue;
      }

      let addedSymbols: string[] = [];
      let modifiedSymbols: string[] = [];
      let removedSymbols: string[] = [];

      let fullCurrentPath = '';
      try {
        fullCurrentPath = resolveSecurePath(projectRoot, filePath);
      } catch {
        continue;
      }
      const currentContent = readFileSafe(fullCurrentPath);

      let oldContent: string | null = null;
      if (status !== 'untracked') {
        try {
          const gitBase = base || 'HEAD';
          oldContent = execFileSync('git', ['-c', 'core.quotePath=false', 'show', `${gitBase}:${filePath}`], {
            cwd: projectRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } catch {
          oldContent = null;
        }
      }

      if (currentContent && oldContent) {
        const currentParsed = parseFile(fullCurrentPath, currentContent);
        const oldParsed = parseFile(fullCurrentPath, oldContent);

        const oldSymMap = new Map(oldParsed.symbols.map(s => [s.name, s]));
        const newSymMap = new Map(currentParsed.symbols.map(s => [s.name, s]));

        for (const [name, sym] of newSymMap) {
          const old = oldSymMap.get(name);
          if (!old) {
            addedSymbols.push(name);
          } else if (old.signature !== sym.signature || old.line !== sym.line) {
            modifiedSymbols.push(name);
          }
        }

        for (const [name, sym] of oldSymMap) {
          if (!newSymMap.has(name)) {
            removedSymbols.push(name);
          }
        }
      } else if (currentContent && (status === 'added' || status === 'untracked')) {
        const parsed = parseFile(fullCurrentPath, currentContent);
        addedSymbols = parsed.symbols.map(s => s.name);
      }

      changedFiles.push({
        file: toPosix(filePath),
        status,
        addedSymbols,
        modifiedSymbols,
        removedSymbols,
      });
    }
  } catch {
    // Fail gracefully
  }

  return {
    branch,
    changedFiles,
    totalFilesChanged: changedFiles.length,
  };
}
