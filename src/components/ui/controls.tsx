import { Star, type LucideIcon } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';

/** A 44 px square icon button; `on` swaps it to the warm "active" fill. */
export function IconButton({
  icon: Icon,
  label,
  on = false,
  onClick,
  title,
  fill,
  className = '',
  iconClassName = '',
}: {
  icon: LucideIcon;
  label: string;
  on?: boolean;
  onClick: () => void;
  title?: string;
  /** Fill the icon (a starred star). */
  fill?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={title}
      className={`flex h-11 w-11 items-center justify-center rounded-control border ${on ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-surface text-ink-2'} ${className}`}
    >
      <Icon className={`h-4.5 w-4.5 ${iconClassName}`} strokeWidth={fill === undefined ? 2 : 1.8} fill={fill ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  );
}

/**
 * The star that saves a stop or a line: one button, one pop. The pop plays on activation
 * only, never on opening something already saved, so the parent keys it by what it saves.
 * The icon moves, never the button: the target stays where the thumb is.
 */
export function SaveStar({ on, onToggle, label, className }: { on: boolean; onToggle: () => void; label: string; className?: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <IconButton
      icon={Star}
      label={label}
      title={label}
      on={on}
      fill={on}
      className={className}
      iconClassName={on && pressed ? 'anim-pop' : ''}
      onClick={() => {
        setPressed(true);
        onToggle();
      }}
    />
  );
}

/** A quiet bordered paragraph under the header: a status, a hint, a warning when `warn`. */
export function Notice({ children, warn = false, role, className = 'mt-3' }: { children: ReactNode; warn?: boolean; role?: 'alert' | 'status'; className?: string }) {
  return (
    <div role={role} className={`anim-rise rounded-control border p-3 text-label leading-relaxed ${warn ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-surface text-ink-2'} ${className}`}>
      {children}
    </div>
  );
}

/**
 * "Which of these views": one bordered track, a thumb that slides to the pressed option
 * (`.seg-thumb`, 200 ms), so the control reads as one object and the slide says where you
 * came from. Each button carries `aria-pressed`; the thumb is decoration.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  dense = false,
  className = '',
}: {
  options: readonly { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
  /** Label-sized text, for three options in a phone-wide track. */
  dense?: boolean;
  className?: string;
}) {
  const pressed = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div role="group" aria-label={label} className={`seg ${dense ? 'seg-dense' : ''} ${className}`} style={{ '--n': options.length, '--i': pressed } as CSSProperties}>
      <span className="seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={o.id === value} title={o.title} className={`seg-btn ${o.id === value ? 'seg-on' : ''}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
