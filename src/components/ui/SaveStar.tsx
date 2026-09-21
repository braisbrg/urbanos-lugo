import React, { useState } from 'react';
import { Star } from 'lucide-react';

/**
 * The star that saves a stop or a line: one button, one pop.
 *
 * The board and the line detail each drew their own and only one of them popped when
 * pressed. The pop plays on activation only -- never on opening something that was
 * already saved -- so the flag lives here and the parent keys the component by what it
 * saves, which resets it when the stop or the line changes.
 */
export function SaveStar({
  on,
  onToggle,
  label,
  className = '',
}: {
  on: boolean;
  onToggle: () => void;
  /** What pressing it does now: "save" when off, "remove" when on. */
  label: string;
  /** The idle fill, which differs by screen. */
  className?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setPressed(true);
        onToggle();
      }}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control border ${
        on ? 'border-warn bg-warn text-warn-ink' : `border-edge text-ink-2 ${className}`
      }`}
    >
      {/* The icon moves, never the button: the target stays where the thumb is. */}
      <Star
        className={`h-4.5 w-4.5 ${on && pressed ? 'anim-pop' : ''}`}
        strokeWidth={1.8}
        fill={on ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
    </button>
  );
}
