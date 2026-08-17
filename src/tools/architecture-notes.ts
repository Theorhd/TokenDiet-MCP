import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRoot } from '../core/paths.js';
import { readFileSafe, truncate } from '../core/utils.js';
import type { ArchitectureNotes, ArchNote } from '../types/index.js';
import type { CacheManager } from '../core/cache.js';

export interface ArchitectureNotesOptions {
  maxWords?: number;
}

export async function getArchitectureNotes(
  root: string | undefined,
  cache: CacheManager,
  options: ArchitectureNotesOptions = {},
): Promise<ArchitectureNotes> {
  const projectRoot = resolveRoot(root);
  const { maxWords = 800 } = options;

  const archSources: string[] = [];
  const knownPaths = [
    'ARCHITECTURE.md', 'ARCHITECTURE.txt',
    'docs/architecture.md', 'docs/architecture/',
    'docs/adr/', 'design/', 'docs/design/',
    'CONTRIBUTING.md',
  ];

  for (const path of knownPaths) {
    const fullPath = join(projectRoot, path);
    if (existsSync(fullPath)) {
      if (fullPath.endsWith('/')) {
        try {
          const files = readdirSync(fullPath);
          for (const file of files) {
            if (file.endsWith('.md') || file.endsWith('.txt')) {
              archSources.push(join(path, file));
            }
          }
        } catch { /* skip */ }
      } else {
        archSources.push(path);
      }
    }
  }

  // If no architecture docs found, try README
  if (archSources.length === 0) {
    const readmePath = join(projectRoot, 'README.md');
    if (existsSync(readmePath)) {
      archSources.push('README.md');
    }
  }

  const sources: ArchNote[] = [];
  const headings: string[] = [];
  const keyConcepts: string[] = [];

  for (const source of archSources) {
    const fullPath = join(projectRoot, source);
    const content = readFileSafe(fullPath);
    if (!content) continue;

    // Extract headings
    const hMatch = content.match(/^#{1,3}\s+(.+)$/gm);
    if (hMatch) {
      for (const h of hMatch) {
        const heading = h.replace(/^#+\s+/, '').trim();
        if (!headings.includes(heading)) headings.push(heading);
      }
    }

    // Count words
    const words = content.split(/\s+/).length;

    // Find key concepts (capitalized phrases, architecture patterns)
    const conceptPatterns = [
      /\bMVC\b/g, /\bREST\b/g, /\bGraphQL\b/g, /\bCQRS\b/g,
      /\bEvent.?Sourcing\b/g, /\bMicroservices?\b/g, /\bMonolith(?:ic)?\b/g,
      /\bHexagonal\b/g, /\bClean\s+Architecture\b/g, /\bDDD\b/g,
      /\bEvent.?Driven\b/g, /\bDomain.?Driven\b/g, /\bServerless\b/g,
      /\bKubernetes\b/g, /\bDocker\b/g, /\bCI\/CD\b/g,
      /\bTDD\b/g, /\bBDD\b/g, /\bAgile\b/g,
      /\bPostgreSQL\b/g, /\bMySQL\b/g, /\bMongoDB\b/g, /\bRedis\b/g,
      /\bReact\b/g, /\bVue\b/g, /\bAngular\b/g, /\bSvelte\b/g,
      /\bNode\.js\b/g, /\bDeno\b/g, /\bPython\b/g, /\bRust\b/g, /\bGo\b/g,
    ];

    for (const pattern of conceptPatterns) {
      if (pattern.test(content)) {
        const concept = pattern.source.replace(/\\[bB]/g, '').replace(/\\s\+/g, ' ');
        if (!keyConcepts.includes(concept)) keyConcepts.push(concept);
      }
    }

    // Generate excerpt
    let excerpt = content;
    if (words > maxWords) {
      // Take first paragraphs up to maxWords
      const paragraphs = content.split('\n\n');
      let wordCount = 0;
      const selected: string[] = [];
      for (const para of paragraphs) {
        const w = para.split(/\s+/).length;
        if (wordCount + w > maxWords) {
          selected.push(para.slice(0, (maxWords - wordCount) * 6) + '…');
          break;
        }
        selected.push(para);
        wordCount += w;
      }
      excerpt = selected.join('\n\n');
    }

    sources.push({
      path: source,
      words: Math.min(words, maxWords),
      excerpt: truncate(excerpt, maxWords * 6),
    });
  }

  return {
    found: archSources,
    headings: headings.slice(0, 50),
    sources,
    keyConcepts: keyConcepts.slice(0, 20),
  };
}
