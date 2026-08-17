import { describe, it, expect } from 'vitest';
import { getMcpServerConfig } from '../../src/installer/utils/command.js';

describe('getMcpServerConfig', () => {
  it('generates npm npx command with @latest by default', () => {
    const config = getMcpServerConfig({ mode: 'npm' });
    expect(config).toEqual({
      command: 'npx',
      args: ['-y', 'tokendiet-mcp@latest'],
    });
  });

  it('generates npm npx command with custom requested version', () => {
    const config = getMcpServerConfig({ mode: 'npm', packageVersion: '0.2.1' });
    expect(config).toEqual({
      command: 'npx',
      args: ['-y', 'tokendiet-mcp@0.2.1'],
    });
  });

  it('generates github npx command when mode is github', () => {
    const config = getMcpServerConfig({ mode: 'github' });
    expect(config).toEqual({
      command: 'npx',
      args: ['-y', 'github:Theorhd/TokenDiet-MCP'],
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
