import React from 'react';

/**
 * A line's number on its colour: the badge printed on the poles and the buses, which is
 * what a rider matches against. Two sizes -- 44 px where it is a target, 36 where it is
 * a label beside a clock -- and the one radius they share, kept here rather than in the
 * four files that used to write it out. With `onClick` it is a button; without, a span.
 *
 * White text on every line colour measures at least 4.50:1 (the 5ES green is the floor);
 * a new colour in the dataset has to keep that.
 */
export const LineBadge: React.FC<{
  number: string;
  color: string;
  size?: 'md' | 'lg';
  className?: string;
  title?: string;
  'aria-label'?: string;
  onClick?: () => void;
}> = ({ number, color, size = 'lg', className = '', title, onClick, ...aria }) => {
  const classes = `tnum flex shrink-0 items-center justify-center rounded-[7px] font-bold text-white ${
    size === 'lg' ? 'h-11 w-11 text-body' : 'h-9 min-w-9 px-1.5 text-body'
  } ${className}`;
  const style = { backgroundColor: color };
  return onClick ? (
    <button type="button" onClick={onClick} title={title} aria-label={aria['aria-label']} className={classes} style={style}>
      {number}
    </button>
  ) : (
    <span title={title} className={classes} style={style}>
      {number}
    </span>
  );
};
