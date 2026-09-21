import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '../../i18n';
import { BUS_LINES } from '../../data/transitData';
import type { BusLine } from '../../types';

interface LineChipsProps {
  /** The lines the strip shows: the scope's, or all of them. */
  listed: BusLine[];
  /** The ids drawn on the map right now; none means all of them. */
  picked: string[];
  onToggle: (line: BusLine) => void;
  onAll: () => void;
}

const chip = 'pointer-events-auto flex h-11 shrink-0 items-center rounded-full border shadow-sm backdrop-blur-xs';

/** The numbers more than one line answers to (four are numbered 11), so only those chips carry a branch name. */
const sharedNumbers = (() => {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const line of BUS_LINES) (seen.has(line.number) ? shared : seen).add(line.number);
  return shared;
})();

/** The far end of a line's name, without its own number and without the parenthetical naming the stop. */
const destinationOf = (line: BusLine) => {
  let end = line.name.split(' - ').pop()?.trim() ?? '';
  if (end.endsWith(` ${line.number}`)) end = end.slice(0, -line.number.length - 1).trim();
  const paren = end.indexOf(' (');
  return paren > 0 ? end.slice(0, paren) : end;
};

/**
 * The strip of line chips that rides over the map below `lg`, where the controls column
 * is a viewport away: which line you are looking at cannot wait that long. It owns whether
 * it is unfolded and asks the map for two things only: toggle a line, show them all.
 */
export function LineChips({ listed, picked, onToggle, onAll }: LineChipsProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  // Asking for a line is asking to see it: whatever covers the map gets out of the way.
  // Keyed on the picked set rather than the tap, so a line picked from the sheet folds it too.
  useEffect(() => setExpanded(false), [picked]);
  const branches = useMemo(() => new Map(listed.map((line) => [line.id, sharedNumbers.has(line.number) ? destinationOf(line) : ''])), [listed]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[400] lg:hidden">
      <div className={`no-scrollbar flex gap-1.5 px-3 py-2.5 ${expanded ? 'max-h-[45dvh] flex-wrap overflow-y-auto' : 'overflow-x-auto'}`}>
        <button type="button" onClick={onAll} aria-pressed={picked.length === 0} className={`${chip} px-4 text-label font-semibold ${picked.length === 0 ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-bg/95 text-ink-2'}`}>
          {t.map.allLines}
        </button>
        {/* Second, not last: at the end of a row that scrolls, "stop making me scroll" is only reachable by scrolling. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? t.map.collapseLines : t.map.expandLines}
          title={expanded ? t.map.collapseLines : t.map.expandLines}
          className={`${chip} gap-1 border-edge bg-bg/95 px-3.5 text-label font-bold text-ink-2`}
        >
          <span className="tnum">{listed.length}</span>
          <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {/* The number is the chip; the name goes to the accessible name. */}
        {listed.map((line) => {
          const isSelected = picked.includes(line.id);
          const branch = branches.get(line.id);
          return (
            <button
              key={line.id}
              type="button"
              onClick={() => onToggle(line)}
              aria-pressed={isSelected}
              aria-label={line.name}
              title={line.name}
              className={`pointer-events-auto flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-label font-black text-white shadow-sm ${isSelected ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''}`}
              style={{ backgroundColor: line.color }}
            >
              <span>{line.number}</span>
              {branch && <span className="max-w-28 truncate font-semibold opacity-90">{branch}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
