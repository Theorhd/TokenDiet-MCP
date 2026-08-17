import { describe, it, expect } from 'vitest';
import { RustParser } from '../../src/parsers/rust.js';

describe('RustParser', () => {
  const parser = new RustParser();

  it('initializes correctly', () => {
    expect(parser.language).toBe('rust');
    expect(parser.extensions).toContain('rs');
  });

  describe('parseFile', () => {
    it('extracts imports (use)', () => {
      const code = `use std::collections::HashMap;\nuse crate::models::User;`;
      const result = parser.parseFile('main.rs', code);
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].from).toBe('std/collections/HashMap');
      expect(result.imports[0].names).toContain('std/collections/HashMap');
      expect(result.imports[1].from).toBe('crate/models/User');
    });

    it('extracts structs', () => {
      const code = `
/// A user struct
pub struct User { id: String }
      `;
      const result = parser.parseFile('models.rs', code);
      const strct = result.symbols.find(s => s.kind === 'struct');
      expect(strct).toBeDefined();
      expect(strct?.name).toBe('User');
      expect(strct?.doc).toBe('A user struct');
      expect(strct?.exported).toBe(true);
    });

    it('extracts functions', () => {
      const code = `
pub async fn fetch_data() -> Result<(), Error> {}
fn internal_helper() {}
      `;
      const result = parser.parseFile('api.rs', code);
      const fns = result.symbols.filter(s => s.kind === 'function');
      expect(fns).toHaveLength(2);
      expect(fns[0].name).toBe('fetch_data');
      expect(fns[0].exported).toBe(true);
      expect(fns[1].name).toBe('internal_helper');
      expect(fns[1].exported).toBe(false);
    });

    it('extracts traits and enums', () => {
      const code = `
pub trait Repository {}
enum Status { Active, Inactive }
      `;
      const result = parser.parseFile('db.rs', code);
      expect(result.symbols.find(s => s.kind === 'trait')?.name).toBe('Repository');
      expect(result.symbols.find(s => s.kind === 'enum')?.name).toBe('Status');
    });

    it('guesses purpose', () => {
      expect(parser.parseFile('main.rs', '').purpose).toBe('Application entry point');
      expect(parser.parseFile('lib.rs', '').purpose).toBe('Library root');
      expect(parser.parseFile('mod.rs', '').purpose).toBe('Module declarations');
    });
  });
});
