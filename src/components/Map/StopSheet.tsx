import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BusStop, BusLine, StopArrival } from '../../types';
import { lineById, poleCode } from '../../data/transitData';
import { getArrivalsForStop } from '../../utils/arrivals';
import { useT } from '../../i18n';
import { useDialog } from '../../hooks/useDialog';
import { useClock } from '../../hooks/useClock';
import { LineBadge } from '../ui/LineBadge';
import { Provenance } from '../ui/Provenance';

interface StopSheetProps {
  stop: BusStop;
  onClose: () => void;
  onOpenLine: (line: BusLine) => void;
  /** Narrow the map to the lines serving this stop, without leaving the map. */
  onShowLinesHere: (stop: BusStop) => void;
  /** The full stop board, with the operator's own minutes and everything else. */
  onOpenFullBoard: (stop: BusStop) => void;
}

/** Enough to answer "can I still make it", short enough to not become a page. */
const SHOWN = 4;
/** A minute stops being useful once it has been on screen for a minute. */
const REFRESH_MS = 30_000;

/**
 * The stop, opened where you tapped it, with the map still behind it: the next few
 * departures and a way through to the full board. A panel inside the map container, so
 * the same markup is a sheet on a phone and a panel over the map card on a desktop.
 */
export function StopSheet({ stop, onClose, onOpenLine, onShowLinesHere, onOpenFullBoard }: StopSheetProps) {
  const t = useT();
  const dialogRef = useDialog(true, onClose);

  const now = useClock(REFRESH_MS);
  const arrivals = useMemo(() => getArrivalsForStop(stop.id, now).arrivals.slice(0, SHOWN), [stop.id, now]);

  const code = poleCode(stop);
  const when = (a: StopArrival) => {
    if (a.overdueMinutes) return <span className="text-ink-2">{t.common.overdue(a.overdueMinutes)}</span>;
    if (a.etaMinutes === 0) return <span className="font-bold text-ink">{t.common.arrivingNow}</span>;
    return (
      <span className="tnum font-bold text-ink">
        {a.precision === 'estimated' && <span className="text-ink-3">~</span>}
        {a.etaMinutes} min
      </span>
    );
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={stop.name} className="absolute inset-x-0 bottom-0 z-[520] max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-edge bg-bg shadow-2xl">
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <h2 className="truncate text-body font-bold text-ink">{stop.name}</h2>
          <p className="text-label text-ink-3">
            {code && (
              <>
                {t.map.stopCode}: <b className="text-ink-2">{code}</b> &bull;{' '}
              </>
            )}
            {stop.zone}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t.map.closeStop} className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2">
          <ChevronDown className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 border-t border-line">
        {arrivals.length === 0 ? (
          <p className="px-3.5 py-4 text-label leading-relaxed text-ink-2">{t.arrivals.noArrivals}</p>
        ) : (
          <ul className="divide-y divide-line">
            {arrivals.map((a, i) => (
              <li key={`${a.lineId}-${a.etaTime}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    const line = lineById(a.lineId);
                    if (line) onOpenLine(line);
                  }}
                  className="flex min-h-[52px] w-full items-center gap-2.5 px-3.5 py-2 text-left"
                >
                  <LineBadge number={a.lineNumber} color={a.lineColor} size="sm" className="h-7 min-w-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label font-semibold text-ink-2">{a.destination}</span>
                    <span className="mt-0.5 inline-block">
                      <Provenance precision={a.precision} extra={a.etaTime} title={a.precision === 'published' ? t.arrivals.publishedHint : t.arrivals.estimatedHint} />
                    </span>
                  </span>
                  <span className="shrink-0 text-emph">{when(a)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* No row of every line serving the stop: it was the one part whose height nobody could predict, and every departure above carries its badge. */}
      <div className="flex flex-col gap-1.5 border-t border-line p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => onOpenFullBoard(stop)} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-label font-bold text-on-accent">
          {t.map.viewStopDepartures}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onShowLinesHere(stop)} className="flex min-h-11 w-full items-center justify-center rounded-control border border-edge bg-surface px-3 text-label font-bold text-ink-2">
          {t.map.onlyLinesHere}
        </button>
      </div>
    </div>
  );
}
