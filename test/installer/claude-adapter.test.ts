import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ClaudeAdapter } from '../../src/installer/adapters/claude.js';

describe('ClaudeAdapter', () => {
  let tmpHome: string;
  let adapter: ClaudeAdapter;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tokendiet-claude-test-'));
    adapter = new ClaudeAdapter();
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('detects claude if ~/.claude exists', async () => {
    expect(await adapter.isDetected({ homeDir: tmpHome })).toBe(false);

    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    expect(await adapter.isDetected({ homeDir: tmpHome })).toBe(true);
  });

  it('installs MCP config, skill and updates CLAUDE.md', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const claudeMdPath = path.join(tmpHome, '.claude', 'CLAUDE.md');
    await fs.writeFile(claudeMdPath, '# User Custom Rules\nSome rule here\n', 'utf-8');

    const result = await adapter.install({
      homeDir: tmpHome,
      mode: 'npm',
    });

    expect(result.success).toBe(true);

    // 1. Verify .mcp.json
    const mcpConfigPath = path.join(tmpHome, '.claude', '.mcp.json');
    const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf-8'));
    expect(mcpConfig.mcpServers.tokendiet).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'tokendiet-mcp@latest'],
    });

    // 2. Verify SKILL.md
    const skillPath = path.join(tmpHome, '.claude', 'skills', 'tokendiet-mcp', 'SKILL.md');
    const skillContent = await fs.readFile(skillPath, 'utf-8');
    expect(skillContent).toContain('# TokenDiet');

    // 3. Verify CLAUDE.md includes TokenDiet section while preserving existing content
    const updatedClaudeMd = await fs.readFile(claudeMdPath, 'utf-8');
    expect(updatedClaudeMd).toContain('# User Custom Rules');
    expect(updatedClaudeMd).toContain('<!-- TOKENDIET_START -->');
    expect(updatedClaudeMd).toContain('<!-- TOKENDIET_END -->');
  });

  it('uninstalls cleanly and removes TokenDiet section from CLAUDE.md', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const claudeMdPath = path.join(tmpHome, '.claude', 'CLAUDE.md');
    await fs.writeFile(claudeMdPath, '# User Custom Rules\n', 'utf-8');

    await adapter.install({ homeDir: tmpHome, mode: 'npm' });
    const uninstResult = await adapter.uninstall({ homeDir: tmpHome });
    expect(uninstResult.success).toBe(true);

    const mcpConfigPath = path.join(tmpHome, '.claude', '.mcp.json');
    const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf-8'));
    expect(mcpConfig.mcpServers?.tokendiet).toBeUndefined();

    const updatedClaudeMd = await fs.readFile(claudeMdPath, 'utf-8');
    expect(updatedClaudeMd).toContain('# User Custom Rules');
    expect(updatedClaudeMd).not.toContain('<!-- TOKENDIET_START -->');
  });
});
