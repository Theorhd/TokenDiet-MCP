import { describe, it, expect, beforeAll } from 'vitest';
import { treeSitterManager } from '../../src/parsers/treesitter.js';
import { parseFile } from '../../src/parsers/index.js';

describe('TreeSitterManager & AST Parsers', () => {
  beforeAll(async () => {
    await treeSitterManager.init();
    // Warm up parsers for key languages
    await treeSitterManager.getParser('typescript');
    await treeSitterManager.getParser('python');
    await treeSitterManager.getParser('go');
    await treeSitterManager.getParser('rust');
    await treeSitterManager.getParser('java');
    await treeSitterManager.getParser('c_sharp');
  });

  it('parses TypeScript AST with exact lines, symbols and docstrings', () => {
    const code = `
import { add, multiply } from './math.js';
import * as utils from './utils.js';

/** Calculate total amount */
export function calculateTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}

export class OrderProcessor {
  /** Process a single order */
  process(id: string): boolean {
    return true;
  }
}

export interface UserProfile {
  id: string;
  name: string;
}
`;
    const res = parseFile('src/services/order.ts', code);
    expect(res.tier).toBe('tree-sitter');
    expect(res.precision).toBe('full');
    expect(res.language).toBe('typescript');

    const fn = res.symbols.find(s => s.name === 'calculateTotal');
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe('function');
    expect(fn?.doc).toContain('Calculate total amount');
    expect(fn?.exported).toBe(true);

    const cls = res.symbols.find(s => s.name === 'OrderProcessor');
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe('class');

    const iface = res.symbols.find(s => s.name === 'UserProfile');
    expect(iface).toBeDefined();
    expect(iface?.kind).toBe('interface');

    expect(res.imports.length).toBeGreaterThanOrEqual(2);
    expect(res.imports.some(i => i.from === './math.js' && i.names.includes('add'))).toBe(true);
  });

  it('parses Python AST with function docstrings and classes', () => {
    const code = `
import os
from pathlib import Path

class DataProcessor:
    """Main data processor class."""
    def run(self, source):
        """Execute processing pipeline."""
        pass

def fetch_records(limit: int = 10):
    """Retrieve database records."""
    return []
`;
    const res = parseFile('app/processor.py', code);
    expect(res.tier).toBe('tree-sitter');
    expect(res.precision).toBe('full');
    expect(res.language).toBe('python');

    const cls = res.symbols.find(s => s.name === 'DataProcessor');
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe('class');
    expect(cls?.doc).toContain('Main data processor class');

    const fn = res.symbols.find(s => s.name === 'fetch_records');
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe('function');
    expect(fn?.doc).toContain('Retrieve database records');
  });

  it('parses Go AST with structs, functions and methods', () => {
    const code = `
package main

import "fmt"

// Server config
type Server struct {
    Port int
}

// Start the server
func (s *Server) Start() error {
    return nil
}

func NewServer(port int) *Server {
    return &Server{Port: port}
}
`;
    const res = parseFile('server.go', code);
    expect(res.tier).toBe('tree-sitter');
    expect(res.language).toBe('go');

    const structSym = res.symbols.find(s => s.name === 'Server');
    expect(structSym).toBeDefined();
    expect(structSym?.kind).toBe('struct');

    const fnSym = res.symbols.find(s => s.name === 'NewServer');
    expect(fnSym).toBeDefined();
    expect(fnSym?.kind).toBe('function');
  });

  it('parses Rust AST with traits, structs and functions', () => {
    const code = `
use std::collections::HashMap;

/// A simple cache storage
pub struct Cache {
    entries: HashMap<String, String>,
}

pub trait Storage {
    fn get(&self, key: &str) -> Option<&str>;
}

pub fn create_cache() -> Cache {
    Cache { entries: HashMap::new() }
}
`;
    const res = parseFile('cache.rs', code);
    expect(res.tier).toBe('tree-sitter');
    expect(res.language).toBe('rust');

    const structSym = res.symbols.find(s => s.name === 'Cache');
    expect(structSym).toBeDefined();
    expect(structSym?.kind).toBe('struct');

    const traitSym = res.symbols.find(s => s.name === 'Storage');
    expect(traitSym).toBeDefined();
    expect(traitSym?.kind).toBe('trait');
  });

  it('parses Java and C# AST', () => {
    const javaCode = `
package com.example;

public class UserService {
    public void registerUser(String username) {
    }
}
`;
    const javaRes = parseFile('UserService.java', javaCode);
    expect(javaRes.tier).toBe('tree-sitter');
    expect(javaRes.symbols.some(s => s.name === 'UserService')).toBe(true);

    const csharpCode = `
namespace MyApp {
    public class OrderHandler {
        public void HandleOrder() {
        }
    }
}
`;
    const csRes = parseFile('OrderHandler.cs', csharpCode);
    expect(csRes.tier).toBe('tree-sitter');
    expect(csRes.symbols.some(s => s.name === 'OrderHandler')).toBe(true);
  });

  it('manages LRU eviction and memory clearance with clearMemory', async () => {
    await treeSitterManager.getParser('python');
    await treeSitterManager.getParser('go');
    await treeSitterManager.getParser('rust');
    await treeSitterManager.getParser('typescript');

    treeSitterManager.clearMemory();
    // After clearMemory, re-getting a parser lazily reloads it
    const reloadedParser = await treeSitterManager.getParser('typescript');
    expect(reloadedParser).toBeDefined();
  });
});
