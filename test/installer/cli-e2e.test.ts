import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInstallerCli } from '../../src/installer/index.js';

describe('CLI installer e2e', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tokendiet-cli-e2e-'));
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('runs install --all and configures all 3 environments', async () => {
    // Pre-create some tool directories
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tmpHome, '.gemini'), { recursive: true });
    await fs.mkdir(path.join(tmpHome, '.config', 'opencode'), { recursive: true });

    await runInstallerCli(['install', '--all', '--npm', '--silent'], { homeDir: tmpHome });

    // Check Claude
    const claudeMcp = JSON.parse(await fs.readFile(path.join(tmpHome, '.claude', '.mcp.json'), 'utf-8'));
    expect(claudeMcp.mcpServers.tokendiet.args).toContain('tokendiet-mcp');

    // Check Antigravity
    const agyMcp = JSON.parse(await fs.readFile(path.join(tmpHome, '.gemini', 'config', 'mcp_config.json'), 'utf-8'));
    expect(agyMcp.mcpServers.tokendiet.args).toContain('tokendiet-mcp');

    // Check OpenCode
    const opencodeMcp = JSON.parse(await fs.readFile(path.join(tmpHome, '.config', 'opencode', 'config.json'), 'utf-8'));
    expect(opencodeMcp.mcpServers.tokendiet.args).toContain('tokendiet-mcp');
  });

  it('runs uninstall --all cleanly', async () => {
    await runInstallerCli(['install', '--all', '--silent'], { homeDir: tmpHome });
    await runInstallerCli(['uninstall', '--all', '--silent'], { homeDir: tmpHome });

    const claudeMcp = JSON.parse(await fs.readFile(path.join(tmpHome, '.claude', '.mcp.json'), 'utf-8'));
    expect(claudeMcp.mcpServers?.tokendiet).toBeUndefined();

    const agyMcp = JSON.parse(await fs.readFile(path.join(tmpHome, '.gemini', 'config', 'mcp_config.json'), 'utf-8'));
    expect(agyMcp.mcpServers?.tokendiet).toBeUndefined();
  });
});
