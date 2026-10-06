import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { PATHS, parsePath, pathFor, type PathLang, type Tab } from '../routes';

/**
 * The open tab, in the address bar, so the back gesture moves between screens instead
 * of leaving the site. A path per tab and nothing more: the stop and line being viewed
 * keep `?parada=` and `?linea=`, which is what the QR stickers and shared links carry.
 * The language is in the address too, as a first segment for Spanish and English, so a
 * copied link and a search result open in the language they were found in.
 */

/** A project page lives under `/<repo>/`, so the language and tab are the segments after that prefix. */
const BASE = import.meta.env.BASE_URL || '/';

const afterBase = (): string => {
  const path = window.location.pathname;
  return path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\//, '');
};

const tabFromLocation = (): Tab | null => parsePath(afterBase()).tab;

/** The language the address names, or null at a bare address, which is Galician's. */
export const langFromLocation = (): PathLang | null => parsePath(afterBase()).lang;

/** The search string is carried across so `?parada=` survives moving between tabs; the trailing slash is the address the build writes. */
const urlForTab = (tab: Tab, lang: PathLang): string => `${BASE}${pathFor(lang, PATHS[tab])}${window.location.search}`;

/** A tab as a link a crawler can follow; a plain left click stays in the app, a modifier click is the browser's own. */
export function tabLink(tab: Tab, go: (tab: Tab) => void, lang: PathLang) {
  return {
    href: urlForTab(tab, lang),
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go(tab);
    },
  };
}

export function useTabRoute(initial: Tab, lang: PathLang): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => tabFromLocation() ?? initial);

  // The opening tab and a change of language replace the address rather than add a history
  // entry, so the first back press still leaves the site; a back press onto an address in
  // the language the reader has since left, or a tab's word from another language, is
  // brought in line the same way.
  useEffect(() => {
    if (window.location.pathname !== `${BASE}${pathFor(lang, PATHS[tab])}`) window.history.replaceState({ tab }, '', urlForTab(tab, lang));
  }, [tab, lang]);

  useEffect(() => {
    const onPop = () => setTab(tabFromLocation() ?? initial);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [initial]);

  // Compared against the address bar and pushed outside the state updater, which React may run twice.
  const go = useCallback(
    (next: Tab) => {
      if (tabFromLocation() !== next) window.history.pushState({ tab: next }, '', urlForTab(next, lang));
      setTab(next);
    },
    [lang],
  );

  return [tab, go];
}
