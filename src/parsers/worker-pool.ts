import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { parseFile } from './index.js';
import type { FileOverview } from '../types/index.js';

export interface ParseTask {
  filePath: string;
  content: string;
}

export interface ParseResult {
  filePath: string;
  parsed: Omit<FileOverview, 'file' | 'lastModified'>;
}

// ─── Worker Thread Execution Logic ────────────────────────────────
if (!isMainThread && parentPort) {
  parentPort.on('message', (tasks: ParseTask[]) => {
    const results: ParseResult[] = [];
    for (const task of tasks) {
      try {
        const parsed = parseFile(task.filePath, task.content);
        results.push({ filePath: task.filePath, parsed });
      } catch {
        // Skip parsing errors
      }
    }
    parentPort!.postMessage(results);
  });
}

// ─── Main Thread Pool Manager ─────────────────────────────────────
export class WorkerPool {
  private static instance: WorkerPool | null = null;
  private maxWorkers: number;

  constructor(maxWorkers?: number) {
    const availableCpus = cpus().length;
    this.maxWorkers = maxWorkers ?? Math.max(1, Math.min(availableCpus - 1, 8));
  }

  static getInstance(): WorkerPool {
    if (!WorkerPool.instance) {
      WorkerPool.instance = new WorkerPool();
    }
    return WorkerPool.instance;
  }

  /**
   * Parse a batch of files in parallel using worker threads if batch size exceeds threshold,
   * otherwise parse synchronously on the main thread for zero overhead.
   */
  async parseBatch(tasks: ParseTask[], concurrencyThreshold = 40): Promise<ParseResult[]> {
    if (tasks.length === 0) return [];

    // For small batches or single worker, run synchronously on main thread
    if (tasks.length < concurrencyThreshold || this.maxWorkers <= 1 || process.env.TOKENDIET_DISABLE_WORKERS === '1') {
      const results: ParseResult[] = [];
      for (const t of tasks) {
        try {
          const parsed = parseFile(t.filePath, t.content);
          results.push({ filePath: t.filePath, parsed });
        } catch {
          // Skip
        }
      }
      return results;
    }

    const chunkSize = Math.ceil(tasks.length / this.maxWorkers);
    const chunks: ParseTask[][] = [];
    for (let i = 0; i < tasks.length; i += chunkSize) {
      chunks.push(tasks.slice(i, i + chunkSize));
    }

    try {
      const promises = chunks.map(chunk => this.runWorkerTask(chunk));
      const chunkResults = await Promise.all(promises);
      return chunkResults.flat();
    } catch {
      // Graceful fallback to synchronous parsing if worker creation fails
      const fallbackResults: ParseResult[] = [];
      for (const t of tasks) {
        try {
          const parsed = parseFile(t.filePath, t.content);
          fallbackResults.push({ filePath: t.filePath, parsed });
        } catch {
          // Skip
        }
      }
      return fallbackResults;
    }
  }

  private runWorkerTask(chunk: ParseTask[]): Promise<ParseResult[]> {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(new URL(import.meta.url), {
          execArgv: process.execArgv,
        });

        worker.on('message', (results: ParseResult[]) => {
          worker.terminate().catch(() => {});
          resolve(results);
        });

        worker.on('error', (err) => {
          worker.terminate().catch(() => {});
          reject(err);
        });

        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });

        worker.postMessage(chunk);
      } catch (err) {
        reject(err);
      }
    });
  }
}

export const workerPool = WorkerPool.getInstance();
