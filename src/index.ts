#!/usr/bin/env node

import { startServer } from './server.js';

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);

  for (const arg of args) {
    if (arg === '--version' || arg === '-v') {
      process.stdout.write('tokendiet v1.0.0\n');
      process.exit(0);
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`TokenDiet — Token-efficient project architecture MCP server

Usage:
  tokendiet                    Start the MCP server on stdio
  npx tokendiet                Run without installing globally

Environment:
  TOKENDIET_CACHE_DIR          Cache directory (default: ~/Library/Caches/tokendiet)
  TOKENDIET_MAX_TOKENS         Max tokens per response (default: 3000)
  TOKENDIET_MAX_FILES          Max files to index (default: 20000)
  TOKENDIET_DISABLE_TREE_SITTER  Set to '1' to use regex-only parsing

Claude Code Setup:
  claude mcp add tokendiet -- tokendiet
  # or for a specific project:
  claude mcp add tokendiet -- tokendiet --root /path/to/project
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
