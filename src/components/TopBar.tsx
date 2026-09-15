import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Landmark, MapPin, Menu, QrCode, Search, Star, X } from 'lucide-react';
import { BUS_LINES, BUS_STOPS, poleCode } from '../data/transitData';
import { MAX_QUERY_LENGTH, calculateRelevanceScore } from '../utils/searchUtils';
import { LUGO_LANDMARKS, getNearestStopToCoords } from '../utils/places';
import { BusLine, BusStop } from '../types';
import { Lang, translations } from '../i18n';

interface TopBarProps {
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  /** A named place, which is not a stop: the planner is where you can do something with it. */
  onSelectPlace: (query: string) => void;
  onOpenQrScanner: () => void;
  onOpenFavorites: () => void;
  savedCount: number;
  onOpenMenu: () => void;
  lang: Lang;
}

/** The rows the box offers for a query: the best six stops, four lines and three places. */
function searchAll(q: string) {
  const stops = q
    ? BUS_STOPS.map((s) => ({
        s,
        // Aliases are names the operator still prints for this pole, so they have to
        // match here too: searching one used to return only the lines that mention it.
        score: Math.max(
          calculateRelevanceScore(s.name, s.code, s.id, q, s.zone),
          ...(s.aliases ?? []).map((a) => calculateRelevanceScore(a, s.code, s.id, q, s.zone)),
        ),
      }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((x) => x.s)
    : [];
  const lines = q
    ? BUS_LINES.map((l) => ({ l, score: calculateRelevanceScore(l.name, l.number, l.id, q, l.description) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((x) => x.l)
    : [];

  /**
   * The places that are not stops: the cathedral, the bus station, the campus.
   *
   * The planner knew all 28 of them and this box knew none, so the same word worked in
   * one field and not the other — and this is the box the placeholder promises will find
   * a street. Measured before adding them: 24 of the 28 names, and fourteen of the words
   * people actually type for them ("catedral", "concello", "estación de autobuses",
   * "praza maior"), returned nothing here at all.
   *
   * Each row carries the nearest stop and the walk to it, because a place is not a stop
   * and the difference matters: As Termas is 417 m from the stop that serves it, the Pazo
   * de Feiras 421 m. Silently opening that stop's board would answer a question nobody
   * asked. Tapping goes to the planner, which is the screen that can do something with a
   * destination.
   */
  const places = q
    ? LUGO_LANDMARKS.map((lm) => ({ lm, score: calculateRelevanceScore(lm.name, '', '', q, lm.zone) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ lm }) => ({ lm, ...getNearestStopToCoords(lm.lat, lm.lng) }))
    : [];
  return { stops, lines, places };
}

/**
 * One field for stops, lines and streets, with the QR scanner attached to it.
 *
 * The scanner is a peer of the search box, not a menu item: standing at a pole,
 * scanning the sticker is the shortest path there is from "I am here" to "these
 * are my times" — shorter than typing a name. Burying it would throw that away.
 */
export const TopBar: React.FC<TopBarProps> = ({
  onSelectStop,
  onSelectLine,
  onSelectPlace,
  onOpenQrScanner,
  onOpenFavorites,
  savedCount,
  onOpenMenu,
  lang,
}) => {
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

  const t = translations(lang);

  const q = query.trim();
  /*
   * The letter paints before the list does.
   *
   * Every keystroke scored all 417 stops, the lines and the landmarks and drew the rows
   * in the same render as the character itself, so on a slow phone the letter appeared
   * when the list did: measured at 6x CPU, 400 ms from the first key to the paint, 219
   * of them with the thread blocked. The query the rows are built from lags one step
   * behind the field -- React renders that part at low priority, in slices the browser
   * can interrupt -- and the rows are kept until the query changes, so a re-render for
   * any other reason does not score the network again. While the rows are catching up
   * the box says nothing rather than "no results".
   */
  const dq = useDeferredValue(q);
  const { stops, lines, places } = useMemo(() => searchAll(dq), [dq]);
  const settled = dq === q;

  return (
    // A landmark, not a div: the search band was the one part of every screen outside
    // any region, so a screen reader jumping by landmark skipped straight past it.
    <header ref={boxRef} className="relative border-b border-line bg-bg px-3.5 py-3 lg:px-6">
      <div className="flex items-center gap-2">
        <div className="flex h-[46px] min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-control border border-edge bg-surface pl-3">
          <Search className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
          <input
            // Named so the empty state of the stops screen can send you here — it used
            // to point at this field in words and do nothing when pressed.
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
            // Full height so the whole 46 px band is the tap target, not just the text line.
            className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          />
          {q.length > 0 && (
            <button
              onClick={() => {
                setQuery('');
                setOpen(false);
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-3"
              aria-label={t.search.clear}
            >
              <X className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <button
            onClick={onOpenFavorites}
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center border-l border-line text-ink-2"
            aria-label={t.favourites.title}
            title={t.favourites.title}
          >
            <Star
              className={`h-4.5 w-4.5 ${savedCount > 0 ? 'text-warn-ink' : ''}`}
              strokeWidth={1.8}
              fill={savedCount > 0 ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
          </button>
          <button
            onClick={onOpenQrScanner}
            className="flex h-11 w-11 shrink-0 items-center justify-center border-l border-line text-ink-2"
            aria-label={t.search.qr}
            title={t.search.qr}
          >
            <QrCode className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <button
          onClick={onOpenMenu}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-control border border-edge bg-surface text-ink-2 lg:hidden"
          aria-label={t.menu.open}
        >
          <Menu className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* What the rows below hold, for the ear: the box opens under the field without a
          word, so a screen reader had no way to know that typing had found anything. The
          kinds present, or the "nothing matches" sentence, once the rows are current. */}
      <span role="status" className="sr-only">
        {open && q.length > 0 && settled
          ? [stops.length && t.search.stops, lines.length && t.search.lines, places.length && t.search.places]
              .filter((kind): kind is string => typeof kind === 'string')
              .join(', ') || t.search.none
          : ''}
      </span>

      {open && q.length > 0 && (
        /* A medium shadow, not a large one. The first letter typed into a cold page paints
           this box for the first time, and on a 6x-throttled CPU the 15 px blur was 80 to
           100 ms of that one long task -- 302 ms as shipped, 208 with this shadow, 226 with
           none. The border does the separating; the shadow only has to lift the box. */
        <div className="absolute inset-x-3.5 top-full z-[1300] mt-1 max-h-[60vh] overflow-y-auto rounded-card border border-edge bg-bg shadow-md">
          {settled && stops.length === 0 && lines.length === 0 && places.length === 0 && (
            <p className="px-4 py-4 text-body text-ink-3">{t.search.none}</p>
          )}

          {stops.length > 0 && (
            <div className="tnum px-4 pb-1.5 pt-3 text-label font-medium tracking-[0.05em] text-ink-3">
              {t.search.stops.toUpperCase()}
            </div>
          )}
          {stops.map((stop) => (
            <button
              key={stop.id}
              onClick={() => {
                onSelectStop(stop);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 border-t border-line-soft px-4 py-3 text-left"
            >
              <MapPin className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span title={stop.name} className="block truncate text-emph font-semibold">
                  {stop.name}
                </span>
                <span className="block truncate text-label text-ink-3">
                  {stop.zone} · {t.common.lines(stop.lines.length)}
                </span>
              </span>
              {poleCode(stop) && (
                <span className="tnum shrink-0 rounded bg-surface px-2 py-1 text-label text-ink-2">
                  {poleCode(stop)}
                </span>
              )}
            </button>
          ))}

          {lines.length > 0 && (
            <div className="tnum px-4 pb-1.5 pt-3 text-label font-medium tracking-[0.05em] text-ink-3">
              {t.search.lines.toUpperCase()}
            </div>
          )}
          {lines.map((line) => (
            <button
              key={line.id}
              onClick={() => {
                onSelectLine(line);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 border-t border-line-soft px-4 py-3 text-left"
            >
              <span
                className="tnum flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[7px] text-body font-semibold text-white"
                style={{ backgroundColor: line.color }}
              >
                {line.number}
              </span>
              <span title={line.name} className="min-w-0 flex-1 truncate text-body font-medium">
                {line.name}
              </span>
            </button>
          ))}

          {places.length > 0 && (
            <div className="tnum px-4 pb-1.5 pt-3 text-label font-medium tracking-[0.05em] text-ink-3">
              {t.search.places.toUpperCase()}
            </div>
          )}
          {places.map(({ lm, stop, walkMeters }) => (
            <button
              key={lm.name}
              onClick={() => {
                onSelectPlace(lm.name);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 border-t border-line-soft px-4 py-3 text-left"
            >
              <Landmark className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span title={lm.name} className="block truncate text-emph font-semibold">
                  {lm.name}
                </span>
                <span className="block truncate text-label text-ink-3">
                  {t.search.nearestStop(stop.name, walkMeters)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </header>
  );
};
