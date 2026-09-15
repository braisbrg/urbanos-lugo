import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

/**
 * A deploy under an open page.
 *
 * The map and the planner are loaded on first use, from files named by their hash. The
 * site is rebuilt several times a day for the notices snapshot, and every rebuild renames
 * them; the service worker updates itself and drops the old names from its cache. So a
 * page opened before a deploy and asked for the map after it fetched a file that no
 * longer exists, and showed "A view failed to render" -- seen on the live site, three
 * times in one session. Vite raises this event for exactly that case; the page reloads
 * once and picks up the new names. Once: a reload that lands on the same failure is a
 * different problem, and looping on it would hide it.
 */
window.addEventListener('vite:preloadError', (event) => {
  const key = 'urbanos-lugo-reloaded-for';
  const target = location.href;
  try {
    if (sessionStorage.getItem(key) === target) return; // already tried; let it surface
    sessionStorage.setItem(key, target);
  } catch {
    // No storage: reload anyway, once is not enforceable without it.
  }
  event.preventDefault();
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
