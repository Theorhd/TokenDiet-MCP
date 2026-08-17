import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInstall, runUninstall, getOverallStatus } from '../../src/installer/index.js';

describe('installer orchestrator', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tokendiet-orch-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('installs to specified targets', async () => {
    const results = await runInstall({
      targets: ['claude', 'antigravity'],
      homeDir: tmpHome,
      mode: 'npm',
      silent: true,
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);

    const statuses = await getOverallStatus({ homeDir: tmpHome });
    const claudeStatus = statuses.find((s) => s.target === 'claude');
    const agyStatus = statuses.find((s) => s.target === 'antigravity');
    const opencodeStatus = statuses.find((s) => s.target === 'opencode');

    expect(claudeStatus?.mcpConfigured).toBe(true);
    expect(agyStatus?.mcpConfigured).toBe(true);
    expect(opencodeStatus?.mcpConfigured).toBe(false);
  });

  it('installs to all targets when target includes all', async () => {
    const results = await runInstall({
      targets: ['claude', 'antigravity', 'opencode'],
      homeDir: tmpHome,
      mode: 'npm',
      silent: true,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);

    const statuses = await getOverallStatus({ homeDir: tmpHome });
    expect(statuses.every((s) => s.mcpConfigured)).toBe(true);
  });

  it('uninstalls from all targets', async () => {
    await runInstall({
      targets: ['claude', 'antigravity', 'opencode'],
      homeDir: tmpHome,
      mode: 'npm',
      silent: true,
    });

    const uninstResults = await runUninstall({
      targets: ['claude', 'antigravity', 'opencode'],
      homeDir: tmpHome,
      silent: true,
    });

    expect(uninstResults).toHaveLength(3);
    expect(uninstResults.every((r) => r.success)).toBe(true);

    const statuses = await getOverallStatus({ homeDir: tmpHome });
    expect(statuses.every((s) => !s.mcpConfigured)).toBe(true);
  });
});
