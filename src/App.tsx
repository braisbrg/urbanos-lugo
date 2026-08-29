import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { StopArrivalsView } from './components/StopArrivalsView';
import { StopHome } from './components/StopHome';
import { LinesView } from './components/LinesView';
import { RoutePlannerView } from './components/RoutePlannerView';

// Leaflet and its layers are only needed on the map tab, so they load with it rather
// than sitting in the bundle every visitor downloads.
const InteractiveMap = lazy(() =>
  import('./components/Map/TransitMap').then((m) => ({ default: m.TransitMap })),
);
import { AlertsView } from './components/AlertsView';
import { FaresView } from './components/FaresView';
import { FavoritesDrawer } from './components/FavoritesDrawer';
import { QrScannerModal } from './components/QrScannerModal';
import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';
import { SideNav } from './components/SideNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useRecentStops } from './hooks/useRecentStops';
import { useTabRoute } from './hooks/useTabRoute';
import { useServiceAlerts } from './hooks/useServiceAlerts';
import { Lang, isLang, translations } from './i18n';
import { MenuDrawer } from './components/MenuDrawer';
import { useTheme } from './hooks/useTheme';
import { BUS_STOPS, BUS_LINES } from './data/transitData';
import { isLineInService } from './utils/schedule';
import { findStop } from './utils/transitEngine';
import { BusStop, BusLine } from './types';
import { Moon, X } from 'lucide-react';

/**
 * Favourites kept in localStorage, filtered against the ids that currently exist.
 * A rebuilt dataset changes stop ids, and the stale ones kept inflating the badge
 * ("5 favoritos" over a drawer showing two) because nothing ever pruned them.
 */
function usePersistedIds(
  storageKey: string,
  known: Set<string>,
): [string[], React.Dispatch<React.SetStateAction<string[]>>] {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(saved)) return saved.filter((id: unknown) => typeof id === 'string' && known.has(id));
    } catch {
      // corrupt entry: start clean rather than crash on load
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(ids));
    } catch {
      // storage full or blocked: favourites just do not persist
    }
  }, [storageKey, ids]);

  return [ids, setIds];
}

function MapLoading({ lang }: { lang: Lang }) {
  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <div className="flex h-[540px] animate-pulse items-center justify-center rounded-xl bg-surface text-body font-medium text-ink-3">
        {translations(lang).map.loadingMap}
      </div>
    </div>
  );
}

