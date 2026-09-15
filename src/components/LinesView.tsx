import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bus,
  Calendar,
  ChevronRight,
  Clock,
  MapPin,
  Route,
  Star,
  TriangleAlert,
} from 'lucide-react';
import { Lang, translations } from '../i18n';
import { BusLine, BusStop, ScheduledBus } from '../types';
import { BUS_LINES, BUS_STOPS, poleCode } from '../data/transitData';
import { getScheduledBuses } from '../utils/vehicles';
import { buildRuns, dayKind, formatMinutes, minutesNow, scheduledDuration } from '../utils/schedule';
import { daysLabel, directionLabel, frequencyLabel } from '../utils/serviceLabels';
import { MAX_QUERY_LENGTH, matchesQuery } from '../utils/searchUtils';

/** The categories the dataset actually uses, in the order the lines declare them. */
const CATEGORIES = [...new Set(BUS_LINES.map((l) => l.category))];

const FILTER_ON = 'bg-ink border-ink text-bg';
const FILTER_OFF = 'border-edge text-ink-2';

/** How often the drawn positions are recomputed. They come from the timetable, not GPS. */
const TICK_MS = 3000;

interface LinesViewProps {
  selectedLine: BusLine | null;
  /** Bumped whenever somebody asked for a line, as opposed to for this tab. */
  lineRequest?: number;
  onSelectLine: (line: BusLine) => void;
  onSelectStop: (stop: BusStop) => void;
  onViewLineOnMap: (line: BusLine) => void;
  favoriteLineIds?: string[];
  onToggleFavoriteLine?: (lineId: string) => void;
  lang: Lang;
}

