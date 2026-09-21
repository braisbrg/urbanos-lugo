/**
 * The script that settles the theme before the first paint: the app defaults to dark and
 * is read outdoors at night, so a white frame while React boots is the one thing worth
 * blocking render for. `<html>` ships with `class="dark"`; this only undoes it for the
 * two stored choices.
 *
 * Inlined rather than a file because the file cost a round trip on the critical path,
 * and `script-src` carries the SHA-256 of exactly these bytes. A hash admits one byte
 * sequence, narrower than 'self', and cannot survive drift, so this string is the only
 * copy: vite.config.ts inlines it, security/csp.ts hashes it, and tools/test.ts
 * re-derives the digest from the built HTML.
 */
export const THEME_INIT_SOURCE = `(function () {
  try {
    var stored = localStorage.getItem('urbanos-lugo-theme');
    if (stored === 'light') {
      document.documentElement.classList.remove('dark');
    } else if (stored === 'auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {
    // Private browsing throws instead of returning null. The default already applies.
  }
})();`;

/** The key `useTheme` writes, named once so the two cannot drift apart. */
export const THEME_STORAGE_KEY = 'urbanos-lugo-theme';
