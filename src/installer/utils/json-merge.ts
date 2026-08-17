import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface MergeJsonOptions {
  backup?: boolean;
}

/**
 * Safely reads a JSON file (or starts with {} if non-existent),
 * applies the updater function, creates parent directories if needed,
 * optionally creates a .bak file, and writes back formatted JSON.
 */
export async function mergeJsonFile(
  filePath: string,
  updater: (currentJson: Record<string, any>) => Record<string, any>,
  options: MergeJsonOptions = {}
): Promise<Record<string, any>> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  let currentJson: Record<string, any> = {};
  let fileExisted = false;

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    if (raw.trim().length > 0) {
      currentJson = JSON.parse(raw);
      fileExisted = true;
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      // If corrupted JSON or read error, check if we should backup before throwing or starting fresh
      try {
        await fs.copyFile(filePath, `${filePath}.corrupt.bak`);
      } catch {}
      currentJson = {};
    }
  }

  if (fileExisted && options.backup) {
    try {
      await fs.copyFile(filePath, `${filePath}.bak`);
    } catch {}
  }

  const updatedJson = updater(currentJson);
  const formatted = JSON.stringify(updatedJson, null, 2) + '\n';
  await fs.writeFile(filePath, formatted, 'utf-8');

  return updatedJson;
}

/**
 * Safely removes keys from a JSON file, creating a backup if requested.
 */
export async function removeJsonKey(
  filePath: string,
  mutator: (currentJson: Record<string, any>) => void,
  options: MergeJsonOptions = {}
): Promise<boolean> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const currentJson = JSON.parse(raw);

    if (options.backup) {
      await fs.copyFile(filePath, `${filePath}.bak`);
    }

    mutator(currentJson);

    const formatted = JSON.stringify(currentJson, null, 2) + '\n';
    await fs.writeFile(filePath, formatted, 'utf-8');
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
