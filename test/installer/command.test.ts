import { describe, it, expect } from 'vitest';
import { getMcpServerConfig } from '../../src/installer/utils/command.js';

describe('getMcpServerConfig', () => {
  it('generates npm npx command by default', () => {
    const config = getMcpServerConfig({ mode: 'npm' });
    expect(config).toEqual({
      command: 'npx',
      args: ['-y', 'tokendiet-mcp'],
    });
  });

  it('generates github npx command when mode is github', () => {
    const config = getMcpServerConfig({ mode: 'github', githubRepo: 'theorhd/TokenDiet' });
    expect(config).toEqual({
      command: 'npx',
      args: ['-y', 'github:theorhd/TokenDiet'],
    });
  });

  it('generates local node command with dist/index.js when mode is local', () => {
    const config = getMcpServerConfig({ mode: 'local', localDistPath: '/my/path/dist/index.js' });
    expect(config).toEqual({
      command: 'node',
      args: ['/my/path/dist/index.js'],
    });
  });
});
