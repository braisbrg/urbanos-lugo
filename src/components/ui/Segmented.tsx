import React from 'react';

interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  /** A tooltip, when the label alone is terse. */
  hint?: string;
}

/**
 * "Which of these views": one bordered track, a thumb that slides to the pressed option.
 *
 * The board and the planner each drew their own -- two buttons whose fill jumped from one
 * to the other, in two different fills. The thumb is the same control read as one object,
 * and the slide (200 ms, `.seg-thumb`) says where you came from. Each button still carries
 * `aria-pressed`; the thumb is decoration and says nothing to a screen reader.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  dense = false,
  className = '',
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (id: T) => void;
  /** Label-sized text, for three options in a phone-wide track. */
  dense?: boolean;
  className?: string;
}) {
  const pressed = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className={`seg ${dense ? 'seg-dense' : ''} ${className}`} style={{ '--n': options.length, '--i': pressed } as React.CSSProperties}>
      <span className="seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          title={o.hint}
          className={`seg-btn ${o.id === value ? 'seg-on' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
