import React from 'react';
import { Check } from 'lucide-react';
import { Lang, translations } from '../../i18n';

/**
 * Where a time came from, in the two shapes the whole app uses: solid for a time the
 * operator prints, dashed for one derived from it. Colour never carries it alone.
 *
 * This was the same twelve lines written by hand on the stop board, in the planner and
 * on the ride screen; the design-system audit counted it as the most repeated component
 * in the codebase. `extra` is the text after the label, when a row has one (the board
 * puts the clock there).
 */
export const Provenance: React.FC<{
  precision: 'published' | 'estimated';
  lang: Lang;
  extra?: string;
  title?: string;
}> = ({ precision, lang, extra, title }) => {
  const t = translations(lang);
  const text = extra ? `${precision === 'published' ? t.common.officialBadge : t.common.estimatedBadge} ${extra}` : precision === 'published' ? t.common.officialBadge : t.common.estimatedBadge;
  return precision === 'published' ? (
    <span title={title} className="inline-flex items-center gap-1.5 rounded bg-official px-2 py-1 text-on-official">
      <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3.4} aria-hidden="true" />
      <span className="tnum text-label font-semibold tracking-[0.05em]">{text}</span>
    </span>
  ) : (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded border-[1.5px] border-dashed border-estimated-line px-[7px] py-[3px] text-estimated"
    >
      <span className="tnum text-label font-semibold tracking-[0.05em]">{text}</span>
    </span>
  );
};
