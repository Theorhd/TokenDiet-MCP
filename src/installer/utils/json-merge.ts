import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface MergeJsonOptions {
  backup?: boolean;
}

/** Write file atomically using tmp file + rename */
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fs.writeFile(tmpPath, data, 'utf-8');
  await fs.rename(tmpPath, filePath);
}

/**
 * Safely reads a JSON file (or starts with {} if non-existent),
 * applies the updater function, creates parent directories if needed,
 * optionally creates a .bak file, and writes back formatted JSON atomically.
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
      try {
        currentJson = JSON.parse(raw);
        fileExisted = true;
      } catch (parseErr: any) {
        // Back up corrupted file
        try {
          await fs.copyFile(filePath, `${filePath}.corrupt.bak`);
        } catch {}
        throw new Error(`JSON file '${filePath}' is malformed/corrupted: ${parseErr.message}. A backup was saved to '${filePath}.corrupt.bak'.`);
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  if (fileExisted && options.backup) {
    try {
      await fs.copyFile(filePath, `${filePath}.bak`);
    } catch {}
  }

  const updatedJson = updater(currentJson);
  const formatted = JSON.stringify(updatedJson, null, 2) + '\n';
  await atomicWriteFile(filePath, formatted);

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
    await atomicWriteFile(filePath, formatted);
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
