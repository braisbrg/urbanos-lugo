import { Fragment, useState } from 'react';
import { ChevronDown, Footprints } from 'lucide-react';
import { useLang, useT } from '../../i18n';
import type { RoutePlanResult } from '../../types';
import { LONG_WAIT_MIN } from '../../utils/planner';
import { dayWord } from '../../utils/serviceLabels';
import { LineBadge } from '../ui/LineBadge';
import { withMeasuredWalk, type WalkCorrection } from './walkCorrection';

/** How many alternatives stand on the screen before you ask for the rest: the answer and the one somebody would weigh. */
const VISIBLE_OPTIONS = 2;

/**
 * A row is keyed by its trip, not by its number in the list: the rows are re-ranked once the
 * walks are measured and replanned once when one cannot be caught, and a reused key keeps its
 * node, and a focused reader's place, under a different trip.
 */
const tripKey = (option: RoutePlanResult) =>
  option.segments
    .filter((seg) => seg.type === 'bus')
    .map((seg) => `${seg.line?.id}/${seg.directionId}@${seg.fromStop?.id}`)
    .join('>') || 'walk';

interface TripOptionsProps {
  options: { option: RoutePlanResult; idx: number }[];
  chosen: number;
  onChoose: (idx: number) => void;
  /** The same correction the detail applies, so the row you open agrees with what opens. */
  correctionFor: (plan: RoutePlanResult) => WalkCorrection;
  /** Bumped on every new question, so the short list comes back. */
  resetKey: number;
}

/**
 * The alternatives, as rows rather than cards: badges, clock and duration land in the same
 * place on every row, which is what makes them comparable at a glance. The clock leads —
 * once departures stopped being "now", it is what distinguishes them.
 */
export function TripOptions({ options, chosen, onChoose, correctionFor, resetKey }: TripOptionsProps) {
  const t = useT();
  const lang = useLang();
  const [showAll, setShowAll] = useState(false);
  const [shownFor, setShownFor] = useState(resetKey);
  if (shownFor !== resetKey) {
    setShownFor(resetKey);
    setShowAll(false);
  }
  // Never fold away the row that is currently open: by where it stands in the list, which is
  // not its number once the rows are ranked on the measured walks.
  const openAt = options.findIndex((o) => o.idx === chosen);
  const expanded = showAll || openAt >= VISIBLE_OPTIONS;

  const row = ({ option, idx }: (typeof options)[number]) => {
    const busLegs = option.segments.filter((seg) => seg.type === 'bus');
    const shown = withMeasuredWalk(option, correctionFor(option));
    // The row draws the change ("6 → 4.2"); the words stay for a screen reader.
    const notes = shown.reachable
      ? [option.totalWaitMinutes > 0 && option.totalWaitMinutes <= LONG_WAIT_MIN ? t.planner.waitShort(option.totalWaitMinutes) : '', busLegs.length === 0 ? t.planner.noWaitNoFare : ''].filter(Boolean)
      : [];
    return (
      <button
        key={tripKey(option)}
        onClick={() => onChoose(idx)}
        aria-pressed={idx === chosen}
        className={`grid min-h-11 w-full grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 border-l-[3px] py-1.5 pl-2 pr-1 text-left @min-[18rem]:grid-cols-[auto_1fr_auto] transition-colors ${idx > 0 ? 'border-t border-t-line' : ''} ${
          idx === chosen ? 'border-l-ink bg-surface text-ink' : 'border-l-transparent text-ink'
        }`}
      >
        <span className="flex flex-wrap items-center gap-1">
          {busLegs.length === 0 ? (
            <span className="flex items-center gap-1 text-label font-bold">
              <Footprints className="h-3.5 w-3.5" />
              {t.planner.walkOnly}
            </span>
          ) : (
            busLegs.map((seg, k) => (
              <Fragment key={k}>
                {k > 0 && <span className="text-label text-ink-3">→</span>}
                <LineBadge number={seg.line?.number ?? ''} color={seg.line?.color ?? ''} size="sm" className="h-auto min-w-0 font-black" />
              </Fragment>
            ))
          )}
        </span>
        <span className="col-span-2 row-start-2 min-w-0 @min-[18rem]:col-span-1 @min-[18rem]:row-start-auto">
          <span className="tnum block font-mono text-label font-semibold text-ink">
            {/* Not today: the day goes before the clock, or "07:00" reads as this morning's. */}
            {!!option.daysAhead && <span className="mr-1.5 font-sans text-estimated">{dayWord(lang, option.daysAhead)}</span>}
            {shown.departure} → ~{shown.arrival}
          </span>
          {notes.length > 0 && <span className="block text-label text-ink-3">{notes.join(' · ')}</span>}
          {/* The one thing on the row that must be read whole: it was cut to "Co paseo medido xa ...". */}
          {!shown.reachable && <span className="block text-label font-semibold text-warn-ink">{t.planner.unreachableWalk}</span>}
          {busLegs.length > 1 && <span className="sr-only">{t.planner.transfersShort(busLegs.length - 1)}</span>}
        </span>
        <span className={`tnum shrink-0 justify-self-end whitespace-nowrap font-mono text-body @min-[18rem]:justify-self-auto ${idx === chosen ? 'font-black' : 'font-bold text-ink-2'}`}>{shown.durationMinutes} min</span>
      </button>
    );
  };

  return (
    <div>
      <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">{t.planner.optionsTitle}</span>
      {/* A container, so a row can tell when it is narrow for its text: below 18rem the clocks go
          under the lines and the duration. Between the two at 200% text the clocks ran 88 px out
          of their column and "Co paseo medido xa non chegas a este bus" was printed over the
          minutes; on a 320 px phone at the default size that sentence took four lines. */}
      <div className="@container border-y border-line">
        {options.slice(0, VISIBLE_OPTIONS).map(row)}
        {/* The rest fold open rather than appearing, and the rows underneath slide instead of jumping. */}
        {options.length > VISIBLE_OPTIONS && (
          <div className={`fold ${expanded ? '' : 'fold-closed'}`}>
            <div>{options.slice(VISIBLE_OPTIONS).map(row)}</div>
          </div>
        )}
        {options.length > VISIBLE_OPTIONS && openAt < VISIBLE_OPTIONS && (
          <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={expanded} className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-t-line text-label font-semibold text-ink-3">
            {expanded ? t.planner.fewerOptions : t.planner.moreOptions(options.length - VISIBLE_OPTIONS)}
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
