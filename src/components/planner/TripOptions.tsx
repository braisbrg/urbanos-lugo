import { Fragment, useState } from 'react';
import { ChevronDown, Footprints } from 'lucide-react';
import { useT } from '../../i18n';
import type { RoutePlanResult } from '../../types';
import { LONG_WAIT_MIN } from '../../utils/planner';
import { LineBadge } from '../ui/LineBadge';
import { withMeasuredWalk, type WalkCorrection } from './walkCorrection';

/** How many alternatives stand on the screen before you ask for the rest: the answer and the one somebody would weigh. */
const VISIBLE_OPTIONS = 2;

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
  const [showAll, setShowAll] = useState(false);
  const [shownFor, setShownFor] = useState(resetKey);
  if (shownFor !== resetKey) {
    setShownFor(resetKey);
    setShowAll(false);
  }
  // Never fold away the row that is currently open.
  const expanded = showAll || chosen >= VISIBLE_OPTIONS;
  const visible = expanded ? options : options.slice(0, VISIBLE_OPTIONS);

  return (
    <div>
      <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">{t.planner.optionsTitle}</span>
      <div className="border-y border-line">
        {visible.map(({ option, idx }) => {
          const busLegs = option.segments.filter((seg) => seg.type === 'bus');
          const shown = withMeasuredWalk(option, correctionFor(option));
          // The row draws the change ("6 → 4.2"); the words stay for a screen reader.
          const notes = shown.reachable
            ? [option.totalWaitMinutes > 0 && option.totalWaitMinutes <= LONG_WAIT_MIN ? t.planner.waitShort(option.totalWaitMinutes) : '', busLegs.length === 0 ? t.planner.noWaitNoFare : ''].filter(Boolean)
            : [];
          return (
            <button
              key={idx}
              onClick={() => onChoose(idx)}
              aria-pressed={idx === chosen}
              className={`grid min-h-11 w-full grid-cols-[auto_1fr_auto] items-center gap-2.5 border-l-[3px] py-1.5 pl-2 pr-1 text-left transition-colors ${idx > 0 ? 'border-t border-t-line' : ''} ${
                idx === chosen ? 'border-l-ink bg-surface text-ink' : 'border-l-transparent text-ink'
              }`}
            >
              <span className="flex items-center gap-1">
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
              <span className="min-w-0">
                <span className="tnum block font-mono text-label font-semibold text-ink">
                  {shown.departure} → ~{shown.arrival}
                </span>
                {notes.length > 0 && <span className="block text-label text-ink-3">{notes.join(' · ')}</span>}
                {!shown.reachable && <span className="block truncate text-label font-semibold text-warn-ink">{t.planner.unreachableWalk}</span>}
                {busLegs.length > 1 && <span className="sr-only">{t.planner.transfersShort(busLegs.length - 1)}</span>}
              </span>
              <span className={`tnum shrink-0 font-mono text-body ${idx === chosen ? 'font-black' : 'font-bold text-ink-2'}`}>{shown.durationMinutes} min</span>
            </button>
          );
        })}
        {options.length > VISIBLE_OPTIONS && chosen < VISIBLE_OPTIONS && (
          <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={expanded} className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-t-line text-label font-semibold text-ink-3">
            {expanded ? t.planner.fewerOptions : t.planner.moreOptions(options.length - VISIBLE_OPTIONS)}
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${expanded ? 'rotate-180' : ''}`} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
