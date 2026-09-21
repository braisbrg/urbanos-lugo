import { useState, type CSSProperties, type ReactNode } from 'react';
import { Compass, History, QrCode, Route, Star, type LucideIcon } from 'lucide-react';
import { BusLine, BusStop } from '../types';
import { lineById, stopById } from '../data/transitData';
import { NEARBY_STOP_LIMIT_METRES, NearbyStop, getNearbyStops } from '../utils/places';
import { getArrivalsForStop } from '../utils/arrivals';
import { useT } from '../i18n';
import { useClock } from '../hooks/useClock';
import { LazyNearbyMiniMap } from './Map/LazyNearbyMiniMap';
import { LineBadge } from './ui/LineBadge';

interface StopHomeProps {
  favoriteStopIds: string[];
  favoriteLineIds: string[];
  onSelectLine: (line: BusLine) => void;
  recentStopIds: string[];
  onClearRecent: () => void;
  onSelectStop: (stop: BusStop) => void;
  onOpenQrScanner: () => void;
}

/** How many departures to show per saved stop before it becomes a wall of numbers. */
const PER_STOP = 3;

const Heading = ({ icon: Icon, tint, children, action }: { icon: LucideIcon; tint: string; children: ReactNode; action?: ReactNode }) => (
  <div className="mt-7 flex items-center gap-3">
    <h2 className="flex flex-1 items-center gap-2 text-emph font-semibold">
      <Icon className={`h-4.5 w-4.5 shrink-0 ${tint}`} strokeWidth={2} aria-hidden="true" />
      {children}
    </h2>
    {action}
  </div>
);

/** A stop as a plain row: the name, the zone and how many lines. */
function StopRow({ stop, onSelect, trailing }: { stop: BusStop; onSelect: (stop: BusStop) => void; trailing?: ReactNode }) {
  const t = useT();
  return (
    <li>
      <button onClick={() => onSelect(stop)} className="flex w-full items-center gap-3 rounded-control border border-edge px-3.5 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span title={stop.name} className="block truncate text-body font-semibold">
            {stop.name}
          </span>
          <span className="block truncate text-label text-ink-3">
            {trailing ? '' : `${stop.zone} · `}
            {t.common.lines(stop.lines.length)}
          </span>
        </span>
        {trailing}
      </button>
    </li>
  );
}

/**
 * The landing screen for the stops tab: the two or three stops a regular traveller uses,
 * already showing their next departures. Saved stops sit above "near me" on purpose:
 * geolocation takes a second, needs a permission and can be refused.
 */
