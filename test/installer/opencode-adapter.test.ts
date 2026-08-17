import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { OpenCodeAdapter } from '../../src/installer/adapters/opencode.js';

describe('OpenCodeAdapter', () => {
  let tmpHome: string;
  let adapter: OpenCodeAdapter;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tokendiet-opencode-test-'));
    adapter = new OpenCodeAdapter();
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('detects opencode if ~/.config/opencode exists', async () => {
    expect(await adapter.isDetected({ homeDir: tmpHome })).toBe(false);

    await fs.mkdir(path.join(tmpHome, '.config', 'opencode'), { recursive: true });
    expect(await adapter.isDetected({ homeDir: tmpHome })).toBe(true);
  });

  it('installs MCP config, rules and AGENTS.md', async () => {
    await fs.mkdir(path.join(tmpHome, '.config', 'opencode'), { recursive: true });

    const result = await adapter.install({
      homeDir: tmpHome,
      mode: 'npm',
    });

    expect(result.success).toBe(true);

    // 1. Verify config.json
    const configPath = path.join(tmpHome, '.config', 'opencode', 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(config.mcpServers.tokendiet).toEqual({
      command: 'npx',
      args: ['-y', 'tokendiet-mcp'],
    });

    // 2. Verify rules/tokendiet.md
    const rulePath = path.join(tmpHome, '.config', 'opencode', 'rules', 'tokendiet.md');
    const ruleContent = await fs.readFile(rulePath, 'utf-8');
    expect(ruleContent).toContain('# TokenDiet');
  });

  it('uninstalls cleanly', async () => {
    await fs.mkdir(path.join(tmpHome, '.config', 'opencode'), { recursive: true });
    await adapter.install({ homeDir: tmpHome, mode: 'npm' });

    const uninstResult = await adapter.uninstall({ homeDir: tmpHome });
    expect(uninstResult.success).toBe(true);

    const configPath = path.join(tmpHome, '.config', 'opencode', 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(config.mcpServers?.tokendiet).toBeUndefined();

    const rulePath = path.join(tmpHome, '.config', 'opencode', 'rules', 'tokendiet.md');
    const ruleExists = await fs.stat(rulePath).then(() => true).catch(() => false);
    expect(ruleExists).toBe(false);
  });
});
