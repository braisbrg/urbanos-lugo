import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { BusStop, BusLine, StopArrival } from '../../types';
import { poleCode } from '../../data/transitData';
import { getArrivalsForStop } from '../../utils/transitEngine';
import { Lang, translations } from '../../i18n';
import { useDialog } from '../../hooks/useDialog';

interface StopSheetProps {
  stop: BusStop;
  lines: BusLine[];
  lang: Lang;
  onClose: () => void;
  /** Open the line's own page. */
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
 * The stop, opened where you tapped it.
 *
 * Tapping a stop used to open a Leaflet popup whose only real content was a button that
 * took you to another tab — so the question that brings people to this screen, "that stop
 * there, when does it come", was answered by leaving the screen. This is the board itself,
 * risen over the map, with the map still behind it.
 *
 * It is the short board on purpose: the next few departures, and a way through to the full
 * one. Everything the full page adds — the operator's own minutes, the QR block, the
 * nearby poles, the alarm — is either longer than a sheet or belongs to a stop you have
 * decided on rather than one you just prodded.
 *
 * A panel inside the map container rather than a viewport sheet, so the same markup is a
 * sheet on a phone and a panel over the map card on a desktop, with no second code path.
 */
export const StopSheet: React.FC<StopSheetProps> = ({
  stop,
  lines,
  lang,
  onClose,
  onOpenLine,
  onShowLinesHere,
  onOpenFullBoard,
}) => {
  const t = translations(lang);
  const dialogRef = useDialog(true, onClose);

  // Re-read on a timer: a sheet left open would otherwise keep saying "3 min" long after
  // the bus had gone. Cheap — this reads the timetable, it makes no request.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const arrivals = useMemo(
    () => getArrivalsForStop(stop.id).arrivals.slice(0, SHOWN),
    // `tick` is the dependency that matters; the ids only change when the stop does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stop.id, tick],
  );

  const code = poleCode(stop);
  const servingLines = stop.lines
    .map((id) => lines.find((l) => l.id === id))
    .filter((l): l is BusLine => Boolean(l));

  /**
   * Where the time came from — the one thing this app must never blur.
   *
   * Same treatment as the full board: published is stated flatly on solid ground,
   * estimated wears a dashed outline and a tilde, so the shape carries the meaning
   * without relying on colour alone.
   */
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
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={stop.name}
      className="absolute inset-x-0 bottom-0 z-[520] max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-edge bg-bg shadow-2xl"
    >
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
        <button
          type="button"
          onClick={onClose}
          aria-label={t.map.closeStop}
          className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2"
        >
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
                    const line = lines.find((l) => l.id === a.lineId);
                    if (line) onOpenLine(line);
                  }}
                  className="flex min-h-[52px] w-full items-center gap-2.5 px-3.5 py-2 text-left"
                >
                  <span
                    className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded px-1.5 text-label font-black text-white"
                    style={{ backgroundColor: a.lineColor }}
                  >
                    {a.lineNumber}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label font-semibold text-ink-2">
                      {a.destination}
                    </span>
                    {a.precision === 'published' ? (
                      <span
                        title={t.arrivals.publishedHint}
                        className="mt-0.5 inline-flex items-center gap-1 rounded bg-official px-1.5 py-0.5 text-on-official"
                      >
                        <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3.4} aria-hidden="true" />
                        <span className="tnum text-label font-semibold">
                          {t.common.officialBadge} {a.etaTime}
                        </span>
                      </span>
                    ) : (
                      <span
                        title={t.arrivals.estimatedHint}
                        className="mt-0.5 inline-flex items-center rounded border-[1.5px] border-dashed border-estimated-line px-1.5 py-px text-estimated"
                      >
                        <span className="tnum text-label font-semibold">~{a.etaTime}</span>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-emph">{when(a)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {servingLines.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3.5 py-2.5">
          {servingLines.map((line) => (
            <button
              key={line.id}
              type="button"
              onClick={() => onOpenLine(line)}
              title={line.name}
              aria-label={line.name}
              className="flex h-8 min-w-8 items-center justify-center rounded px-2 text-label font-black text-white"
              style={{ backgroundColor: line.color }}
            >
              {line.number}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => onOpenFullBoard(stop)}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[9px] bg-accent px-3 text-label font-bold text-on-accent"
        >
          {t.map.viewStopDepartures}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onShowLinesHere(stop)}
          className="flex min-h-11 w-full items-center justify-center rounded-[9px] border border-edge bg-surface px-3 text-label font-bold text-ink-2"
        >
          {t.map.onlyLinesHere}
        </button>
      </div>
    </div>
  );
};
