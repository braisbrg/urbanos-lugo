import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, Bus, Calendar, ChevronRight, Clock, MapPin, Route, Star, TriangleAlert } from 'lucide-react';
import { useLang, useT } from '../i18n';
import { BusLine, BusStop } from '../types';
import { BUS_LINES, BUS_STOPS, poleCode, stopById } from '../data/transitData';
import { getScheduledBuses } from '../utils/vehicles';
import { buildRuns, dayKind, formatMinutes, minutesNow, scheduledDuration } from '../utils/schedule';
import { daysLabel, directionLabel, frequencyLabel } from '../utils/serviceLabels';
import { MAX_QUERY_LENGTH, matchesQuery } from '../utils/searchUtils';
import { IconButton, Segmented } from './ui/controls';
import { useClock } from '../hooks/useClock';

/** The categories the dataset actually uses, in the order the lines declare them. */
const CATEGORIES = [...new Set(BUS_LINES.map((l) => l.category))];
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
}

/** One fact about the line: an icon, a label and the value. */
function Fact({ icon: Icon, label, children, title }: { icon: typeof Clock; label: string; children: ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="flex items-center gap-1.5 text-label font-bold text-ink-3">
        <Icon className="w-3.5 h-3.5 text-accent" />
        <span>{label}</span>
      </div>
      <div className="font-bold text-body text-ink font-mono">{children}</div>
    </div>
  );
}

