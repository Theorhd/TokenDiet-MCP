export type InstallTarget = 'claude' | 'antigravity' | 'opencode';
export type InstallMode = 'npm' | 'github' | 'local';

export interface InstallOptions {
  targets?: InstallTarget[];
  mode?: InstallMode;
  packageVersion?: string; // e.g. "latest", "0.2.1"
  localDistPath?: string;
  githubRepo?: string;
  homeDir?: string;
  cwd?: string;
  backup?: boolean;
  silent?: boolean;
  skillContent?: string;
}

export interface TargetStatus {
  target: InstallTarget;
  displayName: string;
  detected: boolean;
  mcpConfigured: boolean;
  skillInstalled: boolean;
  details: string;
}

export interface InstallResult {
  target: InstallTarget;
  displayName: string;
  success: boolean;
  message: string;
  filesUpdated: string[];
  error?: string;
}

export interface TargetAdapter {
  name: InstallTarget;
  displayName: string;
  isDetected(options: InstallOptions): Promise<boolean>;
  install(options: InstallOptions): Promise<InstallResult>;
  uninstall(options: InstallOptions): Promise<InstallResult>;
  getStatus(options: InstallOptions): Promise<TargetStatus>;
}
