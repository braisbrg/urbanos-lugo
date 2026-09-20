import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Lang, translations } from '../i18n';
import { AlarmFailure, notify, requestNotificationPermission, ringAlarm, subscribePosition } from '../services/stopAlarm';
import { RoutePlanResult } from '../types';
import { readString, writeString } from '../utils/storage';
import { TripFix, TripPlace, TripState, advanceTrip, confirmBoarded, missedBus, packTrip, startTrip, tripProgress, unpackTrip } from '../utils/tripProgress';

/** In `sessionStorage`: survives a reload and dies with the tab, the exact life of a bus ride. PRIVACY.md lists the key. */
const KEY = 'urbanos-lugo-trip';

export interface TripCompanion {
  trip: TripState | null;
  start: (plan: RoutePlanResult, origin: TripPlace | null, destination: TripPlace | null) => void;
  boarded: () => void;
  missed: () => void;
  finish: () => void;
  /** The switch that keeps the screen on during the ride; null where the browser has no such thing. */
  keepAwake: { on: boolean; set: (on: boolean) => void } | null;
}

const CAN_KEEP_AWAKE = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/**
 * The phone's position, outside React: a fix a second held in `App`'s state re-rendered
 * every tab underneath on every fix. The companion screen subscribes to this store on its
 * own; `App` re-renders only when the trip changes.
 */
interface PositionSnapshot {
  fix: TripFix | null;
  gpsError: AlarmFailure | null;
}
let snapshot: PositionSnapshot = { fix: null, gpsError: null };
const listeners = new Set<() => void>();
const publish = (next: PositionSnapshot) => {
  snapshot = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => snapshot;

/** The last position the phone gave and whether it refused, for the screen that shows them. */
export const useTripPosition = (): PositionSnapshot => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/**
 * The "vou no bus" mode, held above the tabs so a look at the map does not end the ride:
 * the position watch, the alert, the remembered stops, and the copy in sessionStorage.
 */
export function useTripCompanion(lang: Lang): TripCompanion {
  const [trip, setTrip] = useState<TripState | null>(() => unpackTrip(readString(KEY, sessionStorage)));
  // The watch's callback outlives any one render; it reads the trip through here.
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    writeString(KEY, trip ? packTrip(trip) : null, sessionStorage);
  }, [trip]);

  // The watch runs for exactly as long as there is a trip; most fixes end in the store above.
  const active = trip !== null;
  useEffect(() => {
    if (!active) return;
    publish({ fix: null, gpsError: null });
    const unsubscribe = subscribePosition(
      (fix) => {
        publish({ fix, gpsError: null });
        const current = tripRef.current;
        if (!current) return;
        const progress = tripProgress(current.plan, fix, new Set(current.seen));
        const { state, ring } = advanceTrip(current, progress);
        if (ring) {
          const stop = current.plan.segments[progress.segmentIndex]?.toStop;
          const t = translations(langRef.current);
          ringAlarm();
          if (stop) notify(t.arrivals.watchTitle, t.arrivals.alarmFired(stop.name));
        }
        if (state !== current) setTrip(state);
      },
      (gpsError) => publish({ ...snapshot, gpsError }),
    );
    return () => {
      unsubscribe();
      publish({ fix: null, gpsError: null });
    };
  }, [active]);

  // The Screen Wake Lock: no dialog, no permission, released by the browser when the tab
  // hides, so it is re-requested on visibilitychange. A switch, not a default: it costs battery.
  const [keepAwakeOn, setKeepAwakeOn] = useState(false);
  useEffect(() => {
    if (!CAN_KEEP_AWAKE || !active || !keepAwakeOn) return;
    let sentinel: WakeLockSentinel | null = null;
    let gone = false;
    const hold = async () => {
      if (gone || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        sentinel = null; // low battery mode, or a browser that says no
      }
    };
    void hold();
    document.addEventListener('visibilitychange', hold);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', hold);
      void sentinel?.release();
    };
  }, [active, keepAwakeOn]);
  useEffect(() => {
    if (!active) setKeepAwakeOn(false);
  }, [active]);

  const start = useCallback((plan: RoutePlanResult, origin: TripPlace | null, destination: TripPlace | null) => {
    setTrip(startTrip(plan, origin, destination));
    void requestNotificationPermission();
  }, []);
  // Both answers are about the leg the last fix put the reader on.
  const boarded = useCallback(() => setTrip((t) => (t ? confirmBoarded(t, tripProgress(t.plan, snapshot.fix, new Set(t.seen))) : t)), []);
  const missed = useCallback(() => setTrip((t) => (t ? missedBus(t, tripProgress(t.plan, snapshot.fix, new Set(t.seen)), new Date(), langRef.current) : t)), []);
  const finish = useCallback(() => setTrip(null), []);
  const keepAwake = useMemo(() => (CAN_KEEP_AWAKE ? { on: keepAwakeOn, set: setKeepAwakeOn } : null), [keepAwakeOn]);

  return { trip, start, boarded, missed, finish, keepAwake };
}
