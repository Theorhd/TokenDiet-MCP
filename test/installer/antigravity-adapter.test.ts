import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AntigravityAdapter } from '../../src/installer/adapters/antigravity.js';

describe('AntigravityAdapter', () => {
  let tmpHome: string;
  let adapter: AntigravityAdapter;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tokendiet-agy-test-'));
    adapter = new AntigravityAdapter();
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('detects antigravity if ~/.gemini exists', async () => {
    expect(await adapter.isDetected({ homeDir: tmpHome })).toBe(false);

    await fs.mkdir(path.join(tmpHome, '.gemini'), { recursive: true });
    expect(await adapter.isDetected({ homeDir: tmpHome })).toBe(true);
  });

  it('installs MCP config, permissions, skill and rule files', async () => {
    await fs.mkdir(path.join(tmpHome, '.gemini', 'config'), { recursive: true });

    const result = await adapter.install({
      homeDir: tmpHome,
      mode: 'npm',
    });

    expect(result.success).toBe(true);

    // 1. Verify mcp_config.json
    const mcpConfigPath = path.join(tmpHome, '.gemini', 'config', 'mcp_config.json');
    const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf-8'));
    expect(mcpConfig.mcpServers.tokendiet).toEqual({
      command: 'npx',
      args: ['-y', 'tokendiet-mcp@latest'],
    });

    // 2. Verify settings.json permissions
    const settingsPath = path.join(tmpHome, '.gemini', 'antigravity-cli', 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(settings.permissions.allow).toContain('mcp(tokendiet/get_global_project)');

    // 3. Verify SKILL.md
    const skillPath = path.join(tmpHome, '.gemini', 'config', 'skills', 'tokendiet-mcp', 'SKILL.md');
    const skillContent = await fs.readFile(skillPath, 'utf-8');
    expect(skillContent).toContain('# TokenDiet');

    // 4. Verify rule file
    const rulePath = path.join(tmpHome, '.gemini', 'config', 'rules', 'tokendiet-mcp.md');
    const ruleContent = await fs.readFile(rulePath, 'utf-8');
    expect(ruleContent).toContain('# TokenDiet');
  });

  it('uninstalls cleanly', async () => {
    await adapter.install({ homeDir: tmpHome, mode: 'npm' });

    const uninstResult = await adapter.uninstall({ homeDir: tmpHome });
    expect(uninstResult.success).toBe(true);

    const mcpConfigPath = path.join(tmpHome, '.gemini', 'config', 'mcp_config.json');
    const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf-8'));
    expect(mcpConfig.mcpServers?.tokendiet).toBeUndefined();

    const skillPath = path.join(tmpHome, '.gemini', 'config', 'skills', 'tokendiet-mcp', 'SKILL.md');
    const skillExists = await fs.stat(skillPath).then(() => true).catch(() => false);
    expect(skillExists).toBe(false);
  });
});
