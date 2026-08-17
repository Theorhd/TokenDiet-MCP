import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mergeJsonFile, removeJsonKey } from '../../src/installer/utils/json-merge.js';

describe('json-merge', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokendiet-json-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates new file if it does not exist with directories', async () => {
    const targetFile = path.join(tmpDir, 'nested', 'dir', 'config.json');
    await mergeJsonFile(targetFile, (current) => ({
      ...current,
      mcpServers: { tokendiet: { command: 'npx' } },
    }));

    const content = JSON.parse(await fs.readFile(targetFile, 'utf-8'));
    expect(content).toEqual({
      mcpServers: { tokendiet: { command: 'npx' } },
    });
  });

  it('safely merges with existing JSON without deleting other keys and creates .bak', async () => {
    const targetFile = path.join(tmpDir, 'config.json');
    await fs.writeFile(
      targetFile,
      JSON.stringify({ existingServer: { command: 'other' }, theme: 'dark' }, null, 2),
      'utf-8'
    );

    await mergeJsonFile(
      targetFile,
      (current) => ({
        ...current,
        mcpServers: {
          ...(current.mcpServers || {}),
          tokendiet: { command: 'npx', args: ['-y', 'tokendiet-mcp'] },
        },
      }),
      { backup: true }
    );

    const updated = JSON.parse(await fs.readFile(targetFile, 'utf-8'));
    expect(updated.existingServer).toEqual({ command: 'other' });
    expect(updated.theme).toBe('dark');
    expect(updated.mcpServers.tokendiet).toEqual({
      command: 'npx',
      args: ['-y', 'tokendiet-mcp'],
    });

    const bakFile = `${targetFile}.bak`;
    const bakExists = await fs.stat(bakFile).then(() => true).catch(() => false);
    expect(bakExists).toBe(true);
  });

  it('removes keys cleanly with removeJsonKey', async () => {
    const targetFile = path.join(tmpDir, 'config.json');
    await fs.writeFile(
      targetFile,
      JSON.stringify(
        {
          mcpServers: {
            other: { command: 'other' },
            tokendiet: { command: 'npx' },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    await removeJsonKey(targetFile, (obj) => {
      if (obj.mcpServers) {
        delete obj.mcpServers.tokendiet;
      }
    });

    const updated = JSON.parse(await fs.readFile(targetFile, 'utf-8'));
    expect(updated.mcpServers.other).toBeDefined();
    expect(updated.mcpServers.tokendiet).toBeUndefined();
  });
});
