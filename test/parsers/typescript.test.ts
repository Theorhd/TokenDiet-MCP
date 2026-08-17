import { describe, it, expect } from 'vitest';
import { TypeScriptParser } from '../../src/parsers/typescript.js';

describe('TypeScriptParser', () => {
  const parser = new TypeScriptParser();

  it('initializes correctly', () => {
    expect(parser.language).toBe('typescript');
    expect(parser.extensions).toContain('ts');
    expect(parser.tier).toBe('regex');
  });

  describe('parseFile', () => {
    it('extracts named imports', () => {
      const code = `import { foo, bar } from './utils';`;
      const result = parser.parseFile('test.ts', code);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].from).toBe('./utils');
      expect(result.imports[0].names).toEqual(['foo', 'bar']);
      expect(result.imports[0].isExternal).toBe(false);
    });

    it('extracts default imports', () => {
      const code = `import React from 'react';`;
      const result = parser.parseFile('test.ts', code);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].from).toBe('react');
      expect(result.imports[0].names).toContain('React');
      expect(result.imports[0].isExternal).toBe(true);
      expect(result.imports[0].isDefault).toBe(true);
    });

    it('extracts exported functions', () => {
      const code = `
        /** Does something */
        export function doSomething(a: string): void {
          console.log(a);
        }
      `;
      const result = parser.parseFile('test.ts', code);
      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].name).toBe('doSomething');
      expect(result.symbols[0].kind).toBe('function');
      expect(result.symbols[0].doc).toBe('Does something');
      expect(result.symbols[0].exported).toBe(true);
      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe('doSomething');
    });

    it('extracts exported classes', () => {
      const code = `
        export class MyClass extends BaseClass implements SomeInterface {
          constructor() {}
          public myMethod() {}
        }
      `;
      const result = parser.parseFile('test.ts', code);
      const cls = result.symbols.find(s => s.kind === 'class');
      expect(cls).toBeDefined();
      expect(cls?.name).toBe('MyClass');
      expect(cls?.exported).toBe(true);
      
      const method = result.symbols.find(s => s.kind === 'method');
      expect(method).toBeDefined();
      expect(method?.name).toBe('myMethod');
    });

    it('extracts exported const arrow functions', () => {
      const code = `
        export const myArrow = (b: number) => b * 2;
      `;
      const result = parser.parseFile('test.ts', code);
      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].name).toBe('myArrow');
      expect(result.symbols[0].kind).toBe('function');
      expect(result.symbols[0].exported).toBe(true);
    });

    it('extracts interfaces and types', () => {
      const code = `
        export interface User { id: string }
        export type Id = string;
      `;
      const result = parser.parseFile('test.ts', code);
      const iface = result.symbols.find(s => s.kind === 'interface');
      expect(iface?.name).toBe('User');
      
      const type = result.symbols.find(s => s.kind === 'type');
      expect(type?.name).toBe('Id');
    });

    it('deduplicates symbols', () => {
      const code = `
        export function foo() {}
        export function foo() {} // Overload
      `;
      const result = parser.parseFile('test.ts', code);
      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].name).toBe('foo');
    });

    it('guesses purpose correctly', () => {
      expect(parser.parseFile('vitest.config.ts', '').purpose).toBe('Configuration');
      expect(parser.parseFile('utils.ts', '').purpose).toBe('Utility functions');
      expect(parser.parseFile('index.ts', '').purpose).toBe('Module entry point');
      
      const code = `
        export function a(){} 
        export function b(){}
      `;
      expect(parser.parseFile('random.ts', code).purpose).toBe('2 exported symbols');
    });
  });
});
