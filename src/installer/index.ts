import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type {
  InstallMode,
  InstallOptions,
  InstallResult,
  InstallTarget,
  TargetAdapter,
  TargetStatus,
} from './types.js';
import { AntigravityAdapter } from './adapters/antigravity.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenCodeAdapter } from './adapters/opencode.js';

export * from './types.js';

export function getAdapters(): TargetAdapter[] {
  return [
    new ClaudeAdapter(),
    new AntigravityAdapter(),
    new OpenCodeAdapter(),
  ];
}

export async function runInstall(options: InstallOptions = {}): Promise<InstallResult[]> {
  const adapters = getAdapters();
  const results: InstallResult[] = [];

  let targetsToInstall = options.targets;

  if (!targetsToInstall || targetsToInstall.length === 0) {
    // If no targets explicitly specified, auto-detect available tools
    const detectedTargets: InstallTarget[] = [];
    for (const adapter of adapters) {
      if (await adapter.isDetected(options)) {
        detectedTargets.push(adapter.name);
      }
    }
    // If none detected, fallback to all adapters
    targetsToInstall = detectedTargets.length > 0 ? detectedTargets : adapters.map((a) => a.name);
  }

  for (const adapter of adapters) {
    if (targetsToInstall.includes(adapter.name)) {
      const res = await adapter.install(options);
      results.push(res);
    }
  }

  return results;
}

export async function runUninstall(options: InstallOptions = {}): Promise<InstallResult[]> {
  const adapters = getAdapters();
  const results: InstallResult[] = [];
  const targets = options.targets || adapters.map((a) => a.name);

  for (const adapter of adapters) {
    if (targets.includes(adapter.name)) {
      const res = await adapter.uninstall(options);
      results.push(res);
    }
  }

  return results;
}

export async function getOverallStatus(options: InstallOptions = {}): Promise<TargetStatus[]> {
  const adapters = getAdapters();
  const statuses: TargetStatus[] = [];

  for (const adapter of adapters) {
    const status = await adapter.getStatus(options);
    statuses.push(status);
  }

  return statuses;
}

export async function runInstallerCli(
  args: string[],
  overrideOptions: Partial<InstallOptions> = {}
): Promise<void> {
  const command = args[0] || 'install';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const flags = new Set(args.slice(1));
  const options: InstallOptions = {
    backup: !flags.has('--no-backup'),
    silent: flags.has('--silent'),
    ...overrideOptions,
  };

  if (flags.has('--local')) {
    options.mode = 'local';
  } else if (flags.has('--github')) {
    options.mode = 'github';
  } else if (!options.mode) {
    options.mode = 'npm';
  }

  const specifiedTargets: InstallTarget[] = [];
  if (flags.has('--claude')) specifiedTargets.push('claude');
  if (flags.has('--antigravity') || flags.has('--gemini')) specifiedTargets.push('antigravity');
  if (flags.has('--opencode')) specifiedTargets.push('opencode');

  if (flags.has('--all')) {
    options.targets = ['claude', 'antigravity', 'opencode'];
  } else if (specifiedTargets.length > 0) {
    options.targets = specifiedTargets;
  }

  if (command === 'status') {
    if (!options.silent) {
      console.log('\n🔍 Checking TokenDiet installation status...\n');
    }
    const statuses = await getOverallStatus(options);
    if (!options.silent) {
      for (const st of statuses) {
        const icon = st.mcpConfigured ? '✅' : st.detected ? '⚠️ ' : '⚪';
        console.log(
          `${icon} ${st.displayName.padEnd(32)} Detected: ${st.detected ? 'Yes' : 'No '} | MCP: ${
            st.mcpConfigured ? 'Configured' : 'Not configured'
          } | Skill: ${st.skillInstalled ? 'Installed' : 'No'}`
        );
      }
      console.log('');
    }
    return;
  }

  if (command === 'uninstall' || command === 'remove') {
    if (!options.silent) {
      console.log('\n🗑️  Uninstalling TokenDiet MCP & Skills...\n');
    }
    const results = await runUninstall(options);
    if (!options.silent) {
      for (const res of results) {
        if (res.success) {
          console.log(`✅ [${res.displayName}] ${res.message}`);
        } else {
          console.error(`❌ [${res.displayName}] ${res.message}`);
        }
      }
      console.log('\nDone!\n');
    }
    return;
  }

  if (command === 'install' || command === 'setup' || command === '--install') {
    // If no flags were provided and stdout is a TTY, prompt the user
    if (!options.targets && process.stdin.isTTY && !options.silent) {
      const selected = await promptInteractiveSelection();
      if (selected.length === 0) {
        console.log('Installation cancelled.');
        return;
      }
      options.targets = selected;
    }

    if (!options.silent) {
      console.log(`\n🚀 Installing TokenDiet (Mode: ${options.mode || 'npm'})...\n`);
    }
    const results = await runInstall(options);

    let allSuccess = true;
    for (const res of results) {
      if (res.success) {
        if (!options.silent) {
          console.log(`✅ [${res.displayName}] ${res.message}`);
          if (res.filesUpdated.length > 0) {
            for (const f of res.filesUpdated) {
              console.log(`   └─ Updated: ${f}`);
            }
          }
        }
      } else {
        allSuccess = false;
        if (!options.silent) {
          console.error(`❌ [${res.displayName}] ${res.message}`);
        }
      }
    }

    if (allSuccess && !options.silent) {
      console.log('\n✨ Installation completed successfully!');
      console.log('💡 Restart your AI assistant / IDE to start exploring code with 70-90% token savings.\n');
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
}

async function promptInteractiveSelection(): Promise<InstallTarget[]> {
  const rl = readline.createInterface({ input, output });
  console.log('Select target environments to configure:');
  console.log('  1) All (Claude Code, Antigravity IDE/CLI, OpenCode) [Default]');
  console.log('  2) Claude Code only');
  console.log('  3) Antigravity (Google IDE & CLI) only');
  console.log('  4) OpenCode only');

  const answer = (await rl.question('\nChoice [1-4]: ')).trim();
  rl.close();

  switch (answer) {
    case '2':
      return ['claude'];
    case '3':
      return ['antigravity'];
    case '4':
      return ['opencode'];
    case '1':
    case '':
    default:
      return ['claude', 'antigravity', 'opencode'];
  }
}

function printHelp(): void {
  console.log(`
TokenDiet Automated Installer

Usage:
  npx tokendiet-mcp install [options]      Install TokenDiet MCP & Skills
  npx tokendiet-mcp uninstall [options]    Uninstall TokenDiet MCP & Skills
  npx tokendiet-mcp status                 Check installation status

Targets:
  --all                     Configure all supported targets (Claude, Antigravity, OpenCode)
  --claude                  Configure Claude Code
  --antigravity             Configure Antigravity IDE & CLI
  --opencode                Configure OpenCode

Installation Modes:
  --npm                     Use published npm package (npx -y tokendiet-mcp) [Default]
  --github                  Use GitHub repository directly (npx -y github:theorhd/TokenDiet)
  --local                   Use local build path (node /path/to/dist/index.js)

Options:
  --no-backup               Skip creating .bak backup files
  --silent                  Suppress output logs
  --help, -h                Show this help message
`);
}
