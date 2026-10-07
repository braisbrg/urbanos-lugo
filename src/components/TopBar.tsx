import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Landmark, MapPin, Menu, QrCode, Search, Star, X } from 'lucide-react';
import { BUS_LINES, poleCode } from '../data/transitData';
import { MAX_QUERY_LENGTH, calculateRelevanceScore, matchesQuery } from '../utils/searchUtils';
import { getNearestStopToCoords, rankLandmarks, rankStops } from '../utils/places';
import { BusLine, BusStop } from '../types';
import { useT } from '../i18n';
import { LineBadge } from './ui/LineBadge';
import { asideSections, navSections, type Tab } from './navSections';

interface TopBarProps {
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  /** A named place, which is not a stop: the planner is where you can do something with it. */
  onSelectPlace: (query: string) => void;
  onOpenQrScanner: () => void;
  onOpenFavorites: () => void;
  savedCount: number;
  onOpenMenu: () => void;
  /** Notices in force, on the button that hides them: the drawer's badge is behind it. */
  alertCount: number;
  /** A screen asked for by name. */
  onOpenTab: (tab: Tab) => void;
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
  <button onClick={onClick} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft px-cap-4 py-3 text-left">
    {children}
  </button>
);

/**
 * One field for stops, lines and streets, with the QR scanner attached to it: standing at
 * a pole, scanning the sticker is the shortest path from "I am here" to "these are my times".
 */
