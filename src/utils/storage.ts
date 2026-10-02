/**
 * `localStorage` / `sessionStorage`, guarded.
 *
 * Safari in private browsing throws on read, a full quota throws on write, and a corrupt
 * entry throws on parse. None of those is worth an error path: the value is a convenience,
 * so it falls back and the app carries on.
 *
 * The store is named, not passed, because reaching it is itself what throws: with site data
 * blocked (Chrome's "don't allow sites to save data", some webviews) reading
 * `window.localStorage` raises SecurityError. As a default parameter it was read before the
 * `try`, and the first call, in App's first render, left the page blank.
 */
type Store = 'local' | 'session';

/**
 * Every key this app keeps in the browser, and the store that keeps it. PRIVACY.md has a
 * row for each under that store, and tools/test.ts holds the two to each other. A key that
 * is not here does not compile, and the store is read from here rather than passed: the
 * trip lives in sessionStorage, and dies with the tab, because this table says so.
 */
export const STORAGE_KEYS = {
  urbanos_lugo_fav_stops: 'local',
  urbanos_lugo_fav_lines: 'local',
  'urbanos-lugo-recent-stops': 'local',
  'urbanos-lugo-recent-routes': 'local',
  'urbanos-lugo-lang': 'local',
  'urbanos-lugo-theme': 'local',
  'urbanos-lugo-trip': 'session',
  'urbanos-lugo-reloaded-for': 'session',
} as const satisfies Record<string, Store>;

export type StorageKey = keyof typeof STORAGE_KEYS;

const open = (key: StorageKey): Storage => (STORAGE_KEYS[key] === 'session' ? sessionStorage : localStorage);

export function readJson<T>(key: StorageKey, fallback: T): T {
  try {
    const raw = open(key).getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Writes `value`, or removes the key when it is null. */
export function writeJson(key: StorageKey, value: unknown): void {
  try {
    if (value === null) open(key).removeItem(key);
    else open(key).setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered between sessions; still applies in this one.
  }
}

export function readString(key: StorageKey): string | null {
  try {
    return open(key).getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: StorageKey, value: string | null): void {
  try {
    if (value === null) open(key).removeItem(key);
    else open(key).setItem(key, value);
  } catch {
    // Same as above.
  }
}
