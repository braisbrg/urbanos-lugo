import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Moon, X } from 'lucide-react';
import { StopArrivalsView } from './components/StopArrivalsView';
import { StopHome } from './components/StopHome';
import { LinesView } from './components/LinesView';
import { RoutePlannerView } from './components/RoutePlannerView';
import { TripCompanionView } from './components/TripCompanionView';
import { AlertsView } from './components/AlertsView';
import { FaresView } from './components/FaresView';
import { FavoritesDrawer } from './components/FavoritesDrawer';
import { QrScannerModal } from './components/QrScannerModal';
import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';
import { SideNav } from './components/SideNav';
import { MenuDrawer } from './components/MenuDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTripCompanion } from './hooks/useTripCompanion';
import { useFavourites, useRecentStops } from './hooks/useStoredList';
import { useTabRoute } from './hooks/useTabRoute';
import { useServiceAlerts } from './hooks/useServiceAlerts';
import { useTheme } from './hooks/useTheme';
import { useClock } from './hooks/useClock';
import { Lang, LangContext, isLang, translations } from './i18n';
import { BUS_STOPS, BUS_LINES } from './data/transitData';
import type { Tab } from './routes';
import { isLineInService } from './utils/schedule';
import { findStop } from './utils/places';
import { readString, writeString } from './utils/storage';
import { BusStop, BusLine } from './types';

// Leaflet and its layers are only needed on the map tab, so they load with it.
const InteractiveMap = lazy(() => import('./components/Map/TransitMap').then((m) => ({ default: m.TransitMap })));

const LANG_KEY = 'urbanos-lugo-lang';

/** Remembered, and seeded from the browser when there is no choice on record. */
function initialLang(): Lang {
  const stored = readString(LANG_KEY);
  if (isLang(stored)) return stored;
  const preferred = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'gl';
  return isLang(preferred) ? preferred : 'gl';
}

const stopIds = new Set(BUS_STOPS.map((s) => s.id));
const lineIds = new Set(BUS_LINES.map((l) => l.id));

