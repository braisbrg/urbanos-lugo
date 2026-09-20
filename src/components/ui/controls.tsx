import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** A 44 px square icon button; `on` swaps it to the warm "active" fill. */
export function IconButton({
  icon: Icon,
  label,
  on = false,
  onClick,
  title,
  fill,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  on?: boolean;
  onClick: () => void;
  title?: string;
  /** Fill the icon (a starred star). */
  fill?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={title}
      className={`flex h-11 w-11 items-center justify-center rounded-control border ${on ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-surface text-ink-2'} ${className}`}
    >
      <Icon className="h-4.5 w-4.5" strokeWidth={fill === undefined ? 2 : 1.8} fill={fill ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  );
}

/** A quiet bordered paragraph under the header: a status, a hint, a warning when `warn`. */
export function Notice({ children, warn = false, role, className = 'mt-3' }: { children: ReactNode; warn?: boolean; role?: 'alert' | 'status'; className?: string }) {
  return (
    <div role={role} className={`rounded-control border p-3 text-label leading-relaxed ${warn ? 'border-warn bg-warn text-warn-ink' : 'border-edge bg-surface text-ink-2'} ${className}`}>
      {children}
    </div>
  );
}

/** A row of exclusive choices, one pressed: the segmented control the app draws everywhere. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
  variant = 'inset',
}: {
  options: { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
  className?: string;
  /** `inset`: white pill inside a grey track. `outline`: bordered buttons, the pressed one inked. */
  variant?: 'inset' | 'outline';
}) {
  const on = variant === 'inset' ? 'bg-bg text-ink shadow-xs' : 'border-ink bg-ink text-bg';
  const off = variant === 'inset' ? 'text-ink-2 hover:text-ink' : 'border-edge text-ink-2';
  return (
    <div role="group" aria-label={label} className={`flex ${variant === 'inset' ? 'gap-1 rounded-md bg-surface p-1' : 'gap-1.5'} ${className}`}>
      {options.map(({ id, label, title }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          title={title}
          className={`h-11 flex-1 rounded-control font-semibold ${variant === 'outline' ? 'border text-body' : 'text-label'} ${value === id ? on : off}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