export function TopBar({ onSelectStop, onSelectLine, onSelectPlace, onOpenQrScanner, onOpenFavorites, savedCount, onOpenMenu, alertCount, onOpenTab }: TopBarProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLElement>(null);

  // Tapping anywhere else puts the results away, and so does Escape. The tap counts when the
  // finger lifts (WCAG 2.5.2): on the way down it was an action nobody could take back by
  // sliding off. Escape because the list comes back each time the field takes the focus,
  // over whatever is under it, and a reader has to be able to put it away without moving
  // (1.4.13).
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const q = query.trim();
  // The letter paints before the list does: the rows are built from a deferred copy of the query, at low priority.
  const dq = useDeferredValue(q);
  const { stops, lines, places } = useMemo(() => searchAll(dq), [dq]);
  // The screens too, by their names: the notices and the fares were reached by the navigation
  // alone, and a set of pages needs a second way to each (WCAG 2.4.5).
  const screens = useMemo(() => (dq ? [...navSections(t), ...asideSections(t, 0)].filter((s) => matchesQuery(s.label, dq)) : []), [dq, t]);
  const settled = dq === q;
  const choose = (act: () => void) => () => {
    act();
    setQuery('');
    setOpen(false);
  };

  return (
    // A landmark, so a screen reader moving by landmark does not skip the search band. When the
    // Tab key takes the focus out of it the results go too: left open, they lay over the next
    // controls on the page and the focus went behind them (2.4.11). Only a focus that went
    // somewhere: a tap on a row in Safari takes it nowhere, and the row has to stay to be tapped.
    <header
      ref={boxRef}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      className="relative border-b border-line bg-bg px-cap-3.5 py-3 lg:px-6"
    >
      <div className="flex items-center gap-2">
        {/* The buttons in the bar are sized in px like the bar itself: in rem they doubled with
            the type inside a 46 px bar, and at 200% the QR button was pushed half out of it.
            The field's focus ring is drawn on this box, the shape the eye takes for the field:
            the input inside had its outline taken off and nothing in its place. */}
        <div className="flex h-[46px] min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-control border border-edge bg-surface pl-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent">
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
            className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-hidden placeholder:text-ink-3"
          />
          {q.length > 0 && (
            <button onClick={choose(() => {})} className="flex h-[44px] w-[44px] shrink-0 items-center justify-center text-ink-3" aria-label={t.search.clear}>
              <X className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <button onClick={onOpenFavorites} className="ml-auto flex h-[44px] w-[44px] shrink-0 items-center justify-center border-l border-line text-ink-2" aria-label={t.favourites.title} title={t.favourites.title}>
            <Star className={`h-4.5 w-4.5 ${savedCount > 0 ? 'text-warn-ink' : ''}`} strokeWidth={1.8} fill={savedCount > 0 ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
          <button onClick={onOpenQrScanner} className="flex h-[44px] w-[44px] shrink-0 items-center justify-center border-l border-line text-ink-2" aria-label={t.search.qr} title={t.search.qr}>
            <QrCode className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {/* The same badge as the drawer row: the count was only inside the drawer, so on a phone it existed for whoever opened the menu. */}
        <button
          onClick={onOpenMenu}
          className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-control border border-edge bg-surface text-ink-2 lg:hidden"
          aria-label={alertCount > 0 ? `${t.menu.open}. ${t.menu.alerts}: ${alertCount}` : t.menu.open}
        >
          <Menu className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          {alertCount > 0 && (
            <span className="anim-badge-in tnum absolute -right-1.5 -top-1.5 min-w-5 rounded-control bg-warn px-1 text-center text-label font-bold leading-5 text-warn-ink" aria-hidden="true">
              {alertCount}
            </span>
          )}
        </button>
      </div>

      {/* What the rows hold, for the ear: the kinds present, or the "nothing matches" sentence, once the rows are current. */}
      <span role="status" className="sr-only">
        {open && q.length > 0 && settled
          ? [stops.length && t.search.stops, lines.length && t.search.lines, places.length && t.search.places, screens.length && t.search.screens].filter((kind): kind is string => typeof kind === 'string').join(', ') || t.search.none
          : ''}
      </span>

      {open && q.length > 0 && (
        <div className="anim-drop absolute inset-x-3.5 top-full z-[1300] mt-1 max-h-[60vh] overflow-y-auto rounded-card border border-edge bg-bg shadow-md">
          {settled && stops.length === 0 && lines.length === 0 && places.length === 0 && screens.length === 0 && <p className="px-4 py-4 text-body text-ink-3">{t.search.none}</p>}

          {stops.length > 0 && <Heading>{t.search.stops}</Heading>}
          {stops.map((stop) => (
            <Row key={stop.id} onClick={choose(() => onSelectStop(stop))}>
              <MapPin className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
              {/* The name keeps 6rem and the pole code goes under it when both do not fit: at 200%
                  text the names spilled up to 130 px out of their box, over the code. */}
              <span className="min-w-[min(6rem,100%)] flex-1">
                <span className="block break-words text-emph font-semibold">{stop.name}</span>
                <span className="block text-label text-ink-3">
                  {stop.zone} · {t.common.lines(stop.lines.length)}
                </span>
              </span>
              {poleCode(stop) && <span className="tnum ml-auto shrink-0 rounded bg-surface px-2 py-1 text-label text-ink-2">{poleCode(stop)}</span>}
            </Row>
          ))}

          {lines.length > 0 && <Heading>{t.search.lines}</Heading>}
          {lines.map((line) => (
            <Row key={line.id} onClick={choose(() => onSelectLine(line))}>
              <LineBadge number={line.number} color={line.color} size="md" className="h-[38px] w-[38px] font-semibold" />
              <span className="min-w-0 flex-1 break-words text-body font-medium">{line.name}</span>
            </Row>
          ))}

          {places.length > 0 && <Heading>{t.search.places}</Heading>}
          {places.map(({ lm, stop, walkMeters }) => (
            <Row key={lm.name} onClick={choose(() => onSelectPlace(lm.name))}>
              <Landmark className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-emph font-semibold">{lm.name}</span>
                <span className="block text-label text-ink-3">{t.search.nearestStop(stop.name, walkMeters)}</span>
              </span>
            </Row>
          ))}

          {screens.length > 0 && <Heading>{t.search.screens}</Heading>}
          {screens.map(({ id, Icon, label }) => (
            <Row key={id} onClick={choose(() => onOpenTab(id))}>
              <Icon className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words text-emph font-semibold">{label}</span>
            </Row>
          ))}
        </div>
      )}
    </header>
  );
}
