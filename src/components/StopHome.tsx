import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Compass, History, QrCode, Route, Search, Star } from 'lucide-react';
import { BusLine, BusStop } from '../types';
import { BUS_LINES, BUS_STOPS } from '../data/transitData';
import { NEARBY_STOP_LIMIT_METRES, getArrivalsForStop, getNearbyStops } from '../utils/transitEngine';
import { Lang, translations } from '../i18n';

interface StopHomeProps {
  favoriteStopIds: string[];
  favoriteLineIds: string[];
  onSelectLine: (line: BusLine) => void;
  recentStopIds: string[];
  onClearRecent: () => void;
  onSelectStop: (stop: BusStop) => void;
  onOpenQrScanner: () => void;
  lang: Lang;
}

/** How many departures to show per saved stop before it becomes a wall of numbers. */
const PER_STOP = 3;

/** Leaflet is heavy and this screen opens cold: the map arrives only once you ask to be located. */
const NearbyMiniMap = lazy(() =>
  import('./Map/NearbyMiniMap').then((m) => ({ default: m.NearbyMiniMap })),
);

/**
 * The landing screen for the stops tab: the two or three stops a regular traveller
 * actually uses, already showing their next departures, so the common case costs zero
 * taps and zero typing.
 *
 * Saved stops sit above "near me" on purpose. Geolocation takes a second, needs a
 * permission and can be refused; a saved stop is instant and always works, so it is
 * what the screen opens with.
 */
