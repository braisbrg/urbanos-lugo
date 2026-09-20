import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Landmark, MapPin, Menu, QrCode, Search, Star, X } from 'lucide-react';
import { BUS_LINES, poleCode } from '../data/transitData';
import { MAX_QUERY_LENGTH, calculateRelevanceScore } from '../utils/searchUtils';
import { getNearestStopToCoords, rankLandmarks, rankStops } from '../utils/places';
import { BusLine, BusStop } from '../types';
import { useT } from '../i18n';
import { LineBadge } from './ui/LineBadge';

interface TopBarProps {
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  /** A named place, which is not a stop: the planner is where you can do something with it. */
  onSelectPlace: (query: string) => void;
  onOpenQrScanner: () => void;
  onOpenFavorites: () => void;
  savedCount: number;
  onOpenMenu: () => void;
}

/** The rows the box offers for a query: the best six stops, four lines and three places (each with the stop that serves it and the walk to it). */
function searchAll(q: string) {
  if (!q) return { stops: [], lines: [], places: [] };
  return {
    stops: rankStops(q)
      .slice(0, 6)
      .map((x) => x.stop),
    lines: BUS_LINES.map((l) => ({ l, score: calculateRelevanceScore(l.name, l.number, l.id, q, l.description) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => x.l),
    places: rankLandmarks(q)
      .slice(0, 3)
      .map(({ landmark }) => ({ lm: landmark, ...getNearestStopToCoords(landmark.lat, landmark.lng) })),
  };
}

const Heading = ({ children }: { children: string }) => <div className="tnum px-4 pb-1.5 pt-3 text-label font-medium tracking-[0.05em] text-ink-3">{children.toUpperCase()}</div>;
const Row = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className="flex w-full items-center gap-3 border-t border-line-soft px-4 py-3 text-left">
    {children}
  </button>
);

/**
 * One field for stops, lines and streets, with the QR scanner attached to it: standing at
 * a pole, scanning the sticker is the shortest path from "I am here" to "these are my times".
 */
export function TopBar({ onSelectStop, onSelectLine, onSelectPlace, onOpenQrScanner, onOpenFavorites, savedCount, onOpenMenu }: TopBarProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLElement>(null);

  // Tapping anywhere else puts the results away — on a phone there is no Escape key.
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
    };
  }, [open]);

  const q = query.trim();
  // The letter paints before the list does: the rows are built from a deferred copy of the query, at low priority.
  const dq = useDeferredValue(q);
  const { stops, lines, places } = useMemo(() => searchAll(dq), [dq]);
  const settled = dq === q;
  const choose = (act: () => void) => () => {
    act();
    setQuery('');
    setOpen(false);
  };

  return (
    // A landmark, so a screen reader moving by landmark does not skip the search band.
    <header ref={boxRef} className="relative border-b border-line bg-bg px-3.5 py-3 lg:px-6">
      <div className="flex items-center gap-2">
        <div className="flex h-[46px] min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-control border border-edge bg-surface pl-3">
          <Search className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
          <input
            id="site-search"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          />
          {q.length > 0 && (
            <button onClick={choose(() => {})} className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-3" aria-label={t.search.clear}>
              <X className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <button onClick={onOpenFavorites} className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center border-l border-line text-ink-2" aria-label={t.favourites.title} title={t.favourites.title}>
            <Star className={`h-4.5 w-4.5 ${savedCount > 0 ? 'text-warn-ink' : ''}`} strokeWidth={1.8} fill={savedCount > 0 ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
          <button onClick={onOpenQrScanner} className="flex h-11 w-11 shrink-0 items-center justify-center border-l border-line text-ink-2" aria-label={t.search.qr} title={t.search.qr}>
            <QrCode className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <button onClick={onOpenMenu} className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-control border border-edge bg-surface text-ink-2 lg:hidden" aria-label={t.menu.open}>
          <Menu className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* What the rows hold, for the ear: the kinds present, or the "nothing matches" sentence, once the rows are current. */}
      <span role="status" className="sr-only">
        {open && q.length > 0 && settled
          ? [stops.length && t.search.stops, lines.length && t.search.lines, places.length && t.search.places].filter((kind): kind is string => typeof kind === 'string').join(', ') || t.search.none
          : ''}
      </span>

      {open && q.length > 0 && (
        <div className="absolute inset-x-3.5 top-full z-[1300] mt-1 max-h-[60vh] overflow-y-auto rounded-card border border-edge bg-bg shadow-md">
          {settled && stops.length === 0 && lines.length === 0 && places.length === 0 && <p className="px-4 py-4 text-body text-ink-3">{t.search.none}</p>}

          {stops.length > 0 && <Heading>{t.search.stops}</Heading>}
          {stops.map((stop) => (
            <Row key={stop.id} onClick={choose(() => onSelectStop(stop))}>
              <MapPin className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span title={stop.name} className="block truncate text-emph font-semibold">
                  {stop.name}
                </span>
                <span className="block truncate text-label text-ink-3">
                  {stop.zone} · {t.common.lines(stop.lines.length)}
                </span>
              </span>
              {poleCode(stop) && <span className="tnum shrink-0 rounded bg-surface px-2 py-1 text-label text-ink-2">{poleCode(stop)}</span>}
            </Row>
          ))}

          {lines.length > 0 && <Heading>{t.search.lines}</Heading>}
          {lines.map((line) => (
            <Row key={line.id} onClick={choose(() => onSelectLine(line))}>
              <LineBadge number={line.number} color={line.color} size="md" className="h-[38px] w-[38px] font-semibold" />
              <span title={line.name} className="min-w-0 flex-1 truncate text-body font-medium">
                {line.name}
              </span>
            </Row>
          ))}

          {places.length > 0 && <Heading>{t.search.places}</Heading>}
          {places.map(({ lm, stop, walkMeters }) => (
            <Row key={lm.name} onClick={choose(() => onSelectPlace(lm.name))}>
              <Landmark className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span title={lm.name} className="block truncate text-emph font-semibold">
                  {lm.name}
                </span>
                <span className="block truncate text-label text-ink-3">{t.search.nearestStop(stop.name, walkMeters)}</span>
              </span>
            </Row>
          ))}
        </div>
      )}
    </header>
  );
}
