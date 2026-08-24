import { Bus, Clock, Map, Route } from 'lucide-react';
import type { Dict } from '../i18n';

/** The tabs the shell can show. `info` has no destination of its own; the menu opens it. */
export type Tab = 'stops' | 'lines' | 'map' | 'plan' | 'info';

/**
 * The four places worth going, in order.
 *
 * Declared once and read by both shells — the phone's bottom bar and the desktop rail.
 * They carried identical copies of this list, so a fifth section, a different icon or a
 * reordering had to be made in two files, and nothing would have complained if only one
 * of them changed.
 */
export function navSections(t: Dict) {
  return [
    { id: 'stops' as const, Icon: Bus, label: t.nav.stops },
    { id: 'lines' as const, Icon: Clock, label: t.nav.lines },
    { id: 'map' as const, Icon: Map, label: t.nav.map },
    { id: 'plan' as const, Icon: Route, label: t.nav.plan },
  ];
}
