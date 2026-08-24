import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bus, Calendar, ChevronRight, Clock, MapPin, Route, Star } from 'lucide-react';
import { Lang, translations } from '../i18n';
import { BusLine, BusStop, ScheduledBus } from '../types';
import { BUS_LINES, BUS_STOPS, poleCode } from '../data/transitData';
import { getScheduledBuses } from '../utils/transitEngine';
import { buildRuns, dayKind, formatMinutes, minutesNow } from '../utils/schedule';
import { daysLabel, frequencyLabel } from '../utils/serviceLabels';
import { MAX_QUERY_LENGTH, matchesQuery } from '../utils/searchUtils';

/** The categories the dataset actually uses, in the order the lines declare them. */
const CATEGORIES = [...new Set(BUS_LINES.map((l) => l.category))];

const FILTER_ON = 'bg-ink border-ink text-bg';
const FILTER_OFF = 'border-edge text-ink-2';

/** How often the drawn positions are recomputed. They come from the timetable, not GPS. */
const TICK_MS = 3000;

interface LinesViewProps {
  selectedLine: BusLine | null;
  onSelectLine: (line: BusLine) => void;
  onSelectStop: (stop: BusStop) => void;
  onViewLineOnMap: (line: BusLine) => void;
  favoriteLineIds?: string[];
  onToggleFavoriteLine?: (lineId: string) => void;
  lang: Lang;
}

