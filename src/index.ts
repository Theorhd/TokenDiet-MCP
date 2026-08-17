#!/usr/bin/env node

import { startServer } from './server.js';
import { runInstallerCli } from './installer/index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const firstArg = args[0]?.toLowerCase();

  // Handle installer commands
  if (
    firstArg === 'install' ||
    firstArg === 'uninstall' ||
    firstArg === 'status' ||
    firstArg === 'setup' ||
    firstArg === 'remove' ||
    args.includes('--install')
  ) {
    try {
      await runInstallerCli(args);
      process.exit(0);
    } catch (err: any) {
      console.error('Installer failed:', err.message);
      process.exit(1);
    }
  }

  for (const arg of args) {
    if (arg === '--version' || arg === '-v') {
      process.stdout.write('tokendiet v0.2.2\n');
      process.exit(0);
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`TokenDiet — Token-efficient project architecture MCP server

Usage:
  tokendiet                      Start the MCP server on stdio
  npx tokendiet-mcp install      Install MCP server & SKILL.md into your tools
  npx tokendiet-mcp status       Check installation status across tools
  npx tokendiet-mcp uninstall    Uninstall TokenDiet from your tools

Installation Options:
  --all                          Configure all targets (Claude Code, Antigravity, OpenCode)
  --claude                       Configure Claude Code only
  --antigravity                  Configure Google Antigravity (IDE & CLI) only
  --opencode                     Configure OpenCode only
  --local                        Configure for local project development
  --github                       Configure to run directly from GitHub via npx

Environment Variables:
  TOKENDIET_CACHE_DIR            Cache directory (default: ~/Library/Caches/tokendiet)
  TOKENDIET_MAX_TOKENS           Max tokens per response (default: 3000)
  TOKENDIET_MAX_FILES            Max files to index (default: 20000)
  TOKENDIET_DISABLE_TREE_SITTER  Set to '1' to use regex-only parsing
`);
      process.exit(0);
    }
  }

  try {
    await startServer();
  } catch (error) {
    console.error('Failed to start TokenDiet:', error);
    process.exit(1);
  }
}

main();