export default function App() {
  // The open tab lives in the address bar, so the back gesture moves between screens
  // instead of leaving the site. See src/hooks/useTabRoute.ts.
  const [activeTab, setActiveTab] = useTabRoute('stops');
  // Open on the busiest interchange rather than whichever stop happens to be first in
  // the file; that used to land on a campus terminus with almost no service.
  const [selectedStop, setSelectedStop] = useState<BusStop>(
    () => [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length)[0],
  );
  /**
   * The board needs a stop from the first render, so it starts on the busiest one.
   * The map must not: it draws the selected stop as a big blue dot, and drawing that
   * over a stop nobody chose put a mark on Rda. Muralla (Sindicatos) that blinked in
   * and out as the layer rebuilt on every zoom.
   */
  const [stopWasChosen, setStopWasChosen] = useState(false);
  /**
   * What the reader asked the map to show, so it can stop guessing.
   *
   * The map keeps both a selected stop and a selected line, and arriving from a stop
   * used to leave the previous line's filter on: the route was drawn, the other stops
   * were hidden, and if the stop was not on that line it was not there at all.
   */
  const [mapFocus, setMapFocus] = useState<'stop' | 'line'>('line');
  const [selectedLine, setSelectedLine] = useState<BusLine | null>(BUS_LINES[0]);
  /**
   * Asking for a line, rather than for the list of lines.
   *
   * Seven places offer a line — a stop's arrival row, the search bar, the map, the
   * planner, saved lines, a shared ?linea= link — and all of them used to select it and
   * switch tab. Below lg that arrives at the full list with the chosen line ticked in
   * state and usually below the fold: somebody who asked for one line got twenty.
   *
   * A counter rather than a flag, so asking for the same line twice is still two asks.
   * Zero means nobody asked and the list is what should show.
   */
  /**
   * Whether the map has ever been opened.
   *
   * The map used to be mounted and unmounted with the tab, which meant a fresh Leaflet
   * container, a fresh WebGL context, a fresh style download and a fresh first paint
   * every single time somebody came back to it — measured at four distinct map elements
   * across three visits. That rebuild is what reads as the map resizing itself on the
   * way in. It stays mounted now, hidden between visits, so the second visit shows the
   * map already drawn and looking at wherever it was left.
   *
   * Still nothing before the first visit: the map is a lazy chunk and somebody who only
   * ever checks a departure time should not pay to download a renderer.
   */
  const [mapEverOpened, setMapEverOpened] = useState(false);
  useEffect(() => {
    if (activeTab === 'map') setMapEverOpened(true);
  }, [activeTab]);

  const [lineRequest, setLineRequest] = useState(0);
  const openLine = (line: BusLine) => {
    setSelectedLine(line);
    setLineRequest((n) => n + 1);
    setActiveTab('lines');
  };
  /** The nav asks for a tab, not for a line, so Líneas opens on its list. */
  const goToTab = (tab: typeof activeTab) => {
    if (tab === 'lines') setLineRequest(0);
    setActiveTab(tab);
  };
  // The stops tab opens on the saved-stops home; choosing a stop anywhere — search, QR,
  // map, a saved stop — switches it to that stop's board, and Back returns here.
  const [showStopBoard, setShowStopBoard] = useState(false);
  /** Set when a `?parada=` link opened the board, i.e. somebody scanned that pole. */
  const [qrStopId, setQrStopId] = useState<string | null>(null);
  const [recentStopIds, rememberStop, clearRecentStops] = useRecentStops();
  const [isNightBannerDismissed, setIsNightBannerDismissed] = useState(false);

  // Derive the "no service" banner from the actual timetables rather than assuming
  // the network sleeps between 22:00 and 06:00.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const linesInService = BUS_LINES.filter((l) => isLineInService(l, now));
  const isOutOfService = linesInService.length === 0;
  /**
   * The operator's notices, fetched once here for everybody who shows them.
   *
   * The badge used to count the snapshot compiled into the bundle while the Avisos
   * screen fetched the server. Two answers to one question, and on any deployment with
   * a server running they disagreed: the bar said one incident and the page underneath
   * said the network was running normally.
   */
  const alerts = useServiceAlerts();
  const firstDepartureTomorrow = [...BUS_LINES]
    .map((l) => l.firstDeparture)
    .sort()[0];
  const [favoriteStopIds, setFavoriteStopIds] = usePersistedIds(
    'urbanos_lugo_fav_stops',
    useMemo(() => new Set(BUS_STOPS.map((s) => s.id)), []),
  );
  const [favoriteLineIds, setFavoriteLineIds] = usePersistedIds(
    'urbanos_lugo_fav_lines',
    useMemo(() => new Set(BUS_LINES.map((l) => l.id)), []),
  );

  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  /**
   * The interface language, remembered, and seeded from the browser when there is no
   * choice on record — a visitor arriving from the Camino should not have to find the
   * menu before they can read the page.
   */
  const [lang, setLang] = useState<Lang>(() => {
    // Same reason as the theme: private browsing and a full quota both throw here.
    try {
      const stored = localStorage.getItem('urbanos-lugo-lang');
      if (isLang(stored)) return stored;
    } catch {
      // fall through to the browser's language
    }
    const preferred = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'gl';
    return isLang(preferred) ? preferred : 'gl';
  });
  const t = translations(lang);

  // index.html hardcodes lang="gl"; keep it truthful when the reader switches so screen
  // readers pronounce the page with the right voice.
  useEffect(() => {
    document.documentElement.lang = lang;
    // index.html ships a Galician title for the crawler; once the app knows who is
    // reading, the tab should say so too.
    document.title = t.map.documentTitle;
    try {
      localStorage.setItem('urbanos-lugo-lang', lang);
    } catch {
      // The language still applies; it just will not survive a reload.
    }
  }, [lang, t]);

  // Check URL query parameters for direct QR links (e.g. ?parada=xRiq or ?stop=101)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stopParam = params.get('parada') || params.get('stop') || params.get('qr') || params.get('ps');
    const lineParam = params.get('linea') || params.get('line');

    if (stopParam) {
      // Same resolver the QR scanner uses, so a scanned link and a typed code behave alike.
      const stop = findStop(stopParam);
      if (stop) {
        setSelectedStop(stop);
        setShowStopBoard(true);
        setActiveTab('stops');
        // Which stop, not just that one arrived this way: tapping through to the pole
        // across the road is an ordinary visit and must not inherit the QR's extras.
        setQrStopId(stop.id);
      }
    }

    if (lineParam) {
      const line = BUS_LINES.find(
        (l) => l.id.toLowerCase() === lineParam.toLowerCase() || l.number.toLowerCase() === lineParam.toLowerCase()
      );
      if (line) openLine(line);
    }
  }, []);

  const handleToggleFavorite = (stopId: string) =>
    setFavoriteStopIds((prev) =>
      prev.includes(stopId) ? prev.filter((id) => id !== stopId) : [...prev, stopId],
    );

  const handleToggleFavoriteLine = (lineId: string) =>
    setFavoriteLineIds((prev) =>
      prev.includes(lineId) ? prev.filter((id) => id !== lineId) : [...prev, lineId],
    );

  // `viaQr` says the reader got here off the sticker on that pole -- the app's own
  // scanner, or a camera that opened `?parada=`. It is cleared on every other route in,
  // so walking to the next stop inside the app does not carry the last scan's extras.
  const handleSelectStop = (stop: BusStop, viaQr = false) => {
    setSelectedStop(stop);
    setStopWasChosen(true);
    rememberStop(stop.id);
    setShowStopBoard(true);
    setActiveTab('stops');
    setQrStopId(viaQr ? stop.id : null);
  };

  const handleSelectLine = (line: BusLine) => {
    setSelectedLine(line);
  };

  const handleViewOnMap = (stop: BusStop) => {
    setSelectedStop(stop);
    setStopWasChosen(true);
    setMapFocus('stop');
    setActiveTab('map');
  };

  const handleViewLineOnMap = (line: BusLine) => {
    setSelectedLine(line);
    setMapFocus('line');
    setActiveTab('map');
  };

  return (
    <div className="flex h-viewport bg-bg text-ink lg:flex-row">
      <SideNav
        activeTab={activeTab}
        setActiveTab={goToTab}
        alertCount={alerts.announcedIncidents}
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
      />
      <div className="flex min-w-0 flex-1 flex-col">
      <a
        href="#contido"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[2000] focus:m-2 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-body focus:font-bold focus:text-on-accent"
      >
        {t.nav.skipToContent}
      </a>
      <TopBar
        onOpenFavorites={() => setIsFavoritesOpen(true)}
        savedCount={favoriteStopIds.length + favoriteLineIds.length}
        onSelectStop={handleSelectStop}
        onSelectLine={(line) => {
          openLine(line);
        }}
        onOpenQrScanner={() => setIsQrModalOpen(true)}
        onOpenMenu={() => setIsMenuOpen(true)}
        lang={lang}
      />

      {/* Nothing is running: the single most useful thing the app can say at 03:00 is
          when the first bus goes, so that is the sentence, not a decorated panel. */}
      {isOutOfService && !isNightBannerDismissed && (
        <div className="flex items-start gap-3 border-b border-line bg-surface px-3.5 py-3">
          <Moon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={2} aria-hidden="true" />
          <div className="min-w-0 flex-1 text-label leading-relaxed">
            <p className="text-body font-semibold">
              {t.nightBanner.closed(firstDepartureTomorrow)}
            </p>
            {/* Reinforcements for San Froilán, Noitevella and similar dates exist but the
                operator only publishes them as a notice when they run, so we point at the
                notices instead of inventing a night timetable. */}
            <p className="mt-1 text-ink-3">
              {t.nightBanner.festivals}
            </p>
            <button
              onClick={() => setActiveTab('info')}
              className="mt-1.5 h-11 text-label font-semibold text-accent underline underline-offset-2"
            >
              {t.nightBanner.seeNotices}
            </button>
          </div>
          <button
            onClick={() => setIsNightBannerDismissed(true)}
            aria-label={t.nightBanner.dismiss}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-ink-3"
          >
            <X className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main id="contido" className="min-h-0 flex-1 overflow-y-auto">
        {/* One heading for the page, naming what is on screen.
            The desktop lays two panes side by side, so any per-pane <h1> gave the reader
            two of them on the stops tab and an H2 > H1 outline on lines. A single
            shell-level heading is correct in both layouts, and a reader jumping by
            heading hears which section they are in before anything else. */}
        <ErrorBoundary t={t} resetKey={activeTab}>
        <h1 className="sr-only">
          {activeTab === 'stops' ? t.nav.stops
            : activeTab === 'lines' ? t.nav.lines
            : activeTab === 'map' ? t.nav.map
            : activeTab === 'plan' ? t.nav.plan
            : t.menu.alerts}
        </h1>

        {/* Below lg the two panes take turns; from lg up the saved stops stay beside the
            board, so choosing another one never costs the board you were reading. */}
        {activeTab === 'stops' && (
          <div className="mx-auto h-full w-full max-w-7xl lg:grid lg:grid-cols-12 lg:gap-6 lg:px-6 lg:pt-4">
            <div className={`lg:col-span-5 lg:block lg:h-full lg:overflow-y-auto ${showStopBoard ? 'hidden' : ''}`}>
              <StopHome
                favoriteStopIds={favoriteStopIds}
                favoriteLineIds={favoriteLineIds}
                onSelectLine={(line) => {
                  openLine(line);
                }}
                recentStopIds={recentStopIds}
                onClearRecent={clearRecentStops}
                onSelectStop={handleSelectStop}
                onOpenQrScanner={() => setIsQrModalOpen(true)}
                lang={lang}
              />
            </div>
            <div className={`lg:col-span-7 lg:block lg:h-full lg:overflow-y-auto ${showStopBoard ? '' : 'hidden'}`}>
              <StopArrivalsView
                selectedStop={selectedStop}
                onSelectLine={(line) => {
                  openLine(line);
                }}
                onViewOnMap={handleViewOnMap}
                onSelectStop={handleSelectStop}
                onBack={() => setShowStopBoard(false)}
                isFavorite={favoriteStopIds.includes(selectedStop.id)}
                onToggleFavorite={handleToggleFavorite}
                viaQr={qrStopId === selectedStop.id}
                lang={lang}
              />
            </div>
          </div>
        )}

        {activeTab === 'lines' && (
          <LinesView
            selectedLine={selectedLine}
            lineRequest={lineRequest}
            onSelectLine={handleSelectLine}
            onSelectStop={handleSelectStop}
            onViewLineOnMap={handleViewLineOnMap}
            favoriteLineIds={favoriteLineIds}
            onToggleFavoriteLine={handleToggleFavoriteLine}
            lang={lang}
          />
        )}

        {mapEverOpened && (
          <div className={activeTab === 'map' ? 'contents' : 'hidden'}>
          <Suspense fallback={<MapLoading lang={lang} />}>
            <InteractiveMap
            selectedStop={stopWasChosen ? selectedStop : undefined}
            selectedLine={selectedLine}
            focus={mapFocus}
            onSelectStop={handleSelectStop}
            onSelectLine={(line) => {
              setSelectedLine(line);
            }}
              onOpenLine={(line) => {
                openLine(line);
              }}
              lang={lang}
            />
          </Suspense>
          </div>
        )}

        {activeTab === 'plan' && (
          <RoutePlannerView
            onSelectStop={handleSelectStop}
            onSelectLine={(line) => {
              openLine(line);
            }}
            lang={lang}
          />
        )}

        {activeTab === 'info' && <AlertsView lang={lang} alerts={alerts} />}
        {activeTab === 'fares' && <FaresView lang={lang} />}
        </ErrorBoundary>
      </main>

      <BottomNav activeTab={activeTab} setActiveTab={goToTab} lang={lang} />
      </div>

      <MenuDrawer
        open={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onOpenTab={setActiveTab}
        alertCount={alerts.announcedIncidents}
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
      />

      {/* Drawers & Modals */}
      <FavoritesDrawer
        isOpen={isFavoritesOpen}
        onClose={() => setIsFavoritesOpen(false)}
        favoriteStopIds={favoriteStopIds}
        favoriteLineIds={favoriteLineIds}
        onSelectStop={handleSelectStop}
        onSelectLine={(line) => {
          openLine(line);
        }}
        onRemoveFavoriteStop={handleToggleFavorite}
        onRemoveFavoriteLine={handleToggleFavoriteLine}
        lang={lang}
      />

      <QrScannerModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        onSelectStop={(stop) => handleSelectStop(stop, true)}
        lang={lang}
      />

      {/* Geometric Balance Footer */}
    </div>
  );
}