export function StopHome({ favoriteStopIds, favoriteLineIds, onSelectLine, recentStopIds, onClearRecent, onSelectStop, onOpenQrScanner }: StopHomeProps) {
  const t = useT();
  useClock(30_000); // the boards below recompute on every render, so a tick is enough

  const [nearby, setNearby] = useState<NearbyStop[]>([]);
  const [locatedAt, setLocatedAt] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const locate = () => {
    if (!navigator.geolocation) return setLocationError(t.stopHome.unavailable);
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Within walking distance, not merely nearest: from Madrid the first answer is 423 km away.
        const near = getNearbyStops(pos.coords.latitude, pos.coords.longitude).filter((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES);
        setNearby(near.slice(0, 5));
        setLocatedAt(near.length ? [pos.coords.latitude, pos.coords.longitude] : null);
        setLocationError(near.length ? null : t.stopHome.outOfArea);
        setLocating(false);
      },
      () => {
        // No silent fallback to the centre of Lugo: distances the phone never measured would be worse than no list.
        setLocationError(t.stopHome.denied);
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  const saved = favoriteStopIds
    .map(stopById)
    .filter((s): s is BusStop => !!s)
    .map((stop) => ({ stop, arrivals: getArrivalsForStop(stop.id).arrivals.slice(0, PER_STOP) }));
  const recent = recentStopIds.filter((id) => !favoriteStopIds.includes(id)).map(stopById).filter((s): s is BusStop => !!s);

  // A saved line crossed with the stops the reader keeps: on its own it was a shortcut to a page one tap away.
  const known = [...saved.map((s) => s.stop), ...recent];
  const savedLines = favoriteLineIds
    .map(lineById)
    .filter((l): l is BusLine => !!l)
    .map((line) => {
      for (const stop of known) {
        if (!stop.lines.includes(line.id)) continue;
        const next = getArrivalsForStop(stop.id).arrivals.find((a) => a.lineId === line.id);
        if (next) return { line, stop, next };
      }
      return { line, stop: null, next: null };
    });

  return (
    <div className="mx-auto w-full max-w-3xl px-3.5 pb-8 pt-4">
      <h2 className="flex items-center gap-2 text-title font-semibold tracking-[-0.012em]">
        <Star className="h-5 w-5 shrink-0 text-warn-ink" strokeWidth={1.8} fill="currentColor" aria-hidden="true" />
        {t.stopHome.saved}
      </h2>

      {saved.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-edge p-5">
          <p className="text-body font-semibold">{t.stopHome.emptyTitle}</p>
          <p className="mt-1.5 text-body leading-relaxed text-ink-2">{t.stopHome.emptyBody}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={onOpenQrScanner} className="flex h-11 items-center gap-2 rounded-control bg-accent px-4 text-body font-semibold text-on-accent">
              <QrCode className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              {t.stopHome.scan}
            </button>
            {/* A link, not a field: the field is at the top of the screen, the hardest place for a thumb, and this puts the cursor there. */}
            <button onClick={() => document.getElementById('site-search')?.focus()} className="flex h-11 items-center px-1 text-body font-medium text-ink-2 underline">
              {t.stopHome.orSearchAbove}
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {saved.map(({ stop, arrivals }) => (
            <li key={stop.id}>
              <button onClick={() => onSelectStop(stop)} className="w-full rounded-card border border-edge bg-surface p-3.5 text-left">
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
                        <LineBadge number={a.lineNumber} color={a.lineColor} size="sm" className="h-[26px] min-w-[26px] rounded-[5px]" />
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

      {savedLines.length > 0 && (
        <section>
          <Heading icon={Route} tint="text-accent">
            {t.stopHome.savedLines}
          </Heading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {savedLines.map(({ line, stop, next }) => (
              <li key={line.id}>
                <button onClick={() => onSelectLine(line)} style={{ '--line': line.color } as CSSProperties} className="tint tint-edge tint-strong flex w-full items-center gap-3 rounded-control border px-2.5 py-2 text-left">
                  <LineBadge number={line.number} color={line.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold" title={line.name}>
                      {line.name}
                    </span>
                    <span className="block truncate text-label text-ink-2" title={stop ? t.stopHome.savedLinesAt(stop.name) : undefined}>
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

      {recent.length > 0 && (
        <>
          <Heading
            icon={History}
            tint="text-ink-2"
            action={
              <button onClick={onClearRecent} className="h-11 px-2 text-label font-medium text-ink-2 underline">
                {t.stopHome.clearRecent}
              </button>
            }
          >
            {t.stopHome.recent}
          </Heading>
          <ul className="mt-1 flex flex-col gap-1.5">
            {recent.map((stop) => (
              <StopRow key={stop.id} stop={stop} onSelect={onSelectStop} />
            ))}
          </ul>
        </>
      )}

      <Heading icon={Compass} tint="text-ink-2">
        {t.stopHome.near}
      </Heading>
      {locatedAt && (
        <div className="mt-2.5 overflow-hidden rounded-control border border-edge">
          <LazyNearbyMiniMap centre={{ lat: locatedAt[0], lng: locatedAt[1], label: t.stopHome.youAreHere, kind: 'user' }} stops={nearby} onSelectStop={onSelectStop} regionLabel={t.map.nearbyRegion} />
        </div>
      )}
      {nearby.length === 0 ? (
        <>
          <button onClick={locate} disabled={locating} className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-control border border-edge bg-surface text-body font-semibold text-ink-2 disabled:opacity-60">
            <Compass className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {locating ? t.stopHome.locating : t.stopHome.locate}
          </button>
          {locationError && (
            <p role="alert" className="mt-2 text-label text-ink-2">
              {locationError}
            </p>
          )}
        </>
      ) : (
        <ul className="anim-rise mt-2.5 flex flex-col gap-1.5">
          {nearby.map((stop) => (
            <StopRow
              key={stop.id}
              stop={stop}
              onSelect={onSelectStop}
              trailing={
                <span className="tnum shrink-0 text-right">
                  <span className="block text-body font-semibold">~{stop.walkMeters} m</span>
                  <span className="block text-label text-ink-3">{t.stopHome.walk(stop.walkMinutes)}</span>
                </span>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
