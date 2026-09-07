/**
 * The script that settles the theme before the first paint.
 *
 * The app defaults to dark and is read outdoors at eleven at night, so a white frame while
 * React boots is the one thing worth blocking render for. `<html>` ships with `class="dark"`
 * already, which covers the default and anyone with JavaScript off; this only has to undo it
 * for the two choices that are stored.
 *
 * It used to be `public/theme-init.js`, a file, because the policy was `script-src 'self'`
 * and an inline script needed an exception. Measured on a throttled phone, that file cost a
 * whole round trip on the critical path: the browser did not ask for the entry chunk until
 * this had come back, and first contentful paint went from 3120 ms inlined to 3760 ms as a
 * file. So it is inlined, and `script-src` carries the SHA-256 of exactly these bytes.
 *
 * A hash is not `'unsafe-inline'`. It admits one byte sequence and nothing else -- narrower
 * than `'self'`, which admits any script served from this origin -- and an attacker who can
 * inject a `<script>` cannot make it match. What a hash cannot survive is drift, so this
 * string is the only copy: `vite.config.ts` inlines it into the page and `security/csp.ts`
 * hashes the same export for both the meta tag and the header. There is no file to forget
 * to re-hash, and tools/test.ts re-derives the digest from the built HTML to prove it.
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
