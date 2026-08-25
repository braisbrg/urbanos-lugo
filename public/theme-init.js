/**
 * Settles the theme before the first paint.
 *
 * The app defaults to dark and is read outdoors at eleven at night, so a white frame
 * while React boots is the one thing worth blocking render for. `<html>` ships with
 * `class="dark"` already, which covers the default and anyone with JavaScript off; this
 * only has to undo it for the two choices that are stored.
 *
 * A separate file rather than an inline script because the Content Security Policy is
 * `script-src 'self'`, and a policy with an exception for one inline script is a policy
 * with an exception.
 */
(function () {
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
})();
