import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { InstallOptions, InstallResult, TargetAdapter, TargetStatus } from '../types.js';
import { getMcpServerConfig } from '../utils/command.js';
import { mergeJsonFile, removeJsonKey } from '../utils/json-merge.js';
import { getSkillContent } from '../embedded-skill.js';

export class OpenCodeAdapter implements TargetAdapter {
  readonly name = 'opencode';
  readonly displayName = 'OpenCode';

  private getPaths(options: InstallOptions) {
    const home = options.homeDir || os.homedir();
    return {
      configDir: path.join(home, '.config', 'opencode'),
      configFile: path.join(home, '.config', 'opencode', 'config.json'),
      rulesDir: path.join(home, '.config', 'opencode', 'rules'),
      ruleFile: path.join(home, '.config', 'opencode', 'rules', 'tokendiet.md'),
      agentsFile: path.join(home, '.config', 'opencode', 'AGENTS.md'),
    };
  }

  async isDetected(options: InstallOptions): Promise<boolean> {
    const paths = this.getPaths(options);
    try {
      await fs.access(paths.configDir);
      return true;
    } catch {
      return false;
    }
  }

  async install(options: InstallOptions): Promise<InstallResult> {
    const paths = this.getPaths(options);
    const filesUpdated: string[] = [];

    try {
      const serverConfig = getMcpServerConfig(options);
      const skillContent = options.skillContent || getSkillContent();

      // 1. Update config.json
      await mergeJsonFile(
        paths.configFile,
        (current) => ({
          ...current,
          mcpServers: {
            ...(current.mcpServers || {}),
            tokendiet: serverConfig,
          },
        }),
        { backup: options.backup ?? true }
      );
      filesUpdated.push(paths.configFile);

      // 2. Write rule in ~/.config/opencode/rules/tokendiet.md
      await fs.mkdir(paths.rulesDir, { recursive: true });
      await fs.writeFile(paths.ruleFile, skillContent, 'utf-8');
      filesUpdated.push(paths.ruleFile);

      return {
        target: this.name,
        displayName: this.displayName,
        success: true,
        message: 'Successfully installed TokenDiet MCP and rules into OpenCode',
        filesUpdated,
      };
    } catch (err: any) {
      return {
        target: this.name,
        displayName: this.displayName,
        success: false,
        message: `Failed to install into OpenCode: ${err.message}`,
        filesUpdated,
        error: err.message,
      };
    }
  }

  async uninstall(options: InstallOptions): Promise<InstallResult> {
    const paths = this.getPaths(options);
    const filesUpdated: string[] = [];

    try {
      // 1. Remove from config.json
      await removeJsonKey(paths.configFile, (current) => {
        if (current.mcpServers) {
          delete current.mcpServers.tokendiet;
        }
      });
      filesUpdated.push(paths.configFile);

      // 2. Remove rule file
      try {
        await fs.rm(paths.ruleFile, { force: true });
        filesUpdated.push(paths.ruleFile);
      } catch {}

      return {
        target: this.name,
        displayName: this.displayName,
        success: true,
        message: 'Successfully uninstalled TokenDiet from OpenCode',
        filesUpdated,
      };
    } catch (err: any) {
      return {
        target: this.name,
        displayName: this.displayName,
        success: false,
        message: `Failed to uninstall from OpenCode: ${err.message}`,
        filesUpdated,
        error: err.message,
      };
    }
  }

  async getStatus(options: InstallOptions): Promise<TargetStatus> {
    const paths = this.getPaths(options);
    const detected = await this.isDetected(options);

    let mcpConfigured = false;
    try {
      const raw = await fs.readFile(paths.configFile, 'utf-8');
      const json = JSON.parse(raw);
      mcpConfigured = !!json?.mcpServers?.tokendiet;
    } catch {}

    let skillInstalled = false;
    try {
      await fs.access(paths.ruleFile);
      skillInstalled = true;
    } catch {}

    return {
      target: this.name,
      displayName: this.displayName,
      detected,
      mcpConfigured,
      skillInstalled,
      details: mcpConfigured ? 'MCP configured' : 'Not configured',
    };
  }
}
