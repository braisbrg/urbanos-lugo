import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Lang, translations } from '../../i18n';
import { BusLine } from '../../types';

/**
 * The strip of line chips that rides over the map on a phone.
 *
 * The map is the whole screen on a phone, and that put every control in the column
 * below it a full viewport out of reach. Two of them cannot wait that long: which line
 * you are looking at, and where you are standing. This is the first; it rides over the
 * map below `lg` and hands back to the sidebar above it.
 *
 * Its own file because it is the one piece of the map's furniture that stands alone: it
 * owns whether it is unfolded, it derives what it needs from the lines it is given, and
 * it asks the map for two things only -- toggle a line, show them all. The rest of the
 * controls sheet stays where it is; twenty props would be the same complexity moved.
 *
 * This corner is where the legend used to float, and the legend is not coming back: it
 * named stops, buses and trazados, which is exactly what the three layer buttons in the
 * sidebar already name, each with its own icon in its own colour. A second copy of those
 * three words, sitting on top of the map and covering it, was the redundant one.
 */
interface LineChipsProps {
  lang: Lang;
  /** Every line, for telling apart the ones that share a number. */
  lines: BusLine[];
  /** The lines the strip shows: the scope's, or all of them. */
  listed: BusLine[];
  /** The ids drawn on the map right now; none means all of them. */
  picked: string[];
  onToggle: (line: BusLine) => void;
  onAll: () => void;
}

export const LineChips: React.FC<LineChipsProps> = ({ lang, lines, listed, picked, onToggle, onAll }) => {
  const t = translations(lang);
  const [expanded, setExpanded] = useState(false);
  // Asking for a line is asking to see it: whatever is covering the map gets out of the
  // way. Keyed on the picked set rather than on the tap, so a line picked from the sheet
  // folds the grid too.
  useEffect(() => setExpanded(false), [picked]);

  /**
   * The numbers that more than one line answers to.
   *
   * Four of the twenty-four are numbered 11 — Pías, Igrexa de Bóveda, Calde and Santa
   * Comba — and the operator paints all four the same brown. In the sidebar rows that
   * is fine: the row carries the full name beside the badge. On a chip, which is the
   * badge and nothing else, it came out as four identical brown 11s in a row, asking
   * the reader to memorise that the third one is Calde.
   *
   * Derived rather than written down, so a branch added or dropped upstream keeps up.
   */
  const sharedNumbers = useMemo(() => {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const line of lines) (seen.has(line.number) ? shared : seen).add(line.number);
    return shared;
  }, [lines]);

  /**
   * The far end of a line's name — "Ramón Ferreiro (Feminino) - Calde (Hospital)" — cut
   * down to the part that tells one branch from another.
   *
   * Two trims, both from what the chips actually rendered. Line 11's own name ends in its
   * number, so beside a badge that already says 11 it came out as "11 Pías 11". And the
   * parenthetical names the stop rather than the branch — it is "Calde (Hospital)" because
   * that is which Calde, not because the branch is the hospital — so it was spending the
   * chip's width on the one part nobody needs and pushing "Santa Comba (Calfensa)" into
   * an ellipsis.
   */
  const destinationOf = (line: BusLine) => {
    let end = line.name.split(' - ').pop()?.trim() ?? '';
    const numberSuffix = ` ${line.number}`;
    if (end.endsWith(numberSuffix)) end = end.slice(0, -numberSuffix.length).trim();
    const paren = end.indexOf(' (');
    return paren > 0 ? end.slice(0, paren) : end;
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[400] lg:hidden">
      <div
        className={`no-scrollbar flex gap-1.5 px-3 py-2.5 ${
          expanded ? 'max-h-[45dvh] flex-wrap overflow-y-auto' : 'overflow-x-auto'
        }`}
      >
        <button
          type="button"
          onClick={onAll}
          aria-pressed={picked.length === 0}
          className={`pointer-events-auto flex h-11 shrink-0 items-center rounded-full border px-4 text-label font-semibold shadow-sm backdrop-blur-xs ${
            picked.length === 0
              ? 'border-accent bg-accent text-on-accent'
              : 'border-edge bg-bg/95 text-ink-2'
          }`}
        >
          {t.map.allLines}
        </button>

        {/* Second, not last. At the end of a row that scrolls, the control for
            "stop making me scroll" is itself only reachable by scrolling. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? t.map.collapseLines : t.map.expandLines}
          title={expanded ? t.map.collapseLines : t.map.expandLines}
          className="pointer-events-auto flex h-11 shrink-0 items-center gap-1 rounded-full border border-edge bg-bg/95 px-3.5 text-label font-bold text-ink-2 shadow-sm backdrop-blur-xs"
        >
          <span className="tnum">{listed.length}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform motion-reduce:transition-none ${
              expanded ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>

        {/* The number is the chip. A line's colour is how it is drawn on the map
            and printed on the pole, so a coloured badge is the shortest thing that
            still says which line it is — and twenty-four of them scroll in a strip
            where twenty-four names would not fit at all. The name goes to the
            accessible name, since the badge alone reads as a bare number. */}
        {listed.map((line) => {
          const isSelected = picked.includes(line.id);
          // Only where the number cannot stand alone, so twenty of the chips stay
          // the width of their number and only the four 11s pay for the ambiguity.
          const branch = sharedNumbers.has(line.number) ? destinationOf(line) : '';
          return (
            <button
              key={line.id}
              type="button"
              onClick={() => onToggle(line)}
              aria-pressed={isSelected}
              aria-label={line.name}
              title={line.name}
              className={`pointer-events-auto flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-label font-black text-white shadow-sm ${
                isSelected ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''
              }`}
              style={{ backgroundColor: line.color }}
            >
              <span>{line.number}</span>
              {branch && (
                <span className="max-w-28 truncate font-semibold opacity-90">{branch}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
