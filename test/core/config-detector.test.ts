import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectAll, parsePackageJson } from '../../src/core/config-detector.js';
import * as fs from 'node:fs';

vi.mock('node:fs');

describe('config-detector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('detectAll', () => {
    it('detects frameworks from config files', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        return path.includes('next.config.js') || path.includes('tailwind.config.js');
      });

      const result = detectAll('/app');
      expect(result.frameworks).toContain('next.js');
      expect(result.frameworks).toContain('tailwindcss');
    });

    it('detects frameworks from package dependencies', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const deps = {
        'react': '^18.0.0',
        'express': '^4.17.1'
      };

      const result = detectAll('/app', deps);
      expect(result.frameworks).toContain('react');
      expect(result.frameworks).toContain('express');
    });

    it('detects build tools', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        return path.includes('vite.config.ts');
      });

      const result = detectAll('/app');
      expect(result.buildTools).toContain('vite');
    });

    it('detects test frameworks', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        return path.includes('vitest.config.ts');
      });

      const result = detectAll('/app');
      expect(result.testFrameworks).toContain('vitest');
    });

    it('detects package managers', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        return path.includes('pnpm-lock.yaml');
      });

      const result = detectAll('/app');
      expect(result.packageManager).toBe('pnpm');
    });

    it('defaults to npm if no lockfile found but package.json exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        return path.includes('package.json');
      });

      const result = detectAll('/app');
      expect(result.packageManager).toBe('npm');
    });
  });

  describe('parsePackageJson', () => {
    it('returns null if file does not exist or unreadable', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = parsePackageJson('/app');
      expect(result).toBeNull();
    });

    it('parses valid package.json', () => {
      const mockPkg = {
        name: 'my-app',
        type: 'module',
        dependencies: { react: '18' },
        devDependencies: { vitest: '1' },
        scripts: { test: 'vitest' }
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockPkg));

      const result = parsePackageJson('/app');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-app');
      expect(result?.type).toBe('module');
      expect(result?.dependencies).toBe(1);
      expect(result?.devDependencies).toBe(1);
      expect(result?.scripts).toContain('test');
    });
  });
});
