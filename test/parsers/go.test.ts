import { describe, it, expect } from 'vitest';
import { GoParser } from '../../src/parsers/go.js';

describe('GoParser', () => {
  const parser = new GoParser();

  it('initializes correctly', () => {
    expect(parser.language).toBe('go');
    expect(parser.extensions).toContain('go');
  });

  describe('parseFile', () => {
    it('extracts simple imports', () => {
      const code = `import "fmt"\nimport "net/http"`;
      const result = parser.parseFile('main.go', code);
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].from).toBe('fmt');
      expect(result.imports[1].from).toBe('net/http');
    });

    it('extracts multi-line imports', () => {
      const code = `
import (
    "fmt"
    myhttp "net/http"
)
      `;
      const result = parser.parseFile('main.go', code);
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].from).toBe('fmt');
      expect(result.imports[1].from).toBe('net/http');
      expect(result.imports[1].names).toContain('*');
    });

    it('extracts types (structs, interfaces)', () => {
      const code = `
// User represents a user
type User struct {}
type Repository interface {}
      `;
      const result = parser.parseFile('models.go', code);
      const strct = result.symbols.find(s => s.kind === 'struct');
      expect(strct?.name).toBe('User');
      expect(strct?.exported).toBe(true); // Uppercase means exported in Go
      expect(strct?.doc).toBe('represents a user');
      
      const iface = result.symbols.find(s => s.kind === 'interface');
      expect(iface?.name).toBe('Repository');
    });

    it('extracts functions', () => {
      const code = `
func ParseData() error {}
func internalHelper() {}
      `;
      const result = parser.parseFile('api.go', code);
      const fns = result.symbols.filter(s => s.kind === 'function');
      expect(fns).toHaveLength(2);
      expect(fns[0].name).toBe('ParseData');
      expect(fns[0].exported).toBe(true);
      expect(fns[1].name).toBe('internalHelper');
      expect(fns[1].exported).toBe(false);
    });

    it('extracts methods', () => {
      const code = `
func (u *User) GetName() string {}
      `;
      const result = parser.parseFile('models.go', code);
      const method = result.symbols.find(s => s.kind === 'method');
      expect(method?.name).toBe('User.GetName');
      expect(method?.signature).toContain('(u User)');
    });

    it('guesses purpose', () => {
      expect(parser.parseFile('main.go', '').purpose).toBe('Application entry point');
      expect(parser.parseFile('utils_test.go', '').purpose).toBe('Test file');
    });
  });
});
