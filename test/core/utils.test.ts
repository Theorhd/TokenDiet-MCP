import { describe, it, expect } from 'vitest';
import {
  truncate,
  firstDocSentence,
  estimateTokens,
  enforceTokenBudget,
  extractPackageName,
  formatBytes,
  resolveImportPath
} from '../../src/core/utils.js';
import { resolve } from 'node:path';

describe('utils', () => {
  describe('truncate', () => {
    it('returns the same string if shorter than max length', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates the string and appends suffix if longer than max length', () => {
      expect(truncate('hello world', 8)).toBe('hello w…');
      expect(truncate('hello world', 8, '...')).toBe('hello...');
    });
  });

  describe('firstDocSentence', () => {
    it('extracts the first sentence from a JSDoc comment', () => {
      const doc = `/**
       * This is the first sentence. This is the second.
       */`;
      expect(firstDocSentence(doc)).toBe('This is the first sentence.');
    });

    it('extracts the first sentence from a Python docstring', () => {
      const doc = `"""
This is a python docstring. With multiple sentences.
      """`;
      expect(firstDocSentence(doc)).toBe('This is a python docstring.');
    });

    it('handles single line comments', () => {
      const doc = `// Just a quick comment.`;
      expect(firstDocSentence(doc)).toBe('// Just a quick comment.');
    });
  });

  describe('estimateTokens', () => {
    it('estimates roughly 1 token per 3.5 characters', () => {
      expect(estimateTokens('hello')).toBe(Math.ceil(5 / 3.5));
      expect(estimateTokens('hello world')).toBe(Math.ceil(11 / 3.5));
    });
  });

  describe('enforceTokenBudget', () => {
    it('returns data unchanged if within budget', () => {
      const data = { a: 1 };
      const res = enforceTokenBudget(data, 1000, 'a');
      expect(res).toEqual(data);
      expect(res._truncated).toBeUndefined();
    });

    it('adds _truncated marker if exceeding budget', () => {
      const data = { a: 'very long string to exceed the tiny budget of 2 tokens' };
      const res = enforceTokenBudget(data, 2, 'a');
      expect(res._truncated).toBeDefined();
      expect(res.a).toBe(data.a); // It doesn't actually delete data, just adds the marker in current implementation
    });
  });

  describe('extractPackageName', () => {
    it('extracts un-scoped package name', () => {
      expect(extractPackageName('react/jsx-runtime')).toBe('react');
      expect(extractPackageName('lodash')).toBe('lodash');
    });

    it('extracts scoped package name', () => {
      expect(extractPackageName('@types/node/fs')).toBe('@types/node');
      expect(extractPackageName('@modelcontextprotocol/sdk')).toBe('@modelcontextprotocol/sdk');
    });
  });

  describe('formatBytes', () => {
    it('formats bytes < 1024 as B', () => {
      expect(formatBytes(500)).toBe('500B');
    });

    it('formats bytes < 1MB as KB', () => {
      expect(formatBytes(1536)).toBe('1.5KB');
    });

    it('formats bytes >= 1MB as MB', () => {
      expect(formatBytes(1572864)).toBe('1.5MB');
    });
  });

  describe('resolveImportPath', () => {
    it('returns empty for external imports', () => {
      expect(resolveImportPath('/app/src/index.ts', 'express')).toEqual([]);
      expect(resolveImportPath('/app/src/index.ts', '@modelcontextprotocol/sdk')).toEqual([]);
    });

    it('resolves TypeScript ESM .js relative import to .ts source file', () => {
      const serverFile = resolve(process.cwd(), 'src/server.ts');
      const candidates = resolveImportPath(serverFile, './core/cache.js');
      expect(candidates.some(c => c.endsWith('src/core/cache.ts'))).toBe(true);
    });

    it('resolves directory import with /index.ts', () => {
      const serverFile = resolve(process.cwd(), 'src/server.ts');
      const candidates = resolveImportPath(serverFile, './types');
      expect(candidates.some(c => c.endsWith('src/types/index.ts'))).toBe(true);
    });
  });
});
