import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveRoot, toPosix } from '../core/paths.js';
import { readFileSafe } from '../core/utils.js';
import { parseFile } from '../parsers/index.js';
import type { ChangedSymbolsOutput, ChangedFileSummary } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface ChangedSymbolsOptions {
  stagedOnly?: boolean;
  base?: string;
}

export async function getChangedSymbols(
  root: string | undefined,
  cache: CacheManager,
  options: ChangedSymbolsOptions = {},
): Promise<ChangedSymbolsOutput> {
  const projectRoot = resolveRoot(root);
  const { stagedOnly = false, base } = options;

  let branch = 'unknown';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
  } catch {
    return { branch: 'not-a-git-repo', changedFiles: [], totalFilesChanged: 0 };
  }

  const changedFiles: ChangedFileSummary[] = [];

  try {
    let diffCmd = 'git status --porcelain';
    if (base) {
      diffCmd = `git diff --name-status ${base}`;
    } else if (stagedOnly) {
      diffCmd = 'git diff --cached --name-status';
    }

    const statusOutput = execSync(diffCmd, { cwd: projectRoot, encoding: 'utf-8' }).trim();
    if (!statusOutput) {
      return { branch, changedFiles: [], totalFilesChanged: 0 };
    }

    const lines = statusOutput.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let statusCode: string;
      let filePath: string;

      if (base || stagedOnly) {
        const parts = trimmed.split(/\s+/);
        statusCode = parts[0] ?? 'M';
        filePath = parts.slice(1).join(' ');
      } else {
        statusCode = trimmed.slice(0, 2).trim();
        filePath = trimmed.slice(3).trim();
      }

      let status: ChangedFileSummary['status'] = 'modified';
      if (statusCode.includes('A') || statusCode === '??') status = 'added';
      else if (statusCode.includes('D')) status = 'deleted';
      else if (statusCode === '??') status = 'untracked';

      const addedSymbols: string[] = [];
      const modifiedSymbols: string[] = [];
      const removedSymbols: string[] = [];

      const fullCurrentPath = resolve(projectRoot, filePath);
      const currentContent = readFileSafe(fullCurrentPath);

      let oldContent: string | null = null;
      try {
        const gitBase = base || (stagedOnly ? 'HEAD' : 'HEAD');
        oldContent = execSync(`git show ${gitBase}:${filePath}`, {
          cwd: projectRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        oldContent = null;
      }

      if (currentContent && oldContent) {
        const currentParsed = parseFile(fullCurrentPath, currentContent);
        const oldParsed = parseFile(fullCurrentPath, oldContent);

        const oldSymMap = new Map(oldParsed.symbols.map(s => [s.name, s]));
        const newSymMap = new Map(currentParsed.symbols.map(s => [s.name, s]));

        for (const [name, sym] of newSymMap) {
          const oldSym = oldSymMap.get(name);
          if (!oldSym) {
            addedSymbols.push(name);
          } else if (oldSym.signature !== sym.signature) {
            modifiedSymbols.push(name);
          }
        }

        for (const [name] of oldSymMap) {
          if (!newSymMap.has(name)) {
            removedSymbols.push(name);
          }
        }
      } else if (currentContent && !oldContent) {
        const currentParsed = parseFile(fullCurrentPath, currentContent);
        for (const s of currentParsed.symbols) {
          addedSymbols.push(s.name);
        }
      } else if (!currentContent && oldContent) {
        const oldParsed = parseFile(fullCurrentPath, oldContent);
        for (const s of oldParsed.symbols) {
          removedSymbols.push(s.name);
        }
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
