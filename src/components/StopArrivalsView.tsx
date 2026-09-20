import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ArrowLeft, Bell, Check, Clock, Map as MapIcon, Share2, Star } from 'lucide-react';
import { BusStop, BusLine, StopArrival } from '../types';
import { LazyNearbyMiniMap } from './Map/LazyNearbyMiniMap';
import { lineById, poleCode } from '../data/transitData';
import { getArrivalsForStop, nextServiceAtStop, timingPointStopCount } from '../utils/arrivals';
import { getNearbyLines, getNearbyStops } from '../utils/places';
import { LOCALE, useLang, useT } from '../i18n';
import { newIssueUrl } from '../project';
import { clockDriftFromTimetable, deviceTimeZone } from '../utils/clock';
import { useOperatorTimes } from '../hooks/useOperatorTimes';
import { Provenance } from './ui/Provenance';
import { LineBadge } from './ui/LineBadge';
import { IconButton, Notice, Segmented } from './ui/controls';
import { watchForStop, ringAlarm, notify, requestNotificationPermission, ALARM_RADIUS_M, AlarmHandle } from '../services/stopAlarm';

interface StopArrivalsViewProps {
  selectedStop: BusStop;
  onSelectLine: (line: BusLine) => void;
  onViewOnMap: (stop: BusStop) => void;
  /** Switch to another pole: on the map below, the one across the road is one tap. */
  onSelectStop: (stop: BusStop) => void;
  onBack: () => void;
  isFavorite: boolean;
  onToggleFavorite: (stopId: string) => void;
  /** True only when this stop was opened by scanning the QR on its own pole: the one place the operator's own minutes are shown. */
  viaQr: boolean;
}

/** The operator's label for a service, not shouted: they call one AVENIDA where we say 5.1, and the mapping is not published. */
const operatorLineLabel = (raw: string): string => (/^[\d.]+$/.test(raw) ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase());

/** "2 h", or "1 h 30 min" for the half-hour zones. */
function formatDriftHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** How much warning is useful: enough to put your coat on and get to the door. */
const WATCH_LEAD_MINUTES = 5;
const NEARBY_LINE_RADIUS_M = 400;
const NEARBY_LINE_LIMIT = 6;
/** How far ahead "Próximas" reaches: a bus an hour and a half out is a plan, not a departure. */
const NEXT_VIEW_HORIZON_MIN = 60;

/** Departures for one line and destination, so "when does my line come" needs no reading past the others. */
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

const tint = (color: string) => ({ '--line': color }) as CSSProperties;

