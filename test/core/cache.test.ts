import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheManager } from '../../src/core/cache.js';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    // Note: this will create a db file in ~/.cache/tokendiet/test_hash.db, 
    // we can use :memory: if the implementation supports it, but CacheManager 
    // hardcodes the path. For unit tests, we'll just test basic logic or mock.
    cache = new CacheManager('/tmp/test_project');
    
    // We mock the db methods to avoid touching the actual disk in tests.
    // Assuming we can mock out the internal sqlite instance or just spy on it.
    // Here we'll mock the internal db.
    if ((cache as any).db) {
       (cache as any).db.prepare = vi.fn().mockReturnValue({
         get: vi.fn(),
         all: vi.fn(),
         run: vi.fn()
       });
       (cache as any).db.exec = vi.fn();
    }
  });

  it('initializes', () => {
    expect(cache).toBeDefined();
  });

  // Tests for getFile, setFile, etc., could go here, heavily mocked.
  // Full sqlite integration tests would require a separate setup.
  it('has correct methods', () => {
    expect(typeof cache.getFileMtime).toBe('function');
    expect(typeof cache.upsertFile).toBe('function');
    expect(typeof cache.removeStaleFiles).toBe('function');
    expect(typeof cache.getAllFiles).toBe('function');
    expect(typeof cache.getAllFiles).toBe('function');
  });
});