export function LinesView({ selectedLine, lineRequest = 0, onSelectLine, onSelectStop, onViewLineOnMap, favoriteLineIds = [], onToggleFavoriteLine }: LinesViewProps) {
  const t = useT();
  const lang = useLang();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [directionIndex, setDirectionIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  /** Below lg the two columns are one screen at a time: list, then the line. */
  const [showDetail, setShowDetail] = useState(false);
  /** "Which run is on the road now" is a function of the time, so it follows the clock. */
  const now = useClock(TICK_MS);
  const buses = useMemo(() => getScheduledBuses(now), [now]);

  const currentLine = selectedLine || BUS_LINES[0];

  // A line picked somewhere else opens here — only below lg, where the columns take turns.
  useEffect(() => {
    if (!lineRequest) return;
    setDirectionIndex(0);
    setShowDetail(true);
  }, [lineRequest]);

  const query = searchQuery.trim();
  const visibleLines = BUS_LINES.filter(
    (line) => (categoryFilter === 'all' || line.category === categoryFilter) && (!query || matchesQuery(line.number, query) || matchesQuery(line.name, query) || matchesQuery(line.description, query)),
  );

  // The selector can point past the end after a line with fewer directions is chosen.
  const directionIdx = currentLine.directions[directionIndex] ? directionIndex : 0;
  const direction = currentLine.directions[directionIdx];
  const runs = useMemo(() => buildRuns(currentLine, directionIdx, BUS_STOPS, dayKind(new Date())), [currentLine, directionIdx]);

  /** Set when the reader steps through the timetable by hand; null means "follow the clock". */
  const [pickedRunIndex, setPickedRunIndex] = useState<number | null>(null);
  const currentRunIndex = useMemo(() => {
    const now = minutesNow();
    const running = runs.findIndex((r) => r.minutesByStopIndex[0] <= now && r.minutesByStopIndex[r.minutesByStopIndex.length - 1] >= now);
    if (running >= 0) return running;
    // Nothing on the road: the next one out, or the last of the day once it is over.
    const next = runs.findIndex((r) => r.minutesByStopIndex[0] >= now);
    return next >= 0 ? next : Math.max(0, runs.length - 1);
  }, [runs, now]);
  const runIndex = Math.min(pickedRunIndex ?? currentRunIndex, Math.max(0, runs.length - 1));
  const shownRun = runs[runIndex];
  // A hand-picked run belongs to the line and direction it was picked in.
  useEffect(() => setPickedRunIndex(null), [currentLine.id, direction.id]);

  const busesOnLine = buses.filter((b) => b.lineId === currentLine.id && (b.direction === direction.id || currentLine.directions.length === 1));
  const departures = runs.map((r) => formatMinutes(r.minutesByStopIndex[0]));
  const isSaved = favoriteLineIds.includes(currentLine.id);
  const duration = scheduledDuration(currentLine, directionIdx, BUS_STOPS);

  return (
    <div className="mx-auto h-full w-full max-w-7xl px-3.5 py-4 lg:px-6 lg:pb-0">
      <div className="lg:grid lg:h-full lg:grid-cols-12 lg:gap-6">
        <div className={`space-y-4 lg:col-span-5 lg:block lg:h-full lg:overflow-y-auto lg:pb-4 ${showDetail ? 'hidden' : ''}`}>
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
                  className={`flex h-11 items-center whitespace-nowrap rounded-control border px-3.5 text-label font-semibold ${categoryFilter === category ? 'bg-ink border-ink text-bg' : 'border-edge text-ink-2'}`}
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
                const running = buses.filter((b) => b.lineId === line.id).length;
                const parts = line.name.split(' - ');
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
                    style={{ '--line': line.color } as CSSProperties}
                    className={`tint tint-strong w-full px-3 py-2.5 rounded-control cursor-pointer border transition-all flex items-center justify-between gap-2.5 text-left ${isCurrent ? 'border-accent shadow-xs' : 'tint-edge'}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-9 h-9 rounded-md flex items-center justify-center font-black text-white text-body shadow-xs shrink-0" style={{ backgroundColor: line.color }}>
                        {line.number}
                      </span>
                      <div className="min-w-0">
                        {/* Keep the end of the name, not the beginning: nine distinct openings across twenty-four lines, seventeen distinct endings. */}
                        <div className="font-bold text-body text-ink leading-tight flex items-baseline gap-1.5 min-w-0" title={line.name}>
                          <span className="hidden truncate text-ink-2 font-semibold sm:inline">{parts.slice(0, -1).join(' - ')}</span>
                          <span className="hidden shrink-0 sm:inline" aria-hidden="true">
                            –
                          </span>
                          <span className="truncate">{parts[parts.length - 1]}</span>
                          {favoriteLineIds.includes(line.id) && <Star className="w-3.5 h-3.5 fill-current text-warn-ink shrink-0 self-center" />}
                        </div>
                        <div className="text-label text-ink-2 mt-0.5 flex min-w-0 items-center gap-2">
                          <span className="shrink-0">{frequencyLabel(line, lang)}</span>
                          <span className="shrink-0">&bull;</span>
                          <span className="truncate">{daysLabel(line, lang)}</span>
                          {running > 0 && (
                            <span title={t.lines.enRouteHint} className="flex shrink-0 items-center gap-0.5 text-ink-2 font-bold text-label bg-surface px-1.5 py-0.2 rounded border border-edge">
                              <Bus className="w-2.5 h-2.5 text-ink-3" aria-hidden="true" />
                              <span aria-hidden="true">{running}</span>
                              <span className="sr-only">{t.lines.enRoute(running)}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 transition-transform shrink-0 ${isCurrent ? 'text-accent translate-x-0.5' : 'text-ink-3'}`} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className={`space-y-4 lg:col-span-7 lg:block lg:h-full lg:overflow-y-auto lg:pb-4 ${showDetail ? '' : 'hidden'}`}>
          <button onClick={() => setShowDetail(false)} className="-ml-1 flex h-11 items-center gap-1.5 pr-3 text-body font-medium text-ink-2 lg:hidden">
            <ArrowLeft className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t.lines.backToLines}
          </button>

          <div className="space-y-4 bg-bg rounded-card p-6 shadow-sm border border-edge">
            <div className="flex flex-col justify-between gap-4 border-b border-line pb-5 xl:flex-row xl:items-center">
              <div className="flex items-center gap-4">
                <span className="w-14 h-14 rounded-control flex items-center justify-center font-black text-white text-title shadow-sm shrink-0" style={{ backgroundColor: currentLine.color }}>
                  {currentLine.number}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-label font-bold px-2 py-0.5 rounded bg-surface text-ink-2 uppercase tracking-wider">{t.lines.lineLabel(currentLine.number)}</span>
                    {currentLine.category === 'hospital' && <span className="text-label font-bold px-2 py-0.5 rounded bg-warn text-warn-ink">{t.lines.categories.hospital}</span>}
                    {busesOnLine.length > 0 && (
                      <span title={t.lines.enRouteHint} className="text-label font-bold px-2 py-0.5 rounded bg-surface text-ink-2 flex items-center gap-1 border border-edge">
                        <Bus className="w-3 h-3 text-ink-3" />
                        {t.lines.enRoute(busesOnLine.length)}
                      </span>
                    )}
                  </div>
                  <h2 className="text-emph font-bold text-ink mt-1">{currentLine.name}</h2>
                </div>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                {onToggleFavoriteLine && <IconButton icon={Star} label={isSaved ? t.lines.unsaveLine : t.lines.saveLine} title={isSaved ? t.lines.unsaveLine : t.lines.saveLine} on={isSaved} fill={isSaved} onClick={() => onToggleFavoriteLine(currentLine.id)} />}
                {/* min-h rather than h: at a narrow column the label wraps to two lines. */}
                <button id="btn-view-line-map" onClick={() => onViewLineOnMap(currentLine)} className="flex min-h-11 items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-body font-semibold text-on-accent">
                  <MapPin className="w-4 h-4" />
                  <span>{t.lines.viewOnMap}</span>
                </button>
              </div>
            </div>

            {/* Six facts about one line; the last three belong to the direction and change with the selector. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-line bg-surface/50 p-3 sm:grid-cols-3">
              <Fact icon={Clock} label={t.lines.frequency}>
                <span className="font-sans font-semibold">{frequencyLabel(currentLine, lang)}</span>
              </Fact>
              <Fact icon={Calendar} label={t.lines.days}>
                <span className="font-sans font-semibold">{daysLabel(currentLine, lang)}</span>
              </Fact>
              <Fact icon={Bus} label={t.lines.serviceHours}>
                {currentLine.firstDeparture} - {currentLine.lastDeparture}
              </Fact>
              <Fact icon={Route} label={t.lines.routeLength}>
                {t.lines.kilometres((direction.totalMeters / 1000).toFixed(1))}
              </Fact>
              <Fact icon={MapPin} label={t.lines.routeStops}>
                {direction.stops.length}
              </Fact>
              <Fact icon={Clock} label={t.lines.routeDuration} title={t.lines.routeDurationHint}>
                {duration === undefined ? t.lines.routeDurationUnknown : `${duration} ${t.common.min}`}
              </Fact>
            </div>

            {direction.geometrySource && direction.geometrySource !== 'osm' && (
              <p className="flex gap-2 rounded-md border border-line bg-surface/50 p-3 text-label leading-relaxed text-ink-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
                <span>
                  <span className="font-semibold text-ink">{t.lines.approximatePathTitle}.</span> {t.lines.approximatePath}
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
                <Segmented
                  className="self-start sm:self-auto border border-edge"
                  options={currentLine.directions.map((dir, idx) => ({ id: String(idx), label: directionLabel(dir, lang) }))}
                  value={String(directionIndex)}
                  onChange={(idx) => setDirectionIndex(Number(idx))}
                />
              )}
            </div>

            {shownRun ? (
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-control bg-surface border border-edge">
                <button onClick={() => setPickedRunIndex(Math.max(0, runIndex - 1))} disabled={runIndex === 0} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-edge bg-bg text-body font-semibold text-ink-2 disabled:opacity-40">
                  &larr;
                </button>
                <div className="text-center leading-tight">
                  <div className="text-label font-bold text-accent uppercase tracking-widest">{t.lines.showingRun}</div>
                  <div className="text-body font-black text-accent font-mono">
                    {formatMinutes(shownRun.minutesByStopIndex[0])}
                    <span className="text-accent font-bold text-label ml-1.5" title={t.lines.estimatedHint}>
                      &rarr; ~{formatMinutes(shownRun.minutesByStopIndex[shownRun.minutesByStopIndex.length - 1])}
                    </span>
                  </div>
                  <div className="text-label text-accent font-semibold">
                    {t.lines.runOf(runIndex + 1, runs.length)}
                    {runIndex !== currentRunIndex && (
                      <button onClick={() => setPickedRunIndex(null)} className="ml-1.5 underline font-bold">
                        {t.lines.backToNow}
                      </button>
                    )}
                  </div>
                </div>
                <button onClick={() => setPickedRunIndex(Math.min(runs.length - 1, runIndex + 1))} disabled={runIndex >= runs.length - 1} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-edge bg-bg text-body font-semibold text-ink-2 disabled:opacity-40">
                  &rarr;
                </button>
              </div>
            ) : (
              <div className="p-2.5 rounded-control bg-surface border border-edge text-label font-semibold text-ink-2">{t.lines.noRunsToday}</div>
            )}

            <div className="relative pl-6 space-y-1.5 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-surface">
              {direction.stops.map((stopId, idx) => {
                const stop = stopById(stopId);
                if (!stop) return null;
                const isFirst = idx === 0;
                const isLast = idx === direction.stops.length - 1;
                const busHere = busesOnLine.some((b) => b.nextStopId === stop.id);
                const passingMinutes = shownRun?.minutesByStopIndex[idx];
                const relativeMinutes = passingMinutes === undefined ? null : Math.round(passingMinutes - minutesNow());
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
                      className={`absolute -left-6 top-2.5 w-5 h-5 rounded-full border-2 border-white shadow-xs flex items-center justify-center transition-transform group-hover:scale-125 ${
                        busHere ? 'bg-estimated ring-2 ring-estimated animate-pulse' : isFirst || isLast ? 'bg-accent ring-2 ring-accent' : 'bg-ink-3 group-hover:bg-ink-2'
                      }`}
                    />
                    <div className={`px-3 py-2 rounded-control border transition-all flex items-center justify-between gap-2.5 ${busHere ? 'bg-surface/80 border-edge ring-1 ring-official/50 shadow-xs' : 'bg-bg border-line hover:border-edge hover:bg-surface/40 shadow-xs'}`}>
                      <div className="min-w-0 flex-1">
                        {/* The stop name is not shortened: it is the only thing on the row a reader has to match against a pole. */}
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                          <span className="font-bold text-body text-ink transition-colors group-hover:text-accent">{stop.name}</span>
                          {isFirst && <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-label font-bold text-accent">{t.lines.origin}</span>}
                          {isLast && <span className="shrink-0 rounded bg-ink px-1.5 py-0.5 text-label font-bold text-bg">{t.lines.destination}</span>}
                        </div>
                        <div className="mt-0.5 truncate text-label text-ink-3">
                          {stop.zone}
                          {poleCode(stop) && (
                            <>
                              {' '}
                              &bull; {t.lines.codeShort} <span className="font-mono font-bold text-ink-2">{poleCode(stop)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5">
                        {busHere && (
                          <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-official px-1.5 py-1 text-label font-bold text-on-official shadow-xs">
                            <Bus className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">{t.lines.busScheduledHere}</span>
                            <span className="sr-only sm:hidden">{t.lines.busScheduledHere}</span>
                          </div>
                        )}
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
                        <span className="hidden whitespace-nowrap text-label font-bold text-accent opacity-0 transition-opacity group-hover:opacity-100 sm:inline">{t.lines.viewStop} &rarr;</span>
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
}
