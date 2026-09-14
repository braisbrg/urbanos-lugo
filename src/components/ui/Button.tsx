import React from 'react';

type Variant = 'primary' | 'secondary' | 'icon';

/**
 * The three buttons the app has, written once.
 *
 * `primary` is the accent block for the one action a screen is for -- calculate, start
 * the ride, scan; `secondary` the bordered one beside it; `icon` the 44 px square that
 * holds a single glyph on the board and the map. Every one is at least 44 px tall, which
 * is the floor the whole app keeps for a thumb. Sixteen primaries were spelled out by hand
 * across nine files before this existed, with the height and radius drifting between them.
 */
export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pressed?: boolean }
> = ({ variant = 'secondary', pressed, className = '', type = 'button', children, ...rest }) => {
  const shape =
    variant === 'icon'
      ? `flex h-11 w-11 items-center justify-center rounded-control border ${
          pressed ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-surface text-ink-2'
        }`
      : variant === 'primary'
        ? 'flex h-12 w-full items-center justify-center gap-2 rounded-control bg-accent px-4 text-body font-semibold text-on-accent'
        : 'flex min-h-11 items-center justify-center gap-2 rounded-control border border-edge bg-bg px-3 text-body font-semibold text-ink';
  return (
    <button type={type} aria-pressed={pressed} className={`${shape} ${className}`} {...rest}>
      {children}
    </button>
  );
};
