import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Bell, Check, Clock, Map as MapIcon, Share2, Star } from 'lucide-react';
import { BusStop, BusLine, StopArrival } from '../types';
import { BUS_LINES, poleCode } from '../data/transitData';
import { getArrivalsForStop, nextServiceAtStop, timingPointStopCount } from '../utils/transitEngine';
import { Lang, translations } from '../i18n';
import {
  watchForStop,
  ringAlarm,
  notify,
  requestNotificationPermission,
  ALARM_RADIUS_M,
  AlarmHandle,
} from '../services/stopAlarm';

interface StopArrivalsViewProps {
  selectedStop: BusStop;
  onSelectLine: (line: BusLine) => void;
  onViewOnMap: (stop: BusStop) => void;
  onBack: () => void;
  isFavorite: boolean;
  onToggleFavorite: (stopId: string) => void;
  lang: Lang;
}

/** How much warning is useful: enough to put your coat on and get to the door. */
const WATCH_LEAD_MINUTES = 5;

/**
 * How far ahead "Próximas" reaches. Standing at a pole, a bus an hour and a half out is
 * not a departure you are waiting for — it is a plan, and planning is what the by-line
 * view is for. Anything dropped here is announced rather than silently cut.
 */
const NEXT_VIEW_HORIZON_MIN = 60;

/**
 * A group of departures for one line and destination, so "when does my line come"
 * can be answered without reading past every other line's times.
 */
interface LineGroup {
  key: string;
  lineId: string;
  lineNumber: string;
  lineColor: string;
  destination: string;
  departures: StopArrival[];
  /** Median gap between the departures we can see, or null with fewer than three. */
  headwayMinutes: number | null;
}

