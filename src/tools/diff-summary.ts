import { resolveRoot } from '../core/paths.js';
import { getChangedSymbols } from './changed-symbols.js';
import { getImpactAnalysis } from './impact-analysis.js';
import type { CacheManager } from '../core/cache.js';

export interface DiffSummaryOptions {
  base?: string;
  stagedOnly?: boolean;
}

export interface DiffSummaryOutput {
  branch: string;
  filesChanged: number;
  totalAddedSymbols: number;
  totalModifiedSymbols: number;
  totalRemovedSymbols: number;
  criticalChanges: Array<{
    file: string;
    impactedFiles: number;
    impactedTests: string[];
    blastRadius: string;
  }>;
  summaryText: string;
}

export async function getDiffSummary(
  root: string | undefined,
  cache: CacheManager,
  options: DiffSummaryOptions = {},
): Promise<DiffSummaryOutput> {
  const projectRoot = resolveRoot(root);
  const changed = await getChangedSymbols(projectRoot, cache, options);

  let totalAddedSymbols = 0;
  let totalModifiedSymbols = 0;
  let totalRemovedSymbols = 0;
  const criticalChanges: DiffSummaryOutput['criticalChanges'] = [];

  for (const file of changed.changedFiles) {
    totalAddedSymbols += file.addedSymbols.length;
    totalModifiedSymbols += file.modifiedSymbols.length;
    totalRemovedSymbols += file.removedSymbols.length;

    // Check impact for modified or deleted files
    if (file.status !== 'added' && file.status !== 'untracked') {
      try {
        const impact = await getImpactAnalysis(projectRoot, cache, { path: file.file, maxDepth: 3 });
        if (impact.totalImpactedFiles > 0) {
          criticalChanges.push({
            file: file.file,
            impactedFiles: impact.totalImpactedFiles,
            impactedTests: impact.impactedTests,
            blastRadius: impact.blastRadius,
          });
        }
      } catch {
        // Skip impact on failure
      }
    }
  }

  // Generate compact summary
  criticalChanges.sort((a, b) => b.impactedFiles - a.impactedFiles);

  const lines: string[] = [
    `Git Branch: ${changed.branch}`,
    `Files Changed: ${changed.totalFilesChanged}`,
    `Symbols: +${totalAddedSymbols} added, ~${totalModifiedSymbols} modified, -${totalRemovedSymbols} removed`,
  ];

  if (criticalChanges.length > 0) {
    lines.push('\nTop Impacted Components:');
    for (const c of criticalChanges.slice(0, 5)) {
      lines.push(` - ${c.file}: ${c.impactedFiles} dependents (${c.blastRadius} blast radius, ${c.impactedTests.length} tests)`);
    }
  }

  return {
    branch: changed.branch,
    filesChanged: changed.totalFilesChanged,
    totalAddedSymbols,
    totalModifiedSymbols,
    totalRemovedSymbols,
    criticalChanges,
    summaryText: lines.join('\n'),
  };
}
