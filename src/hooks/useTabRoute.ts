import { useCallback, useEffect, useState } from 'react';
import type { Tab } from '../components/navSections';

/**
 * The open tab, in the address bar.
 *
 * Every screen used to live at the same URL, which meant the browser's back gesture --
 * *the* gesture on a phone -- left the app entirely instead of going back a screen.
 * Somebody who tapped Mapa to check a route and then swiped back was gone.
 *
 * A path per tab and nothing more. No router library for five destinations, and
 * deliberately no URL for the stop or line being viewed: those already have `?parada=`
 * and `?linea=`, which is what the QR stickers on the poles carry and what a shared
 * link uses. Those keep working exactly as they did.
 */

/** The Galician words, because that is the language the app is written in. */
const PATHS: Record<Tab, string> = {
  stops: 'paradas',
  lines: 'linhas',
  map: 'mapa',
  plan: 'ruta',
  info: 'avisos',
};

const TABS = Object.entries(PATHS) as [Tab, string][];

/**
 * Where the app is served from.
 *
 * A project page lives under `/<repo>/`, so the tab is the segment after that prefix
 * rather than the first segment of the path. Vite fills this in at build time.
 */
const BASE = import.meta.env.BASE_URL || '/';

function tabFromLocation(): Tab | null {
  const path = window.location.pathname;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\//, '');
  const segment = rest.split('/').filter(Boolean)[0]?.toLowerCase();
  if (!segment) return null;
  return TABS.find(([, slug]) => slug === segment)?.[0] ?? null;
}

function urlForTab(tab: Tab): string {
  // The search string is carried across so that arriving on `?parada=uilP` and then
  // moving between tabs does not silently drop the stop out of a shared link.
  return `${BASE}${PATHS[tab]}${window.location.search}`;
}

export function useTabRoute(initial: Tab): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => tabFromLocation() ?? initial);

  // Put the opening tab in the address bar without adding a history entry: the first
  // back press should leave the site, not move between two URLs that look the same.
  useEffect(() => {
    if (!tabFromLocation()) {
      window.history.replaceState({ tab }, '', urlForTab(tab));
    }
    // Once, on mount. Later changes go through `go` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => setTab(tabFromLocation() ?? initial);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [initial]);

  const go = useCallback((next: Tab) => {
    // Compared against the address bar rather than against React state, and pushed
    // outside the state updater. An updater is not the place for a side effect: React
    // may call it more than once, and in development it does, which pushed the entry
    // twice and cost a back press that appeared to do nothing.
    if (tabFromLocation() !== next) {
      window.history.pushState({ tab: next }, '', urlForTab(next));
    }
    setTab(next);
  }, []);

  return [tab, go];
}
