import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { InstallOptions, InstallResult, TargetAdapter, TargetStatus } from '../types.js';
import { getMcpServerConfig } from '../utils/command.js';
import { mergeJsonFile, removeJsonKey } from '../utils/json-merge.js';
import { getSkillContent } from '../embedded-skill.js';

const TOKENDIET_TOOLS = [
  'get_global_project',
  'get_project_summary',
  'get_directory_tree',
  'get_config_digest',
  'get_entry_points',
  'get_architecture_notes',
  'get_module_graph',
  'find_dead_code',
  'get_file_overview',
  'get_symbol_body',
  'get_type_definitions',
  'get_symbol_references',
  'get_changed_symbols',
  'get_folded_file',
  'search_symbols',
  'refresh_index',
];

export class AntigravityAdapter implements TargetAdapter {
  readonly name = 'antigravity';
  readonly displayName = 'Google Antigravity (IDE & CLI)';

  private getPaths(options: InstallOptions) {
    const home = options.homeDir || os.homedir();
    return {
      geminiDir: path.join(home, '.gemini'),
      mcpConfig: path.join(home, '.gemini', 'config', 'mcp_config.json'),
      settings: path.join(home, '.gemini', 'antigravity-cli', 'settings.json'),
      skillDir: path.join(home, '.gemini', 'config', 'skills', 'tokendiet-mcp'),
      skillFile: path.join(home, '.gemini', 'config', 'skills', 'tokendiet-mcp', 'SKILL.md'),
      ruleFile: path.join(home, '.gemini', 'config', 'rules', 'tokendiet-mcp.md'),
    };
  }

  async isDetected(options: InstallOptions): Promise<boolean> {
    const paths = this.getPaths(options);
    try {
      await fs.access(paths.geminiDir);
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

      // 1. Update mcp_config.json
      await mergeJsonFile(
        paths.mcpConfig,
        (current) => ({
          ...current,
          mcpServers: {
            ...(current.mcpServers || {}),
            tokendiet: serverConfig,
          },
        }),
        { backup: options.backup ?? true }
      );
      filesUpdated.push(paths.mcpConfig);

      // 2. Update settings.json to auto-grant MCP permissions
      const allowPermissions = TOKENDIET_TOOLS.map((t) => `mcp(tokendiet/${t})`);
      await mergeJsonFile(
        paths.settings,
        (current) => {
          const existingAllow: string[] = current?.permissions?.allow || [];
          const mergedAllow = Array.from(new Set([...existingAllow, ...allowPermissions]));
          return {
            ...current,
            permissions: {
              ...(current.permissions || {}),
              allow: mergedAllow,
            },
          };
        },
        { backup: options.backup ?? true }
      );
      filesUpdated.push(paths.settings);

      // 3. Write SKILL.md
      await fs.mkdir(paths.skillDir, { recursive: true });
      await fs.writeFile(paths.skillFile, skillContent, 'utf-8');
      filesUpdated.push(paths.skillFile);

      // 4. Write Rule file
      await fs.mkdir(path.dirname(paths.ruleFile), { recursive: true });
      await fs.writeFile(paths.ruleFile, skillContent, 'utf-8');
      filesUpdated.push(paths.ruleFile);

      return {
        target: this.name,
        displayName: this.displayName,
        success: true,
        message: 'Successfully installed TokenDiet MCP, rules, and skill into Antigravity',
        filesUpdated,
      };
    } catch (err: any) {
      return {
        target: this.name,
        displayName: this.displayName,
        success: false,
        message: `Failed to install into Antigravity: ${err.message}`,
        filesUpdated,
        error: err.message,
      };
    }
  }

  async uninstall(options: InstallOptions): Promise<InstallResult> {
    const paths = this.getPaths(options);
    const filesUpdated: string[] = [];

    try {
      // 1. Remove from mcp_config.json
      await removeJsonKey(paths.mcpConfig, (current) => {
        if (current.mcpServers) {
          delete current.mcpServers.tokendiet;
        }
      });
      filesUpdated.push(paths.mcpConfig);

      // 2. Remove permissions from settings.json
      await removeJsonKey(paths.settings, (current) => {
        if (Array.isArray(current?.permissions?.allow)) {
          current.permissions.allow = current.permissions.allow.filter(
            (p: string) => !p.startsWith('mcp(tokendiet/')
          );
        }
      });
      filesUpdated.push(paths.settings);

      // 3. Remove skill and rule files
      try {
        await fs.rm(paths.skillDir, { recursive: true, force: true });
        filesUpdated.push(paths.skillDir);
      } catch {}

      try {
        await fs.rm(paths.ruleFile, { force: true });
        filesUpdated.push(paths.ruleFile);
      } catch {}

      return {
        target: this.name,
        displayName: this.displayName,
        success: true,
        message: 'Successfully uninstalled TokenDiet from Antigravity',
        filesUpdated,
      };
    } catch (err: any) {
      return {
        target: this.name,
        displayName: this.displayName,
        success: false,
        message: `Failed to uninstall from Antigravity: ${err.message}`,
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
      const raw = await fs.readFile(paths.mcpConfig, 'utf-8');
      const json = JSON.parse(raw);
      mcpConfigured = !!json?.mcpServers?.tokendiet;
    } catch {}

    let skillInstalled = false;
    try {
      await fs.access(paths.skillFile);
      skillInstalled = true;
    } catch {}

    return {
      target: this.name,
      displayName: this.displayName,
      detected,
      mcpConfigured,
      skillInstalled,
      details: mcpConfigured && skillInstalled ? 'Installed & Configured' : 'Not fully configured',
    };
  }
}
