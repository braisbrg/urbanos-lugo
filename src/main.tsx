import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// A deploy under an open page: every rebuild renames the hashed chunks and the service
// worker drops the old names, so a page opened before a deploy fetched a file that no
// longer exists. Vite raises this event for exactly that case; reload once, not in a loop.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'urbanos-lugo-reloaded-for';
  const target = location.href;
  try {
    if (sessionStorage.getItem(key) === target) return; // already tried; let it surface
    sessionStorage.setItem(key, target);
  } catch {
    // no storage: once is not enforceable, reload anyway
  }
  event.preventDefault();
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