export function StopArrivalsView({ selectedStop, onSelectLine, onViewOnMap, onSelectStop, onBack, isFavorite, onToggleFavorite, viaQr }: StopArrivalsViewProps) {
  const t = useT();
  const lang = useLang();
  const [arrivals, setArrivals] = useState<StopArrival[]>([]);
  const [view, setView] = useState<'next' | 'byLine'>('next');
  /** A time to read the board at, or '' for now — the question the night before. */
  const [atTime, setAtTime] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  /** Set when the clipboard refused, so the link is shown instead of "Copied" being claimed. */
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);

  /** "Tell me before the bus gets here": one watch per line, checked on the board's own refresh. Fires once. */
  const [watches, setWatches] = useState<Record<string, number>>({});
  const firedRef = useRef<Set<string>>(new Set());
  const [firedMessage, setFiredMessage] = useState<string | null>(null);

  /** Computed once: a timezone does not change while somebody reads a bus board. */
  const clockDrift = useMemo(() => clockDriftFromTimetable(), []);
  /** Close enough that picking the wrong one is a real mistake, not a different trip. */
  const polesNearby = useMemo(() => getNearbyStops(selectedStop.lat, selectedStop.lng).filter((s) => s.id !== selectedStop.id && s.walkMeters <= 350).slice(0, 8), [selectedStop]);
  const timingPoints = timingPointStopCount();

  const toggleWatch = async (lineId: string) => {
    setWatches((prev) => {
      const next = { ...prev };
      if (next[lineId] === WATCH_LEAD_MINUTES) delete next[lineId];
      else next[lineId] = WATCH_LEAD_MINUTES;
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
      if (lead === undefined || firedRef.current.has(arrival.lineId) || arrival.etaMinutes > lead) continue;
      firedRef.current.add(arrival.lineId);
      const message = t.arrivals.watchFired(arrival.lineNumber, arrival.etaMinutes, selectedStop.name);
      setFiredMessage(message);
      ringAlarm();
      notify(t.arrivals.watchTitle, message);
    }
  }, [arrivals, watches, selectedStop.name]);

  // Alarm for "wake me when I am nearly at my stop". It belongs to one stop.
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
  useEffect(() => stopAlarm, []);
  useEffect(() => {
    if (alarmOn) stopAlarm();
  }, [selectedStop.id]);
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

  // Recomputed every 15 s because the minutes count down against the wall clock; nothing is fetched, so no "last updated".
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
    if (atTime) return; // a named time does not move
    const interval = setInterval(read, 15000);
    return () => clearInterval(interval);
  }, [selectedStop.id, atTime]);

  /** Lines that pass close by but do not call here: with a long wait, two minutes' walk can be the answer. */
  const nearbyLines = useMemo(() => {
    const here = new Set(selectedStop.lines);
    return getNearbyLines(selectedStop.lat, selectedStop.lng, NEARBY_LINE_RADIUS_M)
      .filter((n) => !here.has(n.line.id))
      .sort((a, b) => a.walkMeters - b.walkMeters)
      .slice(0, NEARBY_LINE_LIMIT);
  }, [selectedStop]);

  const nextService = useMemo(() => (arrivals.length === 0 ? nextServiceAtStop(selectedStop.id) : null), [arrivals.length, selectedStop.id]);

  /** Grouped by line and destination, in the order printed on the poles and the buses. */
  const groups = useMemo<LineGroup[]>(() => {
    const byKey = new Map<string, LineGroup>();
    for (const a of arrivals) {
      const key = `${a.lineId}|${a.destination}`;
      const group = byKey.get(key);
      if (group) group.departures.push(a);
      else byKey.set(key, { key, lineId: a.lineId, lineNumber: a.lineNumber, lineColor: a.lineColor, destination: a.destination, departures: [a], headwayMinutes: null });
    }
    for (const group of byKey.values()) {
      // Two departures give one gap, a sample of one; from three, the median says something.
      if (group.departures.length < 3) continue;
      const gaps = group.departures.slice(1).map((d, i) => d.etaMinutes - group.departures[i].etaMinutes).sort((a, b) => a - b);
      group.headwayMinutes = Math.round(gaps[Math.floor(gaps.length / 2)]);
    }
    return [...byKey.values()].sort((a, b) => a.lineNumber.localeCompare(b.lineNumber, 'es', { numeric: true }) || a.destination.localeCompare(b.destination, 'es'));
  }, [arrivals]);

  // Asked for only on a QR arrival; `undefined` on every other visit, so the hook does not fetch at all.
  const operatorTimes = useOperatorTimes(viaQr ? (poleCode(selectedStop) ?? undefined) : undefined);
  const nonePublished = arrivals.length > 0 && arrivals.every((a) => a.precision === 'estimated');
  const anyOverdue = arrivals.some((a) => a.overdueMinutes);

  /** A report with the identifiers already filled in: asking somebody at the pole to copy them is asking them not to bother. */
  const reportUrl = newIssueUrl(
    `Parada: ${selectedStop.name}`,
    [t.arrivals.reportPosition, '', `- ${selectedStop.name}`, `- id: ${selectedStop.id}`, `- ${t.map.stopCode}: ${poleCode(selectedStop) ?? '—'}`, `- ${selectedStop.lat.toFixed(5)}, ${selectedStop.lng.toFixed(5)}`, ''].join('\n'),
  );

  const withinHour = arrivals.filter((a) => a.etaMinutes <= NEXT_VIEW_HORIZON_MIN);
  // Never a blank board: when the next bus is more than an hour out, that one bus is what someone at the pole needs.
  const soon = withinHour.length > 0 ? withinHour : arrivals.slice(0, 1);
  const beyondCount = arrivals.length - soon.length;

  // `navigator.clipboard` does not exist on a non-secure origin and `writeText` can reject; only say "Copied" if it worked.
  const copyShareLink = async () => {
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

  /** Minutes, with the tilde carrying "derived" in the figure; overdue is quieter, the least certain thing on the screen. */
  const Minutes = ({ arrival }: { arrival: StopArrival }) => (
    <span className={`tnum shrink-0 text-num font-bold tracking-[-0.025em] ${arrival.overdueMinutes ? 'text-ink-3' : arrival.etaMinutes === 0 ? 'text-accent' : 'text-ink-max'}`}>
      {arrival.overdueMinutes ? (
        <span className="text-emph">{t.common.overdue(arrival.overdueMinutes)}</span>
      ) : arrival.etaMinutes === 0 ? (
        <span className="text-emph">{t.common.arrivingNow}</span>
      ) : (
        <>
          {arrival.precision === 'estimated' && <span className="text-ink-3">~</span>}
          {arrival.etaMinutes}
        </>
      )}
    </span>
  );
  const provenance = (a: StopArrival) => <Provenance precision={a.precision} extra={a.etaTime} title={a.precision === 'published' ? t.arrivals.publishedHint : t.arrivals.estimatedHint} />;
  // The line is in the name, not only on the badge: fourteen in a row read as "7, button".
  const lineButton = (id: string, number: string, color: string) => (
    <LineBadge
      number={number}
      color={color}
      aria-label={`${t.arrivals.seeLine} ${number}`}
      onClick={() => {
        const line = lineById(id);
        if (line) onSelectLine(line);
      }}
    />
  );
  const watchButton = (a: StopArrival) =>
    !atTime && a.etaMinutes > WATCH_LEAD_MINUTES ? (
      <button
        onClick={() => toggleWatch(a.lineId)}
        title={t.arrivals.watchHint(WATCH_LEAD_MINUTES)}
        aria-pressed={watches[a.lineId] !== undefined}
        className={`flex h-11 items-center gap-1.5 rounded-control border px-3 text-label font-semibold ${watches[a.lineId] !== undefined ? 'border-warn bg-warn text-warn-ink' : 'border-edge text-ink-2'}`}
      >
        <Bell className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        {watches[a.lineId] !== undefined ? t.arrivals.watchOn : t.arrivals.watchCta(WATCH_LEAD_MINUTES)}
      </button>
    ) : null;
  const minUnit = (a: StopArrival) => a.etaMinutes > 0 && <span className="shrink-0 self-end pb-1 text-label text-ink-2">{t.common.min}</span>;

  return (
    <div className="mx-auto w-full max-w-3xl px-3.5 pb-8 pt-4">
      <button onClick={onBack} className="-ml-1 mb-1 flex h-11 items-center gap-1.5 pr-3 text-body font-medium text-ink-2 lg:hidden">
        <ArrowLeft className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        {t.arrivals.back}
      </button>

      <header className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-title font-semibold tracking-[-0.012em]">{selectedStop.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {poleCode(selectedStop) && <span className="tnum rounded bg-surface px-2 py-1 text-label font-medium text-ink-2">{poleCode(selectedStop)}</span>}
            <span className="text-label text-ink-3">
              {selectedStop.zone} · {t.common.lines(selectedStop.lines.length)}
              {selectedStop.shelter === true ? ` · ${t.arrivals.shelter}` : ''}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <IconButton icon={Star} label={isFavorite ? t.arrivals.unfav : t.arrivals.fav} on={isFavorite} fill={isFavorite} onClick={() => onToggleFavorite(selectedStop.id)} />
          <IconButton icon={MapIcon} label={t.arrivals.map} onClick={() => onViewOnMap(selectedStop)} />
          <IconButton icon={Bell} label={alarmOn ? t.arrivals.alarmOn : t.arrivals.alarmCta} title={t.arrivals.alarmHelp} on={alarmOn} onClick={toggleAlarm} />
          <button onClick={copyShareLink} aria-label={copiedLink ? t.arrivals.copied : t.arrivals.share} className="flex h-11 w-11 items-center justify-center rounded-control border border-edge bg-surface text-ink-2">
            {copiedLink ? <Check className="h-4.5 w-4.5 text-official" strokeWidth={2.4} aria-hidden="true" /> : <Share2 className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />}
          </button>
          {/* The tick is the confirmation for the eye; this is the one for the ear. */}
          <span role="status" className="sr-only">
            {copiedLink ? t.arrivals.copied : ''}
          </span>
        </div>
      </header>

      {/* By time when you will take whatever comes, by line when you are waiting for one in particular. */}
      <Segmented
        variant="outline"
        className="border-b border-line py-3"
        value={view}
        onChange={setView}
        options={[
          { id: 'next', label: t.arrivals.viewNext, title: t.arrivals.viewNextHint },
          { id: 'byLine', label: t.arrivals.viewByLine, title: t.arrivals.viewByLineHint },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-line py-3">
        <label className="flex items-center gap-2 text-label font-semibold text-ink-2">
          <Clock className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="shrink-0">{t.arrivals.atTimeLabel}</span>
          <input type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} className="h-11 rounded-control border border-edge bg-bg px-2 font-mono text-body text-ink" />
        </label>
        {atTime && (
          <button onClick={() => setAtTime('')} className="h-11 rounded-control border border-edge px-3 text-label font-semibold text-ink-2">
            {t.arrivals.backToNow}
          </button>
        )}
      </div>

      {/* Folded, directly under the toggle: at a stop with fourteen lines the list runs past the fold. */}
      {nearbyLines.length > 0 && (
        <details className="mt-3 rounded-control border border-edge bg-surface">
          <summary className="flex h-11 cursor-pointer items-center gap-2 px-3 text-label font-semibold text-ink-2">
            {t.arrivals.nearbyLinesTitle}
            <span className="tnum rounded-control border border-edge px-1.5 py-0.5 text-ink-3">{nearbyLines.length}</span>
          </summary>
          <div className="px-3 pb-3">
            <p className="text-label text-ink-3">{t.arrivals.nearbyLinesHint}</p>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {nearbyLines.map(({ line, nearestStop, walkMeters }) => (
                <li key={line.id} style={tint(line.color)} className="tint tint-edge flex items-center gap-3 rounded-control border px-2.5 py-2">
                  {lineButton(line.id, line.number, line.color)}
                  <span className="min-w-0 flex-1">
                    <span title={nearestStop.name} className="block truncate text-body font-semibold">
                      {nearestStop.name}
                    </span>
                    <span className="block text-label text-ink-2">~{Math.round(walkMeters)} m</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {/* Every row below is a scheduled passing for an hour the reader chose, and the countdown counts from that hour. */}
      {atTime && <Notice>{t.arrivals.showingAt(atTime)}</Notice>}

      {(alarmOn || alarmError) && (
        <Notice role={alarmFired ? 'alert' : undefined}>
          {alarmError ? (
            alarmError
          ) : alarmFired ? (
            <span className="font-semibold">{t.arrivals.alarmFired(selectedStop.name)}</span>
          ) : (
            <>
              {t.arrivals.alarmWatching(ALARM_RADIUS_M)}
              {alarmDistance !== null && <span className="tnum ml-1 font-semibold">({alarmDistance} m)</span>}
              <span className="mt-1 block text-ink-3">{t.arrivals.alarmForeground}</span>
            </>
          )}
        </Notice>
      )}

      {copyFailedUrl && (
        <Notice>
          {t.arrivals.copyFailed} <span className="tnum block break-all pt-1 text-ink select-all">{copyFailedUrl}</span>
        </Notice>
      )}

      {clockDrift !== 0 && (
        <Notice warn role="alert">
          {t.arrivals.clockDrift((clockDrift > 0 ? t.arrivals.clockAhead : t.arrivals.clockBehind)(formatDriftHours(Math.abs(clockDrift))), deviceTimeZone())}
        </Notice>
      )}

      {firedMessage && (
        <div role="alert" className="mt-3 flex items-start justify-between gap-3 rounded-control bg-official p-3 text-label font-semibold text-on-official">
          <span>{firedMessage}</span>
          <button onClick={() => setFiredMessage(null)} aria-label={t.arrivals.dismiss} className="shrink-0 underline">
            ✕
          </button>
        </div>
      )}

      {/* What the operator says, only for somebody who arrived by scanning the pole: for them it is the thing they were reaching for, not a second opinion. A label and a number: their `towards` is a route description six words long. */}
      {operatorTimes && operatorTimes.departures.length > 0 && (
        <section className="mt-4 rounded-card border border-edge bg-surface/60 p-3.5">
          <h3 className="text-label font-bold uppercase tracking-wider text-ink-2">{t.arrivals.operatorSaysTitle}</h3>
          <ul className="mt-2 space-y-1.5">
            {operatorTimes.departures.map((departure, i) => (
              <li key={`${departure.line}-${i}`} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-body font-bold text-ink">{operatorLineLabel(departure.line)}</span>
                <span className="tnum shrink-0 font-mono font-black text-ink">
                  {departure.minutes} {t.common.min}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-label leading-relaxed text-ink-3">{t.arrivals.operatorSaysNote(new Date(operatorTimes.fetchedAt).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' }))}</p>
        </section>
      )}

      {/* Not a live region: the minute tick moved every row's count at once and announced fifteen bare numbers. */}
      {arrivals.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-edge px-5 py-10 text-center">
          <Clock className="mx-auto mb-3 h-7 w-7 text-ink-3" strokeWidth={1.6} aria-hidden="true" />
          <p className="text-body text-ink-2">{atTime ? t.arrivals.noneAtTime(atTime) : t.arrivals.noArrivals}</p>
          {nextService && <p className="mt-2 text-body font-semibold">{t.arrivals.nextServiceAt(nextService.lineNumber, nextService.time, nextService.destination)}</p>}
        </div>
      ) : view === 'next' ? (
        <ul className="mt-1">
          {soon.map((a, idx) => (
            <li key={`${a.lineId}-${a.etaTime}-${idx}`} className="border-b border-line px-3 py-3.5">
              <div className="flex items-center gap-3">
                {lineButton(a.lineId, a.lineNumber, a.lineColor)}
                <span title={a.destination} className="min-w-0 flex-1 truncate text-emph font-semibold">
                  {a.destination}
                </span>
                <Minutes arrival={a} />
                {minUnit(a)}
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
        <ul className="mt-3 flex flex-col gap-2.5">
          {groups.map((g) => (
            <li key={g.key} className="tint tint-edge overflow-hidden rounded-card border" style={tint(g.lineColor)}>
              <div className="flex items-center gap-3 p-3">
                {lineButton(g.lineId, g.lineNumber, g.lineColor)}
                <span className="min-w-0 flex-1">
                  <span title={g.destination} className="block truncate text-emph font-semibold">
                    {g.destination}
                  </span>
                  {g.headwayMinutes !== null && <span className="mt-0.5 block text-label text-ink-3">{t.arrivals.every(g.headwayMinutes)}</span>}
                </span>
                <Minutes arrival={g.departures[0]} />
                {minUnit(g.departures[0])}
              </div>
              {/* The rest of this line's departures, so "I'll catch the one after" needs no second tap. */}
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

      {view === 'next' && beyondCount > 0 && <p className="mt-3 text-label text-ink-3">{t.arrivals.beyond(beyondCount)}</p>}
      {Object.keys(watches).length > 0 && <Notice>{t.arrivals.watchForeground}</Notice>}

      {/* Drawn above the question it serves: the other poles nearby are how you tell which one is yours. */}
      <section className="mt-4 border-t border-line pt-3">
        <h2 className="text-label font-semibold text-ink-2">{t.arrivals.stopMapTitle}</h2>
        <div className="mt-2 overflow-hidden rounded-control border border-edge">
          <LazyNearbyMiniMap centre={{ lat: selectedStop.lat, lng: selectedStop.lng, label: selectedStop.name, kind: 'stop' }} stops={polesNearby} onSelectStop={onSelectStop} regionLabel={t.arrivals.stopMapRegion} />
        </div>
      </section>

      <details className="mt-4 border-t border-line pt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-label font-semibold text-ink-2">{t.arrivals.reportPosition}</summary>
        <p className="text-label leading-relaxed text-ink-3">{t.arrivals.positionChecked}</p>
        <p className="mt-1.5 text-label leading-relaxed text-ink-3">{t.arrivals.reportNotCouncil}</p>
        <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-label font-semibold text-accent underline">
          {t.arrivals.reportCta}
        </a>
      </details>

      {anyOverdue && <p className="mt-4 border-t border-line pt-3.5 text-label leading-relaxed text-ink-3">{t.common.overdueNote}</p>}

      {nonePublished ? (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="flex h-11 cursor-pointer items-center text-label font-semibold text-ink-2">{t.arrivals.whyEstimatedTitle}</summary>
          <p className="pb-1 text-label leading-relaxed text-ink-3">{t.arrivals.whyEstimated(timingPoints.published, timingPoints.total)}</p>
        </details>
      ) : (
        arrivals.length > 0 && <p className="mt-4 border-t border-line pt-3.5 text-label leading-relaxed text-ink-3">{t.arrivals.precisionNote}</p>
      )}
    </div>
  );
}