export default function App() {
  // The open tab lives in the address bar, so the back gesture moves between screens.
  const [activeTab, setActiveTab] = useTabRoute('stops');
  // The board needs a stop from the first render, so it opens on the busiest interchange.
  const [selectedStop, setSelectedStop] = useState<BusStop>(() => [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length)[0]);
  /** The map must not draw that default as chosen: a big blue dot on a stop nobody picked. */
  const [stopWasChosen, setStopWasChosen] = useState(false);
  /** What the reader asked the map to show, so it can stop guessing between its stop and its line. */
  const [mapFocus, setMapFocus] = useState<'stop' | 'line'>('line');
  /** No line until somebody opens one; the map started with 1.1 drawn over a choice nobody had made. */
  const [selectedLine, setSelectedLine] = useState<BusLine | null>(null);
  /**
   * Asking for a line, rather than for the list of lines. A counter, so asking for the same
   * line twice is still two asks; zero means nobody asked and the list is what should show.
   */
  const [lineRequest, setLineRequest] = useState(0);
  /** A place chosen in the search box, on its way to the planner as a destination. Same counter trick. */
  const [placeRequest, setPlaceRequest] = useState<{ query: string; nonce: number } | null>(null);
  /**
   * The map stays mounted between visits — a remount was a fresh WebGL context and a fresh
   * style download every time — but nothing before the first: it is a lazy chunk.
   */
  const [mapEverOpened, setMapEverOpened] = useState(false);
  useEffect(() => {
    if (activeTab === 'map') setMapEverOpened(true);
  }, [activeTab]);

  // The stops tab opens on the saved-stops home; choosing a stop anywhere switches it to that stop's board.
  const [showStopBoard, setShowStopBoard] = useState(false);
  /** Set when a `?parada=` link or the scanner opened the board, i.e. somebody scanned that pole. */
  const [qrStopId, setQrStopId] = useState<string | null>(null);
  const [recentStopIds, rememberStop, clearRecentStops] = useRecentStops();
  const [favoriteStopIds, toggleFavoriteStop] = useFavourites('urbanos_lugo_fav_stops', stopIds);
  const [favoriteLineIds, toggleFavoriteLine] = useFavourites('urbanos_lugo_fav_lines', lineIds);
  const [isNightBannerDismissed, setIsNightBannerDismissed] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = translations(lang);

  // The "no service" banner comes from the actual timetables, not from assuming the network sleeps 22:00-06:00.
  const now = useClock(60_000);
  const isOutOfService = !BUS_LINES.some((l) => isLineInService(l, now));
  const firstDepartureTomorrow = useMemo(() => BUS_LINES.map((l) => l.firstDeparture).sort()[0], []);

  /** The operator's notices, fetched once here for everybody who shows them. */
  const alerts = useServiceAlerts();
  /** The ride in progress, above the tabs: the planner is unmounted the moment the reader looks at the map. */
  const companion = useTripCompanion(lang);

  const screenTitle = ({ stops: t.nav.stops, lines: t.nav.lines, map: t.nav.map, plan: t.nav.plan, info: t.menu.alerts, fares: t.menu.fares } satisfies Record<Tab, string>)[activeTab];

  // index.html ships Galician for the crawler; once the app knows who is reading, the page and the tab title say so.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = activeTab === 'stops' ? t.map.documentTitle : `${screenTitle} · ${t.nav.appName}`;
    writeString(LANG_KEY, lang);
  }, [lang, t, activeTab, screenTitle]);

  const openLine = (line: BusLine) => {
    setSelectedLine(line);
    setLineRequest((n) => n + 1);
    setActiveTab('lines');
  };
  /** The nav asks for a tab, not for a line, so Líneas opens on its list. */
  const goToTab = (tab: Tab) => {
    if (tab === 'lines') setLineRequest(0);
    setActiveTab(tab);
  };
  /** `viaQr`: the reader got here off the sticker on that pole. Cleared on every other route in. */
  const selectStop = (stop: BusStop, viaQr = false) => {
    setSelectedStop(stop);
    setStopWasChosen(true);
    rememberStop(stop.id);
    setShowStopBoard(true);
    setActiveTab('stops');
    setQrStopId(viaQr ? stop.id : null);
  };
  const viewStopOnMap = (stop: BusStop) => {
    setSelectedStop(stop);
    setStopWasChosen(true);
    setMapFocus('stop');
    setActiveTab('map');
  };
  const viewLineOnMap = (line: BusLine) => {
    setSelectedLine(line);
    setMapFocus('line');
    setActiveTab('map');
  };

  // Direct QR links (`?parada=xRiq`, `?stop=101`) and shared lines (`?linea=`), resolved the way the scanner resolves them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stopParam = params.get('parada') || params.get('stop') || params.get('qr') || params.get('ps');
    const lineParam = params.get('linea') || params.get('line');
    const stop = stopParam && findStop(stopParam);
    if (stop) {
      setSelectedStop(stop);
      setShowStopBoard(true);
      setActiveTab('stops');
      setQrStopId(stop.id);
    }
    const line = lineParam && BUS_LINES.find((l) => l.id.toLowerCase() === lineParam.toLowerCase() || l.number.toLowerCase() === lineParam.toLowerCase());
    if (line) openLine(line);
  }, []);

  return (
    <LangContext.Provider value={lang}>
      <div className="flex h-viewport bg-bg text-ink lg:flex-row">
        {/* First in the document, so it is the first Tab stop. */}
        <a href="#contido" className="sr-only focus:not-sr-only focus:absolute focus:z-[2000] focus:m-2 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-body focus:font-bold focus:text-on-accent">
          {t.nav.skipToContent}
        </a>
        <SideNav activeTab={activeTab} setActiveTab={goToTab} alertCount={alerts.announcedIncidents} tripActive={companion.trip !== null} setLang={setLang} theme={theme} setTheme={setTheme} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            onOpenFavorites={() => setIsFavoritesOpen(true)}
            savedCount={favoriteStopIds.length + favoriteLineIds.length}
            onSelectStop={selectStop}
            onSelectLine={openLine}
            onSelectPlace={(query) => {
              setPlaceRequest((prev) => ({ query, nonce: (prev?.nonce ?? 0) + 1 }));
              setActiveTab('plan');
            }}
            onOpenQrScanner={() => setIsQrModalOpen(true)}
            onOpenMenu={() => setIsMenuOpen(true)}
            alertCount={alerts.announcedIncidents}
          />

          {/* Nothing is running: the one useful sentence at 03:00 is when the first bus goes. Two lines, the whole row a link to the notices; the festival sentence keeps "no service" from being a lie on San Froilán. */}
          {isOutOfService && (
            <div className={`fold ${isNightBannerDismissed ? 'fold-closed' : ''}`}>
              <div>
            <div className="flex items-center gap-1 border-b border-line bg-surface pl-3.5 pr-1">
              <button onClick={() => setActiveTab('info')} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left">
                <Moon className="h-4.5 w-4.5 shrink-0 text-ink-2" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">{t.nightBanner.closed(firstDepartureTomorrow)}</span>
                  <span className="block truncate text-label text-ink-3">{t.nightBanner.festivals} ›</span>
                </span>
                <span className="sr-only">{t.nightBanner.seeNotices}</span>
              </button>
              <button onClick={() => setIsNightBannerDismissed(true)} aria-label={t.nightBanner.dismiss} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3">
                <X className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
              </div>
            </div>
          )}

          <main id="contido" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <ErrorBoundary t={t} resetKey={activeTab}>
              {/* One heading for the page, naming what is on screen: correct in both the one-pane and the two-pane layout. */}
              <h1 className="sr-only">{screenTitle}</h1>

              {/* Below lg the two panes take turns; from lg up the saved stops stay beside the board. */}
              {activeTab === 'stops' && (
                <div className="mx-auto h-full w-full max-w-7xl lg:grid lg:grid-cols-12 lg:gap-6 lg:px-6 lg:pt-4">
                  <div className={`lg:col-span-5 lg:block lg:h-full lg:overflow-y-auto ${showStopBoard ? 'hidden' : ''}`}>
                    <StopHome favoriteStopIds={favoriteStopIds} favoriteLineIds={favoriteLineIds} onSelectLine={openLine} recentStopIds={recentStopIds} onClearRecent={clearRecentStops} onSelectStop={selectStop} onOpenQrScanner={() => setIsQrModalOpen(true)} />
                  </div>
                  {/* In from the right when it takes the list's place, like every push on a phone; the way back is not animated. From lg up the panes never take turns. */}
                  <div className={`anim-push-in lg:animate-none lg:col-span-7 lg:block lg:h-full lg:overflow-y-auto ${showStopBoard ? '' : 'hidden'}`}>
                    <StopArrivalsView
                      selectedStop={selectedStop}
                      onSelectLine={openLine}
                      onViewOnMap={viewStopOnMap}
                      onSelectStop={selectStop}
                      // Leaving the board un-chooses the stop for the map too.
                      onBack={() => {
                        setShowStopBoard(false);
                        setStopWasChosen(false);
                      }}
                      isFavorite={favoriteStopIds.includes(selectedStop.id)}
                      onToggleFavorite={toggleFavoriteStop}
                      viaQr={qrStopId === selectedStop.id}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'lines' && (
                <LinesView selectedLine={selectedLine} lineRequest={lineRequest} onSelectLine={setSelectedLine} onSelectStop={selectStop} onViewLineOnMap={viewLineOnMap} favoriteLineIds={favoriteLineIds} onToggleFavoriteLine={toggleFavoriteLine} />
              )}

              {mapEverOpened && (
                <div className={activeTab === 'map' ? 'contents' : 'hidden'}>
                  <Suspense
                    fallback={
                      <div className="max-w-7xl mx-auto px-4 py-10">
                        <div className="flex h-[540px] animate-pulse items-center justify-center rounded-card bg-surface text-body font-medium text-ink-3">{t.map.loadingMap}</div>
                      </div>
                    }
                  >
                    <InteractiveMap selectedStop={stopWasChosen ? selectedStop : undefined} selectedLine={selectedLine} focus={mapFocus} onSelectStop={selectStop} onSelectLine={setSelectedLine} onOpenLine={openLine} />
                  </Suspense>
                </div>
              )}

              {activeTab === 'plan' && (companion.trip ? <TripCompanionView companion={companion} /> : <RoutePlannerView onSelectStop={selectStop} onSelectLine={openLine} destinationRequest={placeRequest} onStartTrip={companion.start} />)}
              {activeTab === 'info' && <AlertsView alerts={alerts} />}
              {activeTab === 'fares' && <FaresView />}
            </ErrorBoundary>
          </main>

          <BottomNav activeTab={activeTab} setActiveTab={goToTab} tripActive={companion.trip !== null} />
        </div>

        <MenuDrawer open={isMenuOpen} onClose={() => setIsMenuOpen(false)} onOpenTab={setActiveTab} alertCount={alerts.announcedIncidents} setLang={setLang} theme={theme} setTheme={setTheme} />
        <FavoritesDrawer
          isOpen={isFavoritesOpen}
          onClose={() => setIsFavoritesOpen(false)}
          favoriteStopIds={favoriteStopIds}
          favoriteLineIds={favoriteLineIds}
          onSelectStop={selectStop}
          onSelectLine={openLine}
          onRemoveFavoriteStop={toggleFavoriteStop}
          onRemoveFavoriteLine={toggleFavoriteLine}
        />
        <QrScannerModal isOpen={isQrModalOpen} onClose={() => setIsQrModalOpen(false)} onSelectStop={(stop) => selectStop(stop, true)} />
      </div>
    </LangContext.Provider>
  );
}