export const LinesView: React.FC<LinesViewProps> = ({
  selectedLine,
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

  const direction = currentLine.directions[directionIndex] || currentLine.directions[0];

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
          <div className="rounded-xl border border-edge bg-bg p-4 lg:p-5">
            <div className="mb-4">
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
                  className={`flex h-11 items-center whitespace-nowrap rounded-[9px] border px-3.5 text-label font-semibold ${categoryFilter === category ? FILTER_ON : FILTER_OFF}`}
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
              className="my-3 h-11 w-full rounded-[9px] border border-edge bg-surface px-3.5 text-body text-ink placeholder:text-ink-3 focus:outline-none"
            />

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {visibleLines.map((line) => {
                const isCurrent = currentLine.id === line.id;
                const isFavourite = favoriteLineIds.includes(line.id);
                const running = buses.filter((b) => b.lineId === line.id);

                return (
                  <div
                    key={line.id}
                    id={`line-card-${line.id}`}
                    onClick={() => {
                      onSelectLine(line);
                      setDirectionIndex(0);
                      setShowDetail(true);
                    }}
                    style={{ '--line': line.color } as React.CSSProperties}
                    className={`tint tint-strong p-3.5 rounded-lg cursor-pointer border transition-all flex items-center justify-between gap-3 ${isCurrent ? 'border-accent shadow-xs' : 'tint-edge'}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-10 h-10 rounded-md flex items-center justify-center font-black text-white text-body shadow-xs shrink-0"
                        style={{ backgroundColor: line.color }}
                      >
                        {line.number}
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-body text-ink leading-tight flex items-center gap-1.5 truncate">
                          <span className="truncate">{line.name}</span>
                          {isFavourite && (
                            <Star className="w-3.5 h-3.5 fill-current text-warn-ink shrink-0" />
                          )}
                        </div>
                        <div className="text-label text-ink-2 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{frequencyLabel(line, lang)}</span>
                          <span>&bull;</span>
                          <span>{daysLabel(line, lang)}</span>
                          {running.length > 0 && (
                            <span
                              title={t.lines.enRouteHint}
                              className="flex items-center gap-0.5 text-ink-2 font-bold text-label bg-surface px-1.5 py-0.2 rounded border border-edge"
                            >
                              <Bus className="w-2.5 h-2.5 text-ink-3" />
                              {t.lines.enRoute(running.length)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`w-5 h-5 transition-transform shrink-0 ${isCurrent ? 'text-accent translate-x-0.5' : 'text-ink-3'}`}
                    />
                  </div>
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
            <ArrowLeft className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
            {t.lines.backToLines}
          </button>

          <div className="bg-bg rounded-xl p-6 shadow-sm border border-edge">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-line">
              <div className="flex items-center gap-4">
                <span
                  className="w-14 h-14 rounded-lg flex items-center justify-center font-black text-white text-title shadow-sm shrink-0"
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
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border ${favoriteLineIds.includes(currentLine.id) ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-bg text-ink-2'}`}
                    title={
                      favoriteLineIds.includes(currentLine.id)
                        ? t.lines.unsaveLine
                        : t.lines.saveLine
                    }
                  >
                    <Star
                      className="h-[19px] w-[19px]"
                      strokeWidth={1.8}
                      fill={favoriteLineIds.includes(currentLine.id) ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                  </button>
                )}
                <button
                  id="btn-view-line-map"
                  onClick={() => onViewLineOnMap(currentLine)}
                  className="flex h-11 items-center gap-1.5 rounded-[9px] bg-accent px-4 text-body font-semibold text-on-accent"
                >
                  <MapPin className="w-4 h-4" />
                  <span>{t.lines.viewOnMap}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              <div className="p-3 rounded-md bg-surface border border-line">
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3 mb-1">
                  <Clock className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.frequency}</span>
                </div>
                <div className="text-body font-semibold">{frequencyLabel(currentLine, lang)}</div>
              </div>
              <div className="p-3 rounded-md bg-surface border border-line">
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3 mb-1">
                  <Calendar className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.days}</span>
                </div>
                <div className="text-body font-semibold">{daysLabel(currentLine, lang)}</div>
              </div>
              <div className="p-3 rounded-md bg-surface border border-line col-span-2 sm:col-span-1">
                <div className="flex items-center gap-1.5 text-label font-bold text-ink-3 mb-1">
                  <Bus className="w-3.5 h-3.5 text-accent" />
                  <span>{t.lines.serviceHours}</span>
                </div>
                <div className="font-bold text-body text-ink font-mono">
                  {currentLine.firstDeparture} - {currentLine.lastDeparture}
                </div>
              </div>
            </div>

            <p className="text-label text-ink-2 mt-3 bg-surface/50 p-3 rounded-md border border-line">
              {currentLine.description}
            </p>
          </div>

          <div className="bg-bg rounded-xl p-5 shadow-sm border border-edge">
            <h3 className="font-bold text-ink text-label uppercase tracking-wider mb-2.5 flex items-center gap-2">
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

          <div className="bg-bg rounded-xl p-6 shadow-sm border border-edge">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
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
                      {dir.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {shownRun ? (
              <div className="flex items-center justify-between gap-3 mb-4 p-2.5 rounded-lg bg-surface border border-edge">
                <button
                  onClick={() => setPickedRunIndex(Math.max(0, runIndex - 1))}
                  disabled={runIndex === 0}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] border border-edge bg-bg text-body font-semibold text-ink-2 disabled:opacity-40"
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
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] border border-edge bg-bg text-body font-semibold text-ink-2 disabled:opacity-40"
                >
                  &rarr;
                </button>
              </div>
            ) : (
              <div className="mb-4 p-2.5 rounded-lg bg-surface border border-edge text-label font-semibold text-ink-2">
                {t.lines.noRunsToday}
              </div>
            )}

            <div className="relative pl-6 space-y-3.5 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-surface">
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
                    className="relative group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
                  >
                    <div
                      className={`absolute -left-6 top-2.5 w-5 h-5 rounded-full border-2 border-white shadow-xs flex items-center justify-center transition-transform group-hover:scale-125 ${busHere ? 'bg-official ring-2 ring-official animate-pulse' : isFirst || isLast ? 'bg-accent ring-2 ring-accent' : 'bg-ink-3 group-hover:bg-ink-2'}`}
                    />
                    <div
                      className={`p-3 rounded-lg border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${busHere ? 'bg-surface/80 border-edge ring-1 ring-official/50 shadow-xs' : 'bg-bg border-line hover:border-edge hover:bg-surface/40 shadow-xs'}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-body text-ink group-hover:text-accent transition-colors">
                            {stop.name}
                          </span>
                          {isFirst && (
                            <span className="text-label font-bold px-1.5 py-0.5 rounded bg-surface text-accent">
                              {t.lines.origin}
                            </span>
                          )}
                          {isLast && (
                            <span className="text-label font-bold px-1.5 py-0.5 rounded bg-ink text-bg">
                              {t.lines.destination}
                            </span>
                          )}
                        </div>
                        <div className="text-label text-ink-3 mt-0.5">
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

                      <div className="flex items-center gap-2.5 self-end sm:self-center flex-wrap">
                        {busHere ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-official text-on-official text-label font-bold shadow-xs">
                            <Bus className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{t.lines.busScheduledHere}</span>
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

                        <span className="text-label font-bold text-accent opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
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
