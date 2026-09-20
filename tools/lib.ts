/**
 * What every tool used to carry its own copy of: where the repository is, JSON in and
 * out, the two statistics the reports print, the one-line-per-kind failure collector.
 * Node only — nothing in src/ imports this.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, whatever directory the script was started from. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** A path under the root. */
export const at = (...parts: string[]): string => join(ROOT, ...parts);

export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Pretty-printed with a trailing newline, the directory created on the way. */
export function writeJson(path: string, value: unknown, pretty = true): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n');
}

/** The cached JSON at `path`, or the result of `compute`, written there for next time. */
export async function cached<T>(path: string, compute: () => Promise<T>): Promise<T> {
  if (existsSync(path)) return readJson<T>(path);
  const value = await compute();
  writeJson(path, value, false);
  return value;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The p-th percentile of a list (nearest rank), 0 for an empty one. */
export const percentile = (xs: number[], p: number): number =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))] : 0;
export const median = (xs: number[]): number => percentile(xs, 50);
export const mean = (xs: number[]): number => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0);

/** Wall-clock milliseconds a synchronous call took. */
export function timed(run: () => unknown): number {
  const started = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** Accents off, lower case, one space between words. */
export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * One line per kind of problem, however many times it happens, and the first detail
 * seen. `report()` prints `clean` when there were none, else every kind, and sets the
 * exit code.
 */
export function violations(clean: string, noun: string) {
  const seen = new Map<string, string>();
  return {
    fail(kind: string, detail: string) {
      if (!seen.has(kind)) seen.set(kind, detail);
    },
    report(): void {
      if (!seen.size) return console.log(`${clean}\n`);
      console.log(`\n${seen.size} kind(s) of ${noun}:\n`);
      for (const [kind, detail] of seen) console.log(`  ${kind}\n      first seen: ${detail}`);
      console.log('');
      process.exitCode = 1;
    },
  };
}
