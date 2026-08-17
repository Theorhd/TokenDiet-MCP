import * as path from 'node:path';
import type { InstallOptions } from '../types.js';

export interface ServerCommandConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function getMcpServerConfig(options: InstallOptions = {}): ServerCommandConfig {
  const mode = options.mode || 'npm';

  if (mode === 'local') {
    const distPath =
      options.localDistPath ||
      path.resolve(options.cwd || process.cwd(), 'dist', 'index.js');
    return {
      command: 'node',
      args: [distPath],
    };
  }

  if (mode === 'github') {
    const repo = options.githubRepo || 'theorhd/TokenDiet';
    return {
      command: 'npx',
      args: ['-y', `github:${repo}`],
    };
  }

  // default 'npm'
  return {
    command: 'npx',
    args: ['-y', 'tokendiet-mcp'],
  };
}
