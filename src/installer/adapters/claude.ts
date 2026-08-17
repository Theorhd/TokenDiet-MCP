import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { InstallOptions, InstallResult, TargetAdapter, TargetStatus } from '../types.js';
import { getMcpServerConfig } from '../utils/command.js';
import { mergeJsonFile, removeJsonKey } from '../utils/json-merge.js';
import { getSkillContent } from '../embedded-skill.js';

const TOKENDIET_SECTION_START = '<!-- TOKENDIET_START -->';
const TOKENDIET_SECTION_END = '<!-- TOKENDIET_END -->';

export class ClaudeAdapter implements TargetAdapter {
  readonly name = 'claude';
  readonly displayName = 'Claude Code';

  private getPaths(options: InstallOptions) {
    const home = options.homeDir || os.homedir();
    return {
      claudeDir: path.join(home, '.claude'),
      mcpConfig: path.join(home, '.claude', '.mcp.json'),
      claudeJson: path.join(home, '.claude.json'),
      claudeMd: path.join(home, '.claude', 'CLAUDE.md'),
      skillDir: path.join(home, '.claude', 'skills', 'tokendiet-mcp'),
      skillFile: path.join(home, '.claude', 'skills', 'tokendiet-mcp', 'SKILL.md'),
    };
  }

  async isDetected(options: InstallOptions): Promise<boolean> {
    const paths = this.getPaths(options);
    try {
      await fs.access(paths.claudeDir);
      return true;
    } catch {
      try {
        await fs.access(paths.claudeJson);
        return true;
      } catch {
        return false;
      }
    }
  }

  async install(options: InstallOptions): Promise<InstallResult> {
    const paths = this.getPaths(options);
    const filesUpdated: string[] = [];

    try {
      const serverConfig = getMcpServerConfig(options);
      const skillContent = options.skillContent || getSkillContent();

      // 1. Update ~/.claude/.mcp.json
      await mergeJsonFile(
        paths.mcpConfig,
        (current) => ({
          ...current,
          mcpServers: {
            ...(current.mcpServers || {}),
            tokendiet: {
              type: 'stdio',
              ...serverConfig,
            },
          },
        }),
        { backup: options.backup ?? true }
      );
      filesUpdated.push(paths.mcpConfig);

      // 2. Also update ~/.claude.json if it exists
      try {
        await fs.access(paths.claudeJson);
        await mergeJsonFile(
          paths.claudeJson,
          (current) => {
            // Clean up any legacy per-project tokendiet configurations to prevent scope conflicts
            for (const key of Object.keys(current)) {
              if (current[key] && typeof current[key] === 'object' && current[key].mcpServers?.tokendiet) {
                delete current[key].mcpServers.tokendiet;
              }
            }
            return {
              ...current,
              mcpServers: {
                ...(current.mcpServers || {}),
                tokendiet: {
                  type: 'stdio',
                  ...serverConfig,
                },
              },
            };
          },
          { backup: options.backup ?? true }
        );
        filesUpdated.push(paths.claudeJson);
      } catch {}

      // 3. Write SKILL.md in ~/.claude/skills/tokendiet-mcp/
      await fs.mkdir(paths.skillDir, { recursive: true });
      await fs.writeFile(paths.skillFile, skillContent, 'utf-8');
      filesUpdated.push(paths.skillFile);

      // 4. Update CLAUDE.md with TokenDiet rule block
      await this.updateClaudeMd(paths.claudeMd, skillContent, options.backup ?? true);
      filesUpdated.push(paths.claudeMd);

      return {
        target: this.name,
        displayName: this.displayName,
        success: true,
        message: 'Successfully installed TokenDiet MCP, rules, and skill into Claude Code',
        filesUpdated,
      };
    } catch (err: any) {
      return {
        target: this.name,
        displayName: this.displayName,
        success: false,
        message: `Failed to install into Claude Code: ${err.message}`,
        filesUpdated,
        error: err.message,
      };
    }
  }

  private async updateClaudeMd(claudeMdPath: string, skillContent: string, backup: boolean) {
    let currentContent = '';
    try {
      currentContent = await fs.readFile(claudeMdPath, 'utf-8');
      if (backup) {
        await fs.writeFile(`${claudeMdPath}.bak`, currentContent, 'utf-8');
      }
    } catch {
      await fs.mkdir(path.dirname(claudeMdPath), { recursive: true });
    }

    const section = `${TOKENDIET_SECTION_START}\n${skillContent}\n${TOKENDIET_SECTION_END}`;

    if (currentContent.includes(TOKENDIET_SECTION_START)) {
      const regex = new RegExp(`${TOKENDIET_SECTION_START}[\\s\\S]*?${TOKENDIET_SECTION_END}`, 'g');
      currentContent = currentContent.replace(regex, section);
    } else {
      currentContent = currentContent.trim() ? `${currentContent.trim()}\n\n${section}\n` : `${section}\n`;
    }

    await fs.writeFile(claudeMdPath, currentContent, 'utf-8');
  }

  async uninstall(options: InstallOptions): Promise<InstallResult> {
    const paths = this.getPaths(options);
    const filesUpdated: string[] = [];

    try {
      // 1. Remove from .mcp.json
      await removeJsonKey(paths.mcpConfig, (current) => {
        if (current.mcpServers) {
          delete current.mcpServers.tokendiet;
        }
      });
      filesUpdated.push(paths.mcpConfig);

      // 2. Remove from claude.json if present
      try {
        await removeJsonKey(paths.claudeJson, (current) => {
          if (current.mcpServers) {
            delete current.mcpServers.tokendiet;
          }
          for (const key of Object.keys(current)) {
            if (current[key] && typeof current[key] === 'object' && current[key].mcpServers?.tokendiet) {
              delete current[key].mcpServers.tokendiet;
            }
          }
        });
        filesUpdated.push(paths.claudeJson);
      } catch {}

      // 3. Remove skill file
      try {
        await fs.rm(paths.skillDir, { recursive: true, force: true });
        filesUpdated.push(paths.skillDir);
      } catch {}

      // 4. Remove section from CLAUDE.md
      try {
        const content = await fs.readFile(paths.claudeMd, 'utf-8');
        if (content.includes(TOKENDIET_SECTION_START)) {
          const regex = new RegExp(`\\n*${TOKENDIET_SECTION_START}[\\s\\S]*?${TOKENDIET_SECTION_END}\\n*`, 'g');
          const cleaned = content.replace(regex, '\n').trim() + '\n';
          await fs.writeFile(paths.claudeMd, cleaned, 'utf-8');
          filesUpdated.push(paths.claudeMd);
        }
      } catch {}

      return {
        target: this.name,
        displayName: this.displayName,
        success: true,
        message: 'Successfully uninstalled TokenDiet from Claude Code',
        filesUpdated,
      };
    } catch (err: any) {
      return {
        target: this.name,
        displayName: this.displayName,
        success: false,
        message: `Failed to uninstall from Claude Code: ${err.message}`,
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
      details: mcpConfigured ? 'MCP configured' : 'Not configured',
    };
  }
}