export const StopHome: React.FC<StopHomeProps> = ({
  favoriteStopIds,
  favoriteLineIds,
  onSelectLine,
  recentStopIds,
  onClearRecent,
  onSelectStop,
  onOpenQrScanner,
  lang,
}) => {
  // Minutes drift against the wall clock, so the board is recomputed rather than fetched.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [nearby, setNearby] = useState<(BusStop & { walkMeters: number; walkMinutes: number })[]>([]);
  const [locatedAt, setLocatedAt] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const t = translations(lang);

  const locate = () => {
    if (!navigator.geolocation) return setLocationError(t.stopHome.unavailable);
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Within walking distance, not merely nearest. The network is one city: rank
        // every stop against a phone in Madrid and the first answer is 423 km away, which
        // reads as a list of five stops to anybody who does not check the units.
        const near = getNearbyStops(pos.coords.latitude, pos.coords.longitude).filter(
          (s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES,
        );
        setNearby(near.slice(0, 5));
        // Only move the map to somewhere the network is. Outside it there is nothing to
        // look at, and flying to another province would suggest otherwise.
        setLocatedAt(near.length ? [pos.coords.latitude, pos.coords.longitude] : null);
        setLocationError(near.length ? null : t.stopHome.outOfArea);
        setLocating(false);
      },
      () => {
        // No silent fallback to the centre of Lugo: a list of stops labelled with
        // distances the phone never measured would be worse than no list.
        setLocationError(t.stopHome.denied);
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  const saved = favoriteStopIds
    .map((id) => BUS_STOPS.find((s) => s.id === id))
    .filter((s): s is BusStop => Boolean(s))
    .map((stop) => ({ stop, arrivals: getArrivalsForStop(stop.id).arrivals.slice(0, PER_STOP) }));

  /**
   * A saved line, and when it next passes somewhere the reader actually stands.
   *
   * On its own a saved line was a shortcut to a page they could already reach from the
   * lines tab in one tap — which is why it felt like it did nothing. Crossed with the
   * stops they keep, it answers the question they saved it for.
   */
  const savedLines = favoriteLineIds
    .map((id) => BUS_LINES.find((l) => l.id === id))
    .filter((l): l is BusLine => Boolean(l))
    .map((line) => {
      const known = [
        ...saved.map((s) => s.stop),
        ...recentStopIds.map((id) => BUS_STOPS.find((s) => s.id === id)).filter((s): s is BusStop => Boolean(s)),
      ];
      for (const stop of known) {
        if (!stop.lines.includes(line.id)) continue;
        const next = getArrivalsForStop(stop.id).arrivals.find((a) => a.lineId === line.id);
        if (next) return { line, stop, next };
      }
      return { line, stop: null, next: null };
    });

  return (
    <div className="mx-auto w-full max-w-3xl px-3.5 pb-8 pt-4" data-tick={tick}>
      <h2 className="flex items-center gap-2 text-title font-semibold tracking-[-0.012em]">
        <Star className="h-[21px] w-[21px] shrink-0 text-warn-ink" strokeWidth={1.8} fill="currentColor" aria-hidden="true" />
        {t.stopHome.saved}
      </h2>

      {saved.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-edge p-5">
          <p className="text-body font-semibold">{t.stopHome.emptyTitle}</p>
          <p className="mt-1.5 text-body leading-relaxed text-ink-2">{t.stopHome.emptyBody}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={onOpenQrScanner}
              className="flex h-11 items-center gap-2 rounded-[10px] bg-accent px-4 text-body font-semibold text-on-accent"
            >
              <QrCode className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
              {t.stopHome.scan}
            </button>
            <span className="flex h-11 items-center gap-2 rounded-[10px] border border-edge px-4 text-body text-ink-2">
              <Search className="h-[17px] w-[17px] shrink-0" strokeWidth={2} aria-hidden="true" />
              {t.stopHome.orSearchAbove}
            </span>
          </div>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {saved.map(({ stop, arrivals }) => (
            <li key={stop.id}>
              <button
                onClick={() => onSelectStop(stop)}
                className="w-full rounded-xl border border-edge bg-surface p-3.5 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span title={stop.name} className="truncate text-emph font-semibold">
                    {stop.name}
                  </span>
                  <span className="tnum shrink-0 text-label text-ink-3">{stop.zone}</span>
                </span>

                {arrivals.length === 0 ? (
                  <span className="mt-2 block text-label text-ink-3">{t.stopHome.none}</span>
                ) : (
                  <span className="mt-2.5 flex flex-wrap items-center gap-2">
                    {arrivals.map((a, i) => (
                      <span key={`${a.lineId}-${i}`} className="flex items-center gap-1.5">
                        <span
                          className="tnum flex h-[26px] min-w-[26px] items-center justify-center rounded-[5px] px-1.5 text-label font-bold text-white"
                          style={{ backgroundColor: a.lineColor }}
                        >
                          {a.lineNumber}
                        </span>
                        <span className="tnum text-body font-semibold">
                          {a.etaMinutes === 0 ? (
                            t.common.arrivingNow
                          ) : (
                            <>
                              {a.precision === 'estimated' && <span className="text-ink-3">~</span>}
                              {a.etaMinutes}
                              <span className="ml-0.5 text-label font-normal text-ink-3">{t.common.min}</span>
                            </>
                          )}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Looking a stop up is what everybody does; saving one is what almost nobody
          does. The second visit should cost no typing either. */}
      {savedLines.length > 0 && (
        <section className="mt-7">
          <h2 className="flex items-center gap-2 text-emph font-semibold">
            <Route className="h-[19px] w-[19px] shrink-0 text-accent" strokeWidth={1.8} aria-hidden="true" />
            {t.stopHome.savedLines}
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {savedLines.map(({ line, stop, next }) => (
              <li key={line.id}>
                <button
                  onClick={() => onSelectLine(line)}
                  style={{ '--line': line.color } as React.CSSProperties}
                  className="tint tint-edge tint-strong flex w-full items-center gap-3 rounded-[10px] border px-2.5 py-2 text-left"
                >
                  <span
                    className="tnum flex h-11 w-11 shrink-0 items-center justify-center rounded-[7px] text-body font-bold text-white"
                    style={{ backgroundColor: line.color }}
                  >
                    {line.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold" title={line.name}>
                      {line.name}
                    </span>
                    <span
                      className="block truncate text-label text-ink-2"
                      title={stop ? t.stopHome.savedLinesAt(stop.name) : undefined}
                    >
                      {stop ? t.stopHome.savedLinesAt(stop.name) : t.stopHome.savedLinesNoStop}
                    </span>
                  </span>
                  {next && (
                    <span className="tnum shrink-0 text-right">
                      <span className="block text-emph font-bold">
                        {next.precision === 'published' ? '' : '~'}
                        {next.etaMinutes}
                      </span>
                      <span className="block text-label text-ink-2">{t.common.min}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentStopIds.filter((id) => !favoriteStopIds.includes(id)).length > 0 && (
        <>
          <div className="mt-7 flex items-center gap-3">
            <h2 className="flex flex-1 items-center gap-2 text-emph font-semibold">
              <History className="h-[19px] w-[19px] shrink-0 text-ink-2" strokeWidth={2} aria-hidden="true" />
              {t.stopHome.recent}
            </h2>
            <button onClick={onClearRecent} className="h-11 px-2 text-label font-medium text-ink-2 underline">
              {t.stopHome.clearRecent}
            </button>
          </div>
          <ul className="mt-1 flex flex-col gap-1.5">
            {recentStopIds
              .filter((id) => !favoriteStopIds.includes(id))
              .map((id) => BUS_STOPS.find((s) => s.id === id))
              .filter((s): s is BusStop => Boolean(s))
              .map((stop) => (
                <li key={stop.id}>
                  <button
                    onClick={() => onSelectStop(stop)}
                    className="flex w-full items-center gap-3 rounded-[10px] border border-edge px-3.5 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span title={stop.name} className="block truncate text-body font-semibold">
                      {stop.name}
                    </span>
                      <span className="block truncate text-label text-ink-3">
                        {stop.zone} · {t.common.lines(stop.lines.length)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}

      <h2 className="mt-7 flex items-center gap-2 text-emph font-semibold">
        <Compass className="h-[19px] w-[19px] shrink-0 text-ink-2" strokeWidth={2} aria-hidden="true" />
        {t.stopHome.near}
      </h2>

      {locatedAt && (
        <div className="mt-2.5 overflow-hidden rounded-[10px] border border-edge">
          <Suspense fallback={<div className="h-[240px] w-full bg-surface" />}>
            <NearbyMiniMap
              centre={{
                lat: locatedAt[0],
                lng: locatedAt[1],
                label: t.stopHome.youAreHere,
                kind: 'user',
              }}
              stops={nearby}
              onSelectStop={onSelectStop}
              lang={lang}
              regionLabel={t.map.nearbyRegion}
            />
          </Suspense>
        </div>
      )}

      {nearby.length === 0 ? (
        <>
          <button
            onClick={locate}
            disabled={locating}
            className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-edge bg-surface text-body font-semibold text-ink-2 disabled:opacity-60"
          >
            <Compass className="h-[17px] w-[17px] shrink-0" strokeWidth={2} aria-hidden="true" />
            {locating ? t.stopHome.locating : t.stopHome.locate}
          </button>
          {locationError && (
            <p role="alert" className="mt-2 text-label text-ink-2">
              {locationError}
            </p>
          )}
        </>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {nearby.map((stop) => (
            <li key={stop.id}>
              <button
                onClick={() => onSelectStop(stop)}
                className="flex w-full items-center gap-3 rounded-[10px] border border-edge px-3.5 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">{stop.name}</span>
                  <span className="block truncate text-label text-ink-3">
                    {t.common.lines(stop.lines.length)}
                  </span>
                </span>
                <span className="tnum shrink-0 text-right">
                  <span className="block text-body font-semibold">~{stop.walkMeters} m</span>
                  <span className="block text-label text-ink-3">{t.stopHome.walk(stop.walkMinutes)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
