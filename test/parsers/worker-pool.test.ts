import { describe, it, expect } from 'vitest';
import { workerPool } from '../../src/parsers/worker-pool.js';

describe('WorkerPool Parallel Parsing', () => {
  it('parses empty tasks batch cleanly', async () => {
    const results = await workerPool.parseBatch([]);
    expect(results).toEqual([]);
  });

  it('parses small batches synchronously without errors', async () => {
    const tasks = [
      {
        filePath: 'src/math.ts',
        content: 'export function add(a: number, b: number): number { return a + b; }',
      },
      {
        filePath: 'src/utils.ts',
        content: 'export const PI = 3.14159; export function square(x: number) { return x * x; }',
      },
    ];

    const results = await workerPool.parseBatch(tasks, 10);
    expect(results.length).toBe(2);
    expect(results[0]?.parsed.precision).toBe('full');
    expect(results[0]?.parsed.symbols.some(s => s.name === 'add')).toBe(true);
    expect(results[1]?.parsed.symbols.some(s => s.name === 'PI' || s.name === 'square')).toBe(true);
  });

  it('parses larger batches with threshold triggering batch execution', async () => {
    const tasks = [];
    for (let i = 0; i < 15; i++) {
      tasks.push({
        filePath: `src/mod_${i}.ts`,
        content: `export function func_${i}() { const local_${i} = ${i}; return local_${i}; }`,
      });
    }

    const results = await workerPool.parseBatch(tasks, 5);
    expect(results.length).toBe(15);
    expect(results.every(r => r.parsed.precision === 'full')).toBe(true);
    expect(results.every(r => r.parsed.symbols.some(s => s.name.startsWith('func_')))).toBe(true);
    expect(results.every(r => !r.parsed.symbols.some(s => s.name.startsWith('local_')))).toBe(true);
  });
});
