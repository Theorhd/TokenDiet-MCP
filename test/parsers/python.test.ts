import { describe, it, expect } from 'vitest';
import { PythonParser } from '../../src/parsers/python.js';

describe('PythonParser', () => {
  const parser = new PythonParser();

  it('initializes correctly', () => {
    expect(parser.language).toBe('python');
    expect(parser.extensions).toContain('py');
  });

  describe('parseFile', () => {
    it('extracts regular imports', () => {
      const code = `import os\nimport sys, json`;
      const result = parser.parseFile('test.py', code);
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].from).toBe('builtin');
      expect(result.imports[0].names).toEqual(['os']);
      expect(result.imports[1].from).toBe('builtin');
      expect(result.imports[1].names).toEqual(['sys', 'json']);
    });

    it('extracts from ... imports', () => {
      const code = `from typing import List, Dict\nfrom .local import helper`;
      const result = parser.parseFile('test.py', code);
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].from).toBe('typing');
      expect(result.imports[0].names).toEqual(['List', 'Dict']);
      expect(result.imports[1].from).toBe('.local');
    });

    it('extracts classes and docstrings', () => {
      const code = `
"""Represents a user in the system."""
class User:
    def __init__(self):
        pass
      `;
      const result = parser.parseFile('test.py', code);
      const cls = result.symbols.find(s => s.kind === 'class');
      expect(cls).toBeDefined();
      expect(cls?.name).toBe('User');
      expect(cls?.doc).toBe('Represents a user in the system.');
    });

    it('extracts functions', () => {
      const code = `
def parse_data(data: str) -> dict:
    return {}
      `;
      const result = parser.parseFile('test.py', code);
      const fn = result.symbols.find(s => s.kind === 'function');
      expect(fn).toBeDefined();
      expect(fn?.name).toBe('parse_data');
    });
    
    it('extracts async functions', () => {
      const code = `
async def fetch_data():
    pass
      `;
      const result = parser.parseFile('test.py', code);
      const fn = result.symbols.find(s => s.kind === 'function');
      expect(fn?.name).toBe('fetch_data');
    });

    it('guesses purpose', () => {
      expect(parser.parseFile('test_foo.py', '').purpose).toBe('Test file');
      expect(parser.parseFile('models.py', '').purpose).toBe('Data models');
      expect(parser.parseFile('main.py', '').purpose).toBe('');
    });
  });
});
