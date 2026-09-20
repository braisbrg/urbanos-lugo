import { Check } from 'lucide-react';
import { useT } from '../../i18n';
import type { Precision } from '../../types';

/**
 * Where a time came from, in the two shapes the whole app uses: solid for a time the
 * operator prints, dashed for one derived from it. Colour never carries it alone.
 * `extra` is the text after the label (the board puts the clock there).
 */
export function Provenance({ precision, extra, title }: { precision: Precision; extra?: string; title?: string }) {
  const t = useT();
  const label = precision === 'published' ? t.common.officialBadge : t.common.estimatedBadge;
  const text = extra ? `${label} ${extra}` : label;
  return precision === 'published' ? (
    <span title={title} className="inline-flex items-center gap-1.5 rounded bg-official px-2 py-1 text-on-official">
      <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3.4} aria-hidden="true" />
      <span className="tnum text-label font-semibold tracking-[0.05em]">{text}</span>
    </span>
  ) : (
    <span title={title} className="inline-flex items-center gap-1.5 rounded border-[1.5px] border-dashed border-estimated-line px-[7px] py-[3px] text-estimated">
      <span className="tnum text-label font-semibold tracking-[0.05em]">{text}</span>
    </span>
  );
}
