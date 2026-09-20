/**
 * A line's number on its colour: the badge printed on the poles and the buses, which is
 * what a rider matches against. Sizes: 'lg' where it is a target (44 px), 'md' beside a
 * clock, 'sm' inline in a row. With `onClick` it is a button; without, a span.
 * White text on every line colour measures at least 4.50:1 (the 5ES green is the floor).
 */
const SIZES = {
  lg: 'h-11 w-11 rounded-[7px] text-body',
  md: 'h-9 min-w-9 rounded-[7px] px-1.5 text-body',
  sm: 'h-6 min-w-6 rounded px-1.5 text-label',
} as const;

export function LineBadge({
  number,
  color,
  size = 'lg',
  className = '',
  title,
  onClick,
  ...aria
}: {
  number: string;
  color: string;
  size?: keyof typeof SIZES;
  className?: string;
  title?: string;
  'aria-label'?: string;
  onClick?: () => void;
}) {
  const classes = `tnum flex shrink-0 items-center justify-center font-bold text-white ${SIZES[size]} ${className}`;
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
}
