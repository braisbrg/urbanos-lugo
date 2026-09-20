import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** The small capitals over a block, with the accent icon when the block has one. */
export function SectionLabel({ icon: Icon, children, className = 'mb-2' }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 text-label font-bold uppercase tracking-wider text-ink-2 ${className}`}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
      {children}
    </span>
  );
}
