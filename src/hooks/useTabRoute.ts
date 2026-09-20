import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { PATHS, type Tab } from '../routes';

/**
 * The open tab, in the address bar, so the back gesture moves between screens instead
 * of leaving the site. A path per tab and nothing more: the stop and line being viewed
 * keep `?parada=` and `?linea=`, which is what the QR stickers and shared links carry.
 */

const TABS = Object.entries(PATHS) as [Tab, string][];

/** A project page lives under `/<repo>/`, so the tab is the segment after that prefix. */
const BASE = import.meta.env.BASE_URL || '/';

function tabFromLocation(): Tab | null {
  const path = window.location.pathname;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\//, '');
  const segment = rest.split('/').filter(Boolean)[0]?.toLowerCase();
  return segment ? (TABS.find(([, slug]) => slug === segment)?.[0] ?? null) : null;
}

/** The search string is carried across so `?parada=` survives moving between tabs; the trailing slash is the address the build writes. */
const urlForTab = (tab: Tab): string => `${BASE}${PATHS[tab]}/${window.location.search}`;

/** A tab as a link a crawler can follow; a plain left click stays in the app, a modifier click is the browser's own. */
export function tabLink(tab: Tab, go: (tab: Tab) => void) {
  return {
    href: urlForTab(tab),
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go(tab);
    },
  };
}

export function useTabRoute(initial: Tab): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => tabFromLocation() ?? initial);

  // The opening tab goes in the address bar without a history entry, so the first back press still leaves the site.
  useEffect(() => {
    if (!tabFromLocation()) window.history.replaceState({ tab }, '', urlForTab(tab));
  }, []);

  useEffect(() => {
    const onPop = () => setTab(tabFromLocation() ?? initial);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [initial]);

  // Compared against the address bar and pushed outside the state updater, which React may run twice.
  const go = useCallback((next: Tab) => {
    if (tabFromLocation() !== next) window.history.pushState({ tab: next }, '', urlForTab(next));
    setTab(next);
  }, []);

  return [tab, go];
}
