import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The small capitals over a block -- "MAPA DO TRAXECTO", "PARADAS POLAS QUE PASA" --
 * with the accent icon when the block has one. Five files carried this exact string;
 * the eight-pixel gap to the block below is part of it, as the rhythm rule says.
 */
export const SectionLabel: React.FC<{
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}> = ({ icon: Icon, children, className = 'mb-2' }) => (
  <span className={`flex items-center gap-1.5 text-label font-bold uppercase tracking-wider text-ink-2 ${className}`}>
    {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
    {children}
  </span>
);