export const LinesView: React.FC<LinesViewProps> = ({
  selectedLine,
  lineRequest = 0,
  onSelectLine,
  onSelectStop,
  onViewLineOnMap,
  favoriteLineIds = [],
  onToggleFavoriteLine,
  lang,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [directionIndex, setDirectionIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  /** Below lg the two columns are one screen at a time: list, then the line. */
  const [showDetail, setShowDetail] = useState(false);
  const [buses, setBuses] = useState<ScheduledBus[]>([]);
  /**
   * A plain clock tick. "Which run is on the road now" is a function of the time, so it
   * has to be recomputed even when nothing the user did changed.
   */
  const [tick, setTick] = useState(0);

  const currentLine = selectedLine || BUS_LINES[0];

  /**
   * A line picked somewhere else opens here.
   *
   * Only below lg, where the two columns are one screen at a time; above it the detail
   * already sits beside the list and this changes nothing. The count is what carries the
   * intent — this view is mounted when the tab opens, so by its first render the line is
   * already selected whether anybody asked for it or just tapped Líneas.
   */
  useEffect(() => {
    if (!lineRequest) return;
    setDirectionIndex(0);
    setShowDetail(true);
  }, [lineRequest]);

  useEffect(() => {
    const update = () => {
      setBuses(getScheduledBuses());
      setTick((n) => n + 1);
    };
    update();
    const timer = setInterval(update, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const t = translations(lang);
  const query = searchQuery.trim();

  const visibleLines = BUS_LINES.filter((line) => {
    const inCategory = categoryFilter === 'all' || line.category === categoryFilter;
    const matches =
      !query ||
      matchesQuery(line.number, query) ||
      matchesQuery(line.name, query) ||
      matchesQuery(line.description, query);
    return inCategory && matches;
  });

  // The index actually being shown: the selector can point past the end after a line
  // with fewer directions is chosen, and the card falls back to the first.
  const directionIdx = currentLine.directions[directionIndex] ? directionIndex : 0;
  const direction = currentLine.directions[directionIdx];

  const runs = useMemo(
    () =>
      buildRuns(
        currentLine,
        Math.max(0, currentLine.directions.indexOf(direction)),
        BUS_STOPS,
        dayKind(new Date()),
      ),
    [currentLine, direction],
  );

  /** Set when the reader steps through the timetable by hand; null means "follow the clock". */
  const [pickedRunIndex, setPickedRunIndex] = useState<number | null>(null);

  const currentRunIndex = useMemo(() => {
    const now = minutesNow();
    const running = runs.findIndex(
      (r) =>
        r.minutesByStopIndex[0] <= now &&
        r.minutesByStopIndex[r.minutesByStopIndex.length - 1] >= now,
    );
    if (running >= 0) return running;
    // Nothing on the road: show the next one out, or the last of the day once it is over.
    const next = runs.findIndex((r) => r.minutesByStopIndex[0] >= now);
    return next >= 0 ? next : Math.max(0, runs.length - 1);
  }, [runs, tick]);

  const runIndex = Math.min(pickedRunIndex ?? currentRunIndex, Math.max(0, runs.length - 1));
  const shownRun = runs[runIndex];

  // A hand-picked run belongs to the line and direction it was picked in.
  useEffect(() => setPickedRunIndex(null), [currentLine.id, direction.id]);

  const busesOnLine = buses.filter(
    (b) => b.lineId === currentLine.id && (b.direction === direction.id || currentLine.directions.length === 1),
  );

  const departures = runs.map((r) => formatMinutes(r.minutesByStopIndex[0]));

  return (
    <div className="mx-auto h-full w-full max-w-7xl px-3.5 py-4 lg:px-6 lg:pb-0">
      <div className="lg:grid lg:h-full lg:grid-cols-12 lg:gap-6">
        <div
          className={`space-y-4 lg:col-span-5 lg:block lg:h-full lg:overflow-y-auto lg:pb-4 ${showDetail ? 'hidden' : ''}`}
        >
          <div className="space-y-4 bg-bg rounded-card border border-edge p-4 lg:p-5">
            <div>
              <h2 className="font-bold text-ink text-body uppercase tracking-wider flex items-center gap-2">
                <Route className="w-4 h-4 text-accent" />
                {t.lines.title}
              </h2>
              <p className="text-label text-ink-3 mt-0.5">{t.lines.subtitle}</p>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar">
              {['all', ...CATEGORIES].map((category) => (
                <button
                  key={category}
                  onClick={() => setCategoryFilter(category)}
                  aria-pressed={categoryFilter === category}
                  className={`flex h-11 items-center whitespace-nowrap rounded-control border px-3.5 text-label font-semibold ${categoryFilter === category ? FILTER_ON : FILTER_OFF}`}
                >
                  {t.lines.categories[category as keyof typeof t.lines.categories] || category}
                </button>
              ))}
            </div>

            <input
              id="search-line-input"
              type="text"
              maxLength={MAX_QUERY_LENGTH}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.lines.searchLines}
              aria-label={t.lines.searchLines}
              className="h-11 w-full rounded-control border border-edge bg-surface px-3.5 text-body text-ink placeholder:text-ink-3 focus:outline-none"
            />

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {visibleLines.map((line) => {
                const isCurrent = currentLine.id === line.id;
                const isFavourite = favoriteLineIds.includes(line.id);
                const running = buses.filter((b) => b.lineId === line.id);

                return (
                  <button
                    key={line.id}
                    type="button"
                    id={`line-card-${line.id}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => {
                      onSelectLine(line);
                      setDirectionIndex(0);
                      setShowDetail(true);
                    }}
                    style={{ '--line': line.color } as React.CSSProperties}
                    className={`tint tint-strong w-full px-3 py-2.5 rounded-control cursor-pointer border transition-all flex items-center justify-between gap-2.5 text-left ${isCurrent ? 'border-accent shadow-xs' : 'tint-edge'}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-9 h-9 rounded-md flex items-center justify-center font-black text-white text-body shadow-xs shrink-0"
                        style={{ backgroundColor: line.color }}
                      >
                        {line.number}
                      </span>
                      <div className="min-w-0">
                        {/* Keep the end of the name, not the beginning.
                            The names are "A - B" and A is shared: nine distinct openings
                            across twenty-four lines, so 1.1, 1.2 and 1.4 all truncated to
                            "Opuesto Piscina Pedreira…" and the list asked the reader to
                            open each one to find out which was which. The far end is the
                            half that varies -- seventeen distinct -- so it is the half
                            that must survive a narrow row. The whole name is still on the
                            row's own tooltip. */}
                        <div
                          className="font-bold text-body text-ink leading-tight flex items-baseline gap-1.5 min-w-0"
                          title={line.name}
                        >
                          <span className="hidden truncate text-ink-2 font-semibold sm:inline">
                            {line.name.split(' - ').slice(0, -1).join(' - ')}
                          </span>
                          <span className="hidden shrink-0 sm:inline" aria-hidden="true">–</span>
                          <span className="truncate">{line.name.split(' - ').slice(-1)[0]}</span>
                          {isFavourite && (
                            <Star className="w-3.5 h-3.5 fill-current text-warn-ink shrink-0 self-center" />
                          )}
                        </div>
                        <div className="text-label text-ink-2 mt-0.5 flex min-w-0 items-center gap-2">
                          <span className="shrink-0">{frequencyLabel(line, lang)}</span>
                          <span className="shrink-0">&bull;</span>
                          <span className="truncate">{daysLabel(line, lang)}</span>
                          {running.length > 0 && (
                            <span
                              title={t.lines.enRouteHint}
                              className="flex shrink-0 items-center gap-0.5 text-ink-2 font-bold text-label bg-surface px-1.5 py-0.2 rounded border border-edge"
                            >
                              {/* The bus and the count, not the sentence. "1 en ruta" is
                                  45 px of a 253 px line, and it was taking them off the
                                  service days -- which is the only thing separating 1.2
                                  from 1.4, both "Opuesto Piscina Pedreiras - HULA". The
                                  words stay for a screen reader and on the tooltip. */}
                              <Bus className="w-2.5 h-2.5 text-ink-3" aria-hidden="true" />
                              <span aria-hidden="true">{running.length}</span>
                              <span className="sr-only">{t.lines.enRoute(running.length)}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`w-5 h-5 transition-transform shrink-0 ${isCurrent ? 'text-accent translate-x-0.5' : 'text-ink-3'}`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className={`space-y-4 lg:col-span-7 lg:block lg:h-full lg:overflow-y-auto lg:pb-4 ${showDetail ? '' : 'hidden'}`}
        >
          <button
            onClick={() => setShowDetail(false)}
            className="-ml-1 flex h-11 items-center gap-1.5 pr-3 text-body font-medium text-ink-2 lg:hidden"
          >
            <ArrowLeft className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t.lines.backToLines}
          </button>

          <div className="space-y-4 bg-bg rounded-card p-6 shadow-sm border border-edge">
            <div className="flex flex-col justify-between gap-4 border-b border-line pb-5 xl:flex-row xl:items-center">
              <div className="flex items-center gap-4">
                <span
                  className="w-14 h-14 rounded-control flex items-center justify-center font-black text-white text-title shadow-sm shrink-0"
                  style={{ backgroundColor: currentLine.color }}
                >
                  {currentLine.number}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-label font-bold px-2 py-0.5 rounded bg-surface text-ink-2 uppercase tracking-wider">
                      {t.lines.lineLabel(currentLine.number)}
                    </span>
                    {currentLine.category === 'hospital' && (
                      <span className="text-label font-bold px-2 py-0.5 rounded bg-warn text-warn-ink">
                        {t.lines.categories.hospital}
                      </span>
                    )}
                    {busesOnLine.length > 0 && (
                      <span
                        title={t.lines.enRouteHint}
                        className="text-label font-bold px-2 py-0.5 rounded bg-surface text-ink-2 flex items-center gap-1 border border-edge"
                      >
                        <Bus className="w-3 h-3 text-ink-3" />
                        {t.lines.enRoute(busesOnLine.length)}
                      </span>
                    )}
                  </div>
                  <h2 className="text-emph font-bold text-ink mt-1">{currentLine.name}</h2>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                {onToggleFavoriteLine && (
                  <button
                    onClick={() => onToggleFavoriteLine(currentLine.id)}
                    aria-pressed={favoriteLineIds.includes(currentLine.id)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control border ${favoriteLineIds.includes(currentLine.id) ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-bg text-ink-2'}`}
                    title={
                      favoriteLineIds.includes(currentLine.id)
                        ? t.lines.unsaveLine
                        : t.lines.saveLine
                    }
                  >
                    <Star
                      className="h-4.5 w-4.5"
                      strokeWidth={1.8}
                      fill={favoriteLineIds.includes(currentLine.id) ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                  </button>
                )}
                <button
                  id="btn-view-line-map"
                  onClick={() => onViewLineOnMap(currentLine)}
                  // min-h rather than h: at a narrow column width the label wraps to two
                  // lines, and a fixed 44 px box let the second line spill out of the
                  // button. The floor is the touch target; the ceiling is the content.
                  className="flex min-h-11 items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-body font-semibold text-on-accent"
                >
                  <MapPin className="w-4 h-4" />
                  <span>{t.lines.viewOnMap}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-line bg-surface/50 p-3 sm:grid-cols-3">
              <div>
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3">
                  <Clock className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.frequency}</span>
                </div>
                <div className="text-body font-semibold">{frequencyLabel(currentLine, lang)}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3">
                  <Calendar className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.days}</span>
                </div>
                <div className="text-body font-semibold">{daysLabel(currentLine, lang)}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3">
                  <Bus className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.serviceHours}</span>
                </div>
                <div className="font-bold text-body text-ink font-mono">
                  {currentLine.firstDeparture} - {currentLine.lastDeparture}
                </div>
              </div>

            {/* Three more things the dataset has always known and the page never said.
                They belong to the direction, not the line, so they change with the
                selector — but they are still six facts about one line, and two bordered
                blocks with a gap between them cost the border, the padding and the gap
                twice to say so. */}
              <div>
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3">
                  <Route className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.routeLength}</span>
                </div>
                <div className="font-bold text-body text-ink font-mono">
                  {t.lines.kilometres((direction.totalMeters / 1000).toFixed(1))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3">
                  <MapPin className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.routeStops}</span>
                </div>
                <div className="font-bold text-body text-ink font-mono">{direction.stops.length}</div>
              </div>
              <div title={t.lines.routeDurationHint}>
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3">
                  <Clock className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.routeDuration}</span>
                </div>
                <div className="font-bold text-body text-ink font-mono">
                  {(() => {
                    const minutes = scheduledDuration(currentLine, directionIdx, BUS_STOPS);
                    return minutes === undefined
                      ? t.lines.routeDurationUnknown
                      : `${minutes} ${t.common.min}`;
                  })()}
                </div>
              </div>
            </div>

            {/* The line's `description` used to be printed here. It is built by the
                generator as "name. days. frequency." out of the operator's own Spanish,
                so on the Galician screen it said "Todos los días" three lines under a
                grid already saying "Todos os días" — the same three facts, once
                translated and once not. The field stays: the search matches against it. */}

            {direction.geometrySource && direction.geometrySource !== 'osm' && (
              <p className="flex gap-2 rounded-md border border-line bg-surface/50 p-3 text-label leading-relaxed text-ink-2">
                <TriangleAlert
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span>
                  <span className="font-semibold text-ink">{t.lines.approximatePathTitle}.</span>{' '}
                  {t.lines.approximatePath}
                </span>
              </p>
            )}
          </div>

          <div className="bg-bg rounded-card p-5 shadow-sm border border-edge">
            <h3 className="font-bold text-ink text-label uppercase tracking-wider mb-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent" />
              {t.lines.scheduleTable} &mdash; {direction.origin.slice(0, 28)} ({departures.length})
            </h3>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {departures.map((time, idx) => (
                <button
                  key={idx}
                  onClick={() => setPickedRunIndex(idx)}
                  title={t.lines.viewRunAt(time)}
                  className={`tnum flex h-11 items-center justify-center rounded-[7px] border px-2.5 text-label font-semibold ${idx === runIndex ? 'border-ink bg-ink text-bg' : 'border-edge text-ink-2'}`}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 bg-bg rounded-card p-6 shadow-sm border border-edge">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-ink text-body uppercase tracking-wider flex items-center gap-2">
                  <Route className="w-4 h-4 text-accent" />
                  {t.lines.stopsInDirection} ({direction.stops.length})
                </h3>
                <div className="text-label text-ink-3 mt-0.5">
                  {direction.origin} &rarr; {direction.destination}
                </div>
              </div>
              {currentLine.directions.length > 1 && (
                <div className="flex rounded-md bg-surface p-0.5 border border-edge self-start sm:self-auto">
                  {currentLine.directions.map((dir, idx) => (
                    <button
                      key={dir.id}
                      onClick={() => setDirectionIndex(idx)}
                      className={`px-3 py-1.5 rounded text-label font-bold transition-all ${directionIndex === idx ? 'bg-bg text-ink shadow-xs' : 'text-ink-2 hover:text-ink'}`}
                    >
                      {directionLabel(dir, lang)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {shownRun ? (
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-control bg-surface border border-edge">
                <button
                  onClick={() => setPickedRunIndex(Math.max(0, runIndex - 1))}
                  disabled={runIndex === 0}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-edge bg-bg text-body font-semibold text-ink-2 disabled:opacity-40"
                >
                  &larr;
                </button>
                <div className="text-center leading-tight">
                  <div className="text-label font-bold text-accent uppercase tracking-widest">
                    {t.lines.showingRun}
                  </div>
                  <div className="text-body font-black text-accent font-mono">
                    {formatMinutes(shownRun.minutesByStopIndex[0])}
                    <span className="text-accent font-bold text-label ml-1.5" title={t.lines.estimatedHint}>
                      &rarr; ~
                      {formatMinutes(
                        shownRun.minutesByStopIndex[shownRun.minutesByStopIndex.length - 1],
                      )}
                    </span>
                  </div>
                  <div className="text-label text-accent font-semibold">
                    {t.lines.runOf(runIndex + 1, runs.length)}
                    {runIndex !== currentRunIndex && (
                      <button
                        onClick={() => setPickedRunIndex(null)}
                        className="ml-1.5 underline font-bold"
                      >
                        {t.lines.backToNow}
                      </button>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setPickedRunIndex(Math.min(runs.length - 1, runIndex + 1))}
                  disabled={runIndex >= runs.length - 1}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-edge bg-bg text-body font-semibold text-ink-2 disabled:opacity-40"
                >
                  &rarr;
                </button>
              </div>
            ) : (
              <div className="p-2.5 rounded-control bg-surface border border-edge text-label font-semibold text-ink-2">
                {t.lines.noRunsToday}
              </div>
            )}

            <div className="relative pl-6 space-y-1.5 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-surface">
              {direction.stops.map((stopId, idx) => {
                const stop = BUS_STOPS.find((s) => s.id === stopId);
                if (!stop) return null;

                const isFirst = idx === 0;
                const isLast = idx === direction.stops.length - 1;
                const busHere = busesOnLine.find((b) => b.nextStopId === stop.id);
                const passingMinutes = shownRun?.minutesByStopIndex[idx];
                const relativeMinutes =
                  passingMinutes === undefined ? null : Math.round(passingMinutes - minutesNow());

                return (
                  <div
                    key={stop.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectStop(stop)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectStop(stop);
                      }
                    }}
                    aria-label={`${stop.name}. ${passingMinutes === undefined ? t.lines.noService : formatMinutes(passingMinutes)}`}
                    className="relative group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-control"
                  >
                    <div
                      className={`absolute -left-6 top-2.5 w-5 h-5 rounded-full border-2 border-white shadow-xs flex items-center justify-center transition-transform group-hover:scale-125 ${busHere ? 'bg-estimated ring-2 ring-estimated animate-pulse' : isFirst || isLast ? 'bg-accent ring-2 ring-accent' : 'bg-ink-3 group-hover:bg-ink-2'}`}
                    />
                    <div
                      className={`px-3 py-2 rounded-control border transition-all flex items-center justify-between gap-2.5 ${busHere ? 'bg-surface/80 border-edge ring-1 ring-official/50 shadow-xs' : 'bg-bg border-line hover:border-edge hover:bg-surface/40 shadow-xs'}`}
                    >
                      <div className="min-w-0 flex-1">
                        {/* The stop name is not shortened.
                            Squeezing the row to one line cut the longer names in half,
                            and the name is the only thing on
                            the row a reader has to match against a pole. Wrapping costs a
                            few pixels on the long ones; truncating costs the answer. */}
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                          <span className="font-bold text-body text-ink transition-colors group-hover:text-accent">
                            {stop.name}
                          </span>
                          {isFirst && (
                            <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-label font-bold text-accent">
                              {t.lines.origin}
                            </span>
                          )}
                          {isLast && (
                            <span className="shrink-0 rounded bg-ink px-1.5 py-0.5 text-label font-bold text-bg">
                              {t.lines.destination}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-label text-ink-3">
                          {stop.zone}
                          {poleCode(stop) && (
                            <>
                              {' '}
                              &bull; {t.lines.codeShort}{' '}
                              <span className="font-mono font-bold text-ink-2">{poleCode(stop)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2.5">
                        {busHere ? (
                          <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-official px-1.5 py-1 text-label font-bold text-on-official shadow-xs">
                            <Bus className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">{t.lines.busScheduledHere}</span>
                            <span className="sr-only sm:hidden">{t.lines.busScheduledHere}</span>
                          </div>
                        ) : null}

                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface border border-edge text-ink font-mono text-label font-bold shrink-0">
                          <Clock className="w-3.5 h-3.5 text-accent" />
                          <span>
                            {passingMinutes === undefined ? (
                              <span className="text-ink-3 font-semibold">{t.lines.noService}</span>
                            ) : relativeMinutes !== null && relativeMinutes < 0 ? (
                              <span className="text-ink-3">
                                {formatMinutes(passingMinutes)} &middot; {t.lines.passed}
                              </span>
                            ) : relativeMinutes === 0 ? (
                              <span className="text-official font-extrabold">{t.lines.nowAt}</span>
                            ) : (
                              <span>
                                {!shownRun?.publishedStopIndices.includes(idx) && (
                                  <span className="text-ink-3" title={t.lines.estimatedHint}>
                                    ~
                                  </span>
                                )}
                                {relativeMinutes} min ({formatMinutes(passingMinutes)})
                              </span>
                            )}
                          </span>
                        </div>

                        <span className="hidden whitespace-nowrap text-label font-bold text-accent opacity-0 transition-opacity group-hover:opacity-100 sm:inline">
                          {t.lines.viewStop} &rarr;
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
