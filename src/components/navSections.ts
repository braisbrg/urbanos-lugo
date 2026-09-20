import { AlertTriangle, Bus, Clock, CreditCard, Map, Route } from 'lucide-react';
import type { Dict } from '../i18n';
export type { Tab } from '../routes';

/** The four places worth going, in order — read by both shells so they cannot drift. */
export const navSections = (t: Dict) => [
  { id: 'stops' as const, Icon: Bus, label: t.nav.stops },
  { id: 'lines' as const, Icon: Clock, label: t.nav.lines },
  { id: 'map' as const, Icon: Map, label: t.nav.map },
  { id: 'plan' as const, Icon: Route, label: t.nav.plan },
];

/** The two screens below the rule: read now and then, not on every trip. */
export const asideSections = (t: Dict, alertCount: number) => [
  { id: 'info' as const, Icon: AlertTriangle, label: t.menu.alerts, badge: alertCount },
  { id: 'fares' as const, Icon: CreditCard, label: t.menu.fares, badge: 0 },
];
