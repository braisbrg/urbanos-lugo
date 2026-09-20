/**
 * `localStorage` / `sessionStorage`, guarded.
 *
 * Safari in private browsing throws on read, a full quota throws on write, and a corrupt
 * entry throws on parse. None of those is worth an error path: the value is a convenience,
 * so it falls back and the app carries on.
 */

export function readJson<T>(key: string, fallback: T, store: Storage = localStorage): T {
  try {
    const raw = store.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Writes `value`, or removes the key when it is null. */
export function writeJson(key: string, value: unknown, store: Storage = localStorage): void {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered between sessions; still applies in this one.
  }
}

export function readString(key: string, store: Storage = localStorage): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string | null, store: Storage = localStorage): void {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Same as above.
  }
}