export const StopArrivalsView: React.FC<StopArrivalsViewProps> = ({
  selectedStop,
  onSelectLine,
  onViewOnMap,
  onBack,
  isFavorite,
  onToggleFavorite,
  lang,
}) => {
  const [arrivals, setArrivals] = useState<StopArrival[]>([]);
  const [view, setView] = useState<'next' | 'byLine'>('next');
  /**
   * A time to read the board at, or '' for now.
   *
   * The board answers "what is coming", which is the question at the pole. It is not
   * the question the night before, when what you want is whether there is anything at
   * a quarter past seven. The engine already takes any instant; this just lets someone
   * name one.
   */
  const [atTime, setAtTime] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  /**
   * "Tell me before the bus gets here." One watch per line at this stop, checked on the
   * same 15 s refresh the board already runs. Fires once, then clears itself.
   *
   * Like the proximity alarm, this only works while the app is open: a web page cannot
   * wake itself up, and the UI says so rather than implying a background alarm.
   */
  const [watches, setWatches] = useState<Record<string, number>>({});
  const firedRef = useRef<Set<string>>(new Set());
  const [firedMessage, setFiredMessage] = useState<string | null>(null);

  const t = translations(lang);
  const timingPoints = timingPointStopCount();

  const toggleWatch = async (lineId: string, leadMinutes: number) => {
    setWatches((prev) => {
      const next = { ...prev };
      if (next[lineId] === leadMinutes) delete next[lineId];
      else next[lineId] = leadMinutes;
      return next;
    });
    firedRef.current.delete(lineId);
    await requestNotificationPermission();
  };

  // Watches belong to one stop.
  useEffect(() => {
    setWatches({});
    firedRef.current.clear();
    setFiredMessage(null);
  }, [selectedStop.id]);

  useEffect(() => {
    for (const arrival of arrivals) {
      const lead = watches[arrival.lineId];
      if (lead === undefined || firedRef.current.has(arrival.lineId)) continue;
      if (arrival.etaMinutes > lead) continue;

      firedRef.current.add(arrival.lineId);
      const message = t.arrivals.watchFired(arrival.lineNumber, arrival.etaMinutes, selectedStop.name);
      setFiredMessage(message);
      ringAlarm();
      notify(t.arrivals.watchTitle, message);
    }
  }, [arrivals, watches, selectedStop.name]);

  // Alarm for "wake me when I am nearly at my stop".
  const [alarmOn, setAlarmOn] = useState(false);
  const [alarmDistance, setAlarmDistance] = useState<number | null>(null);
  const [alarmFired, setAlarmFired] = useState(false);
  const [alarmError, setAlarmError] = useState<string | null>(null);
  const alarmRef = useRef<AlarmHandle | null>(null);

  const stopAlarm = () => {
    alarmRef.current?.stop();
    alarmRef.current = null;
    setAlarmOn(false);
    setAlarmDistance(null);
    setAlarmFired(false);
  };

  // The alarm belongs to one stop; changing stop or leaving the view cancels it.
  useEffect(() => stopAlarm, []);
  useEffect(() => {
    if (alarmOn) stopAlarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStop.id]);

  /**
   * Recomputed every 15 s because the minutes count down against the wall clock — not
   * because anything upstream changed. Nothing here is fetched, so there is no "last
   * updated" to print: a timestamp would suggest a measurement that does not exist.
   */
  useEffect(() => {
    const at = () => {
      if (!atTime) return new Date();
      const [h, m] = atTime.split(':').map(Number);
      const when = new Date();
      when.setHours(h, m, 0, 0);
      return when;
    };
    const read = () => setArrivals(getArrivalsForStop(selectedStop.id, at()).arrivals);
    read();
    // A named time does not move, so there is nothing to refresh.
    if (atTime) return;
    const interval = setInterval(read, 15000);
    return () => clearInterval(interval);
  }, [selectedStop.id, atTime]);

  // Only looked up when the board is empty, which is the only time it is worth showing.
  const nextService = useMemo(
    () => (arrivals.length === 0 ? nextServiceAtStop(selectedStop.id) : null),
    [arrivals.length, selectedStop.id],
  );

  /**
   * Grouped by line and destination, ordered by line number — the order printed on the
   * poles and on the buses, so a rider looking for "the 5.1" finds it where they expect
   * rather than wherever it happens to fall in the arrival order.
   */
  const groups = useMemo<LineGroup[]>(() => {
    const byKey = new Map<string, LineGroup>();
    for (const a of arrivals) {
      const key = `${a.lineId}|${a.destination}`;
      const group = byKey.get(key);
      if (group) group.departures.push(a);
      else
        byKey.set(key, {
          key,
          lineId: a.lineId,
          lineNumber: a.lineNumber,
          lineColor: a.lineColor,
          destination: a.destination,
          departures: [a],
          headwayMinutes: null,
        });
    }

    for (const group of byKey.values()) {
      // Two departures give one gap, which is a sample of one and can be any pair of
      // runs; from three, the median gap says something about the service.
      if (group.departures.length < 3) continue;
      const gaps = group.departures
        .slice(1)
        .map((d, i) => d.etaMinutes - group.departures[i].etaMinutes)
        .sort((a, b) => a - b);
      group.headwayMinutes = Math.round(gaps[Math.floor(gaps.length / 2)]);
    }

    return [...byKey.values()].sort(
      (a, b) =>
        a.lineNumber.localeCompare(b.lineNumber, 'es', { numeric: true }) ||
        a.destination.localeCompare(b.destination, 'es'),
    );
  }, [arrivals]);

  // Never leave a blank board: when the next bus is more than an hour out, that one bus
  // is exactly what someone standing at the pole needs to see.
  // Every row estimated is not a failure, it is what the operator publishes — but left
  // unexplained it reads as the app being vague. Say why, and only where it applies.
  const nonePublished = arrivals.length > 0 && arrivals.every((a) => a.precision === 'estimated');

  const withinHour = arrivals.filter((a) => a.etaMinutes <= NEXT_VIEW_HORIZON_MIN);
  const soon = withinHour.length > 0 ? withinHour : arrivals.slice(0, 1);
  const beyondCount = arrivals.length - soon.length;

  /**
   * Copy the link to this stop, and only say so if it worked.
   *
   * `navigator.clipboard` does not exist on a non-secure origin, and `writeText` rejects
   * when the document is not focused or permission is refused. This used to call it
   * unguarded and flip the label to "Copied" regardless — announcing something that may
   * not have happened, which is the one thing this app is careful never to do. On
   * failure the link is shown instead, so the reader can still take it.
   */
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);

  const handleCopyShareLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?parada=${selectedStop.id}`;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard on this origin');
      await navigator.clipboard.writeText(url);
      setCopyFailedUrl(null);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      setCopyFailedUrl(url);
    }
  };

  const toggleAlarm = () => {
    if (alarmOn) return stopAlarm();
    setAlarmError(null);
    setAlarmFired(false);
    alarmRef.current = watchForStop(
      selectedStop,
      () => {
        setAlarmFired(true);
        ringAlarm();
      },
      setAlarmDistance,
      (reason) => {
        setAlarmError(reason === 'denied' ? t.arrivals.alarmDenied : t.arrivals.alarmUnavailable);
        setAlarmOn(false);
      },
    );
    setAlarmOn(true);
  };

  /** Minutes, with the tilde carrying "derived, not published" in the figure itself. */
  const Minutes: React.FC<{ arrival: StopArrival }> = ({ arrival }) => (
    <span
      className={`tnum shrink-0 text-num font-bold tracking-[-0.025em] ${
        arrival.etaMinutes === 0 ? 'text-official' : 'text-ink-max'
      }`}
    >
      {arrival.etaMinutes === 0 ? (
        <span className="text-emph">{t.common.arrivingNow}</span>
      ) : (
        <>
          {arrival.precision === 'estimated' && <span className="text-ink-3">~</span>}
          {arrival.etaMinutes}
        </>
      )}
    </span>
  );

  /**
   * Where the time came from — the one thing this app must never blur. 'published' is
   * stated flatly on solid ground; 'estimated' wears a dashed outline and a tilde, so
   * the shape says "computed" without relying on colour alone.
   */
  const provenance = (a: StopArrival) =>
    a.precision === 'published' ? (
      <span
        title={t.arrivals.publishedHint}
        className="inline-flex items-center gap-1.5 rounded bg-official px-2 py-1 text-on-official"
      >
        <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3.4} aria-hidden="true" />
        <span className="tnum text-label font-semibold tracking-[0.05em]">
          {t.common.officialBadge} {a.etaTime}
        </span>
      </span>
    ) : (
      <span
        title={t.arrivals.estimatedHint}
        className="inline-flex items-center gap-1.5 rounded border-[1.5px] border-dashed border-estimated-line px-[7px] py-[3px] text-estimated"
      >
        <span className="tnum text-label font-semibold tracking-[0.05em]">
          {t.common.estimatedBadge} {a.etaTime}
        </span>
      </span>
    );

  const lineButton = (id: string, number: string, color: string) => (
    <button
      onClick={() => {
        const line = BUS_LINES.find((l) => l.id === id);
        if (line) onSelectLine(line);
      }}
      title={t.arrivals.seeLine}
      className="tnum flex h-11 w-11 shrink-0 items-center justify-center rounded-[7px] text-body font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {number}
    </button>
  );

  const watchButton = (a: StopArrival) =>
    !atTime && a.etaMinutes > WATCH_LEAD_MINUTES ? (
      <button
        onClick={() => toggleWatch(a.lineId, WATCH_LEAD_MINUTES)}
        title={t.arrivals.watchHint(WATCH_LEAD_MINUTES)}
        aria-pressed={watches[a.lineId] !== undefined}
        className={`flex h-11 items-center gap-1.5 rounded-[9px] border px-3 text-label font-semibold ${
          watches[a.lineId] !== undefined
            ? 'border-warn bg-warn text-warn-ink'
            : 'border-edge text-ink-2'
        }`}
      >
        <Bell className="h-[15px] w-[15px] shrink-0" strokeWidth={2} aria-hidden="true" />
        {watches[a.lineId] !== undefined ? t.arrivals.watchOn : t.arrivals.watchCta(WATCH_LEAD_MINUTES)}
      </button>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-3.5 pb-8 pt-4">
      <button
        onClick={onBack}
        className="-ml-1 mb-1 flex h-11 items-center gap-1.5 pr-3 text-body font-medium text-ink-2 lg:hidden"
      >
        <ArrowLeft className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
        {t.arrivals.back}
      </button>

      <header className="flex items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <h2 className="text-title font-semibold tracking-[-0.012em]">{selectedStop.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {poleCode(selectedStop) && (
              <span className="tnum rounded bg-surface px-2 py-1 text-label font-medium text-ink-2">
                {poleCode(selectedStop)}
              </span>
            )}
            <span className="text-label text-ink-3">
              {selectedStop.zone} · {t.common.lines(selectedStop.lines.length)}
              {selectedStop.shelter === true ? ` · ${t.arrivals.shelter}` : ''}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={() => onToggleFavorite(selectedStop.id)}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? t.arrivals.unfav : t.arrivals.fav}
            className={`flex h-11 w-11 items-center justify-center rounded-[10px] border ${
              isFavorite ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-surface text-ink-2'
            }`}
          >
            <Star
              className="h-[19px] w-[19px]"
              strokeWidth={1.8}
              fill={isFavorite ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
          </button>
          <button
            onClick={() => onViewOnMap(selectedStop)}
            aria-label={t.arrivals.map}
            className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-edge bg-surface text-ink-2"
          >
            <MapIcon className="h-[19px] w-[19px]" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            onClick={toggleAlarm}
            aria-pressed={alarmOn}
            aria-label={alarmOn ? t.arrivals.alarmOn : t.arrivals.alarmCta}
            title={t.arrivals.alarmHelp}
            className={`flex h-11 w-11 items-center justify-center rounded-[10px] border ${
              alarmOn ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-surface text-ink-2'
            }`}
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            onClick={handleCopyShareLink}
            aria-label={copiedLink ? t.arrivals.copied : t.arrivals.share}
            className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-edge bg-surface text-ink-2"
          >
            {copiedLink ? (
              <Check className="h-[19px] w-[19px] text-official" strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <Share2 className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      {/* Two ways of reading the same board: by time when you will take whatever comes,
          by line when you are waiting for one in particular. */}
      <div className="flex gap-1.5 border-b border-line py-3">
        {(
          [
            ['next', t.arrivals.viewNext, t.arrivals.viewNextHint],
            ['byLine', t.arrivals.viewByLine, t.arrivals.viewByLineHint],
          ] as const
        ).map(([id, label, hint]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-pressed={view === id}
            title={hint}
            className={`h-11 flex-1 rounded-[9px] border text-body ${
              view === id
                ? 'border-ink bg-ink font-semibold text-bg'
                : 'border-edge font-medium text-ink-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line py-3">
        <label className="flex items-center gap-2 text-label font-semibold text-ink-2">
          <Clock className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="shrink-0">{t.arrivals.atTimeLabel}</span>
          <input
            type="time"
            value={atTime}
            onChange={(e) => setAtTime(e.target.value)}
            className="h-11 rounded-[9px] border border-edge bg-bg px-2 font-mono text-body text-ink"
          />
        </label>
        {atTime && (
          <button
            onClick={() => setAtTime('')}
            className="h-11 rounded-[9px] border border-edge px-3 text-label font-semibold text-ink-2"
          >
            {t.arrivals.backToNow}
          </button>
        )}
      </div>

      {/* Say it plainly. Every row below is a scheduled passing time for an hour the
          reader chose, and the countdown beside it counts from that hour, not from
          now — which would read as live if nothing said otherwise. */}
      {atTime && (
        <p className="mt-3 rounded-[10px] border border-edge bg-surface p-3 text-label font-semibold text-ink-2">
          {t.arrivals.showingAt(atTime)}
        </p>
      )}

      {(alarmOn || alarmError) && (
        <div
          role={alarmFired ? 'alert' : undefined}
          className="mt-3 rounded-[10px] border border-edge bg-surface p-3 text-label"
        >
          {alarmError ? (
            alarmError
          ) : alarmFired ? (
            <span className="font-semibold">{t.arrivals.alarmFired(selectedStop.name)}</span>
          ) : (
            <>
              {t.arrivals.alarmWatching(ALARM_RADIUS_M)}
              {alarmDistance !== null && (
                <span className="tnum ml-1 font-semibold">({alarmDistance} m)</span>
              )}
              <span className="mt-1 block text-ink-3">{t.arrivals.alarmForeground}</span>
            </>
          )}
        </div>
      )}

      {copyFailedUrl && (
        <p className="mt-3 rounded-[10px] border border-edge bg-surface p-3 text-label text-ink-2">
          {t.arrivals.copyFailed}{' '}
          <span className="tnum block break-all pt-1 text-ink select-all">{copyFailedUrl}</span>
        </p>
      )}

      {firedMessage && (
        <div
          role="alert"
          className="mt-3 flex items-start justify-between gap-3 rounded-[10px] bg-official p-3 text-label font-semibold text-on-official"
        >
          <span>{firedMessage}</span>
          <button
            onClick={() => setFiredMessage(null)}
            aria-label={t.arrivals.dismiss}
            className="shrink-0 underline"
          >
            ✕
          </button>
        </div>
      )}

      {/* The board recomputes every 15 s; without a live region a screen reader user
          never hears that the times changed. "polite" waits for a pause. */}
      {arrivals.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-edge px-5 py-10 text-center">
          <Clock className="mx-auto mb-3 h-7 w-7 text-ink-3" strokeWidth={1.6} aria-hidden="true" />
          <p className="text-body text-ink-2">
            {atTime ? t.arrivals.noneAtTime(atTime) : t.arrivals.noArrivals}
          </p>
          {/* An empty board is the right answer at 03:00, but on its own it leaves
              someone standing at the stop wondering whether to wait. */}
          {nextService && (
            <p className="mt-2 text-body font-semibold">
              {t.arrivals.nextServiceAt(nextService.lineNumber, nextService.time, nextService.destination)}
            </p>
          )}
        </div>
      ) : view === 'next' ? (
        <ul aria-live="polite" aria-atomic="false" className="mt-1">
          {soon.map((a, idx) => (
            <li
              key={`${a.lineId}-${a.etaTime}-${idx}`}
              className="border-b border-line px-3 py-3.5"
            >
              <div className="flex items-center gap-3">
                {lineButton(a.lineId, a.lineNumber, a.lineColor)}
                <span className="min-w-0 flex-1 truncate text-emph font-semibold">
                  {a.destination}
                </span>
                <Minutes arrival={a} />
                {a.etaMinutes > 0 && (
                  <span className="shrink-0 self-end pb-1 text-label text-ink-3">{t.common.min}</span>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {provenance(a)}
                <span className="flex-1" />
                {watchButton(a)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-live="polite" aria-atomic="false" className="mt-3 flex flex-col gap-2.5">
          {groups.map((g) => (
            <li
              key={g.key}
              className="tint tint-edge overflow-hidden rounded-xl border"
              style={{ '--line': g.lineColor } as React.CSSProperties}
            >
              <div className="flex items-center gap-3 p-3">
                {lineButton(g.lineId, g.lineNumber, g.lineColor)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-emph font-semibold">{g.destination}</span>
                  {g.headwayMinutes !== null && (
                    <span className="mt-0.5 block text-label text-ink-3">
                      {t.arrivals.every(g.headwayMinutes)}
                    </span>
                  )}
                </span>
                <Minutes arrival={g.departures[0]} />
                {g.departures[0].etaMinutes > 0 && (
                  <span className="shrink-0 self-end pb-1 text-label text-ink-3">{t.common.min}</span>
                )}
              </div>

              {/* The rest of this line's departures, so "I'll catch the one after" needs
                  no second tap. */}
              <div className="flex flex-wrap items-center gap-2.5 border-t border-line-soft px-3 py-2.5">
                {provenance(g.departures[0])}
                {g.departures.slice(1).map((d) => (
                  <span key={d.etaTime} className="tnum text-body text-ink-2">
                    {d.precision === 'estimated' && <span className="text-ink-3">~</span>}
                    {d.etaTime}
                  </span>
                ))}
                <span className="flex-1" />
                {watchButton(g.departures[0])}
              </div>
            </li>
          ))}
        </ul>
      )}

      {view === 'next' && beyondCount > 0 && (
        <p className="mt-3 text-label text-ink-3">{t.arrivals.beyond(beyondCount)}</p>
      )}

      {Object.keys(watches).length > 0 && (
        <p className="mt-3 rounded-[10px] border border-edge bg-surface p-3 text-label leading-relaxed text-ink-2">
          {t.arrivals.watchForeground}
        </p>
      )}

      {nonePublished ? (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="flex h-11 cursor-pointer items-center text-label font-semibold text-ink-2">
            {t.arrivals.whyEstimatedTitle}
          </summary>
          <p className="pb-1 text-label leading-relaxed text-ink-3">
            {t.arrivals.whyEstimated(timingPoints.published, timingPoints.total)}
          </p>
        </details>
      ) : (
        arrivals.length > 0 && (
          <p className="mt-4 border-t border-line pt-3.5 text-label leading-relaxed text-ink-3">
            {t.arrivals.precisionNote}
          </p>
        )
      )}
    </div>
  );
};
