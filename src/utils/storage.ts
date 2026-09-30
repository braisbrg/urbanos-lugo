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

const open = (store: Store): Storage => (store === 'session' ? sessionStorage : localStorage);

export function readJson<T>(key: string, fallback: T, store: Store = 'local'): T {
  try {
    const raw = open(store).getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Writes `value`, or removes the key when it is null. */
export function writeJson(key: string, value: unknown, store: Store = 'local'): void {
  try {
    if (value === null) open(store).removeItem(key);
    else open(store).setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered between sessions; still applies in this one.
  }
}

export function readString(key: string, store: Store = 'local'): string | null {
  try {
    return open(store).getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string | null, store: Store = 'local'): void {
  try {
    if (value === null) open(store).removeItem(key);
    else open(store).setItem(key, value);
  } catch {
    // Same as above.
  }
}
