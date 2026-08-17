const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const skillPath = path.join(rootDir, 'SKILL.md');
const outputPath = path.join(rootDir, 'src', 'installer', 'embedded-skill.ts');

if (!fs.existsSync(skillPath)) {
  console.error('SKILL.md not found at', skillPath);
  process.exit(1);
}

const skillContent = fs.readFileSync(skillPath, 'utf-8');

const tsContent = `// Auto-generated from SKILL.md — do not edit directly
import * as fs from 'node:fs';
import * as path from 'node:path';

export const EMBEDDED_SKILL_MD: string = ${JSON.stringify(skillContent)};

/**
 * Returns the latest SKILL.md content, checking local files first if in development,
 * otherwise falling back to the embedded string.
 */
export function getSkillContent(): string {
  try {
    // Check if SKILL.md exists in current working dir or parent
    const candidates = [
      path.resolve(process.cwd(), 'SKILL.md'),
      path.resolve(__dirname, '../../SKILL.md'),
      path.resolve(__dirname, '../SKILL.md'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return fs.readFileSync(cand, 'utf-8');
      }
    }
  } catch {}
  return EMBEDDED_SKILL_MD;
}
`;

fs.writeFileSync(outputPath, tsContent, 'utf-8');
console.log('Successfully generated src/installer/embedded-skill.ts from SKILL.md');
