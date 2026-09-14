import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Lang, translations } from '../i18n';
import { AlarmFailure, notify, requestNotificationPermission, ringAlarm, subscribePosition } from '../services/stopAlarm';
import { RoutePlanResult } from '../types';
import {
  TripFix,
  TripPlace,
  TripState,
  advanceTrip,
  confirmBoarded,
  missedBus,
  packTrip,
  startTrip,
  tripProgress,
  unpackTrip,
} from '../utils/tripProgress';

/**
 * The trip in progress, in `sessionStorage` -- which survives a reload and dies with the
 * tab, the exact life of a bus ride. `localStorage` would have been a record left on the
 * device saying this person went from X to Y and when. PRIVACY.md lists the key.
 */
const KEY = 'urbanos-lugo-trip';

export interface TripCompanion {
  trip: TripState | null;
  start: (plan: RoutePlanResult, origin: TripPlace | null, destination: TripPlace | null) => void;
  boarded: () => void;
  missed: () => void;
  finish: () => void;
  /**
   * The switch that keeps the screen from going dark during the ride. `null` where the
   * browser has no such thing, so the screen can leave the control out rather than show
   * one that does nothing.
   */
  keepAwake: { on: boolean; set: (on: boolean) => void } | null;
}

/**
 * Whether the screen can be asked to stay on at all.
 *
 * Asked once: the answer does not change while the page is open, and iOS Safari before
 * 16.4 -- which this app still supports -- says no. There the control is simply absent.
 */
const CAN_KEEP_AWAKE = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/*
 * The phone's position, outside React.
 *
 * The trip is held above the tabs so a look at the map does not end it, which put this
 * hook in `App` -- and a GPS fix held in `App`'s state re-rendered every tab underneath
 * on every fix. Measured on a 6x-throttled CPU with the map mounted: 40 ms of script per
 * fix, 1.2 React commits per fix, and the same 42 ms with the companion not even on
 * screen. A bus gives a fix a second, so that was a minute of work per half-hour ride
 * spent redrawing lists nobody was looking at.
 *
 * So the fix lives here, in a store the companion screen subscribes to on its own. `App`
 * re-renders when the trip changes -- a handful of times per ride -- and nothing else.
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
export function useTripPosition(): PositionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The "vou no bus" mode, held above the tabs so a look at the map or a line does not end
 * the ride. The screen that shows it is `TripCompanionView`; this is everything it needs
 * to be true whether or not that screen is mounted: the position watch, the alert, the
 * remembered stops, and the copy in `sessionStorage`.
 */
export function useTripCompanion(lang: Lang): TripCompanion {
  const [trip, setTrip] = useState<TripState | null>(() => {
    try {
      return unpackTrip(sessionStorage.getItem(KEY));
    } catch {
      return null;
    }
  });
  // The watch's callback outlives any one render; it reads the trip through here.
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Every change is written through, and the end of the trip removes it.
  useEffect(() => {
    try {
      if (trip) sessionStorage.setItem(KEY, packTrip(trip));
      else sessionStorage.removeItem(KEY);
    } catch {
      // Storage refused: the trip still works, it just will not survive a reload.
    }
  }, [trip]);

  /*
   * The position watch runs for exactly as long as there is a trip. Each fix is counted
   * against the plan right here, and the trip only changes when the count did -- a stop
   * reached, a boarding seen, the one alert per leg -- so most fixes end in the store
   * above and nowhere else.
   */
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

  /*
   * The screen, kept on -- only while asked, only while there is a trip, and only while
   * the page is the one being looked at.
   *
   * A phone in a hand on a bus locks itself in thirty seconds, and a locked phone stops
   * getting positions, so the one thing this mode is for stops working exactly when it is
   * being used. The Screen Wake Lock is the honest fix: no dialog and no permission, the
   * screen simply stops timing out, and the browser releases it by itself the moment the
   * tab is hidden -- which is why it is re-requested on `visibilitychange`, when the
   * reader comes back. What it costs is battery, which is why it is a switch the reader
   * turns on and not a default; the switch says so in as many words.
   *
   * Off by default each trip and not remembered: nothing about it is stored anywhere.
   */
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
        // Low battery mode, or a browser that has the API and says no: the switch stays
        // on, the screen behaves as it always did, and nothing is promised in between.
        sentinel = null;
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
  // A new trip starts with the switch off, whatever the last one chose.
  useEffect(() => {
    if (!active) setKeepAwakeOn(false);
  }, [active]);

  const start = useCallback((plan: RoutePlanResult, origin: TripPlace | null, destination: TripPlace | null) => {
    setTrip(startTrip(plan, origin, destination));
    // The same single permission the board asks for; declining keeps the in-page alert.
    void requestNotificationPermission();
  }, []);

  // Both answers are about the leg on screen, which is the one the last fix put the
  // reader on -- so they are read against that fix, not against a render.
  const boarded = useCallback(
    () => setTrip((t) => (t ? confirmBoarded(t, tripProgress(t.plan, snapshot.fix, new Set(t.seen))) : t)),
    [],
  );
  const missed = useCallback(
    () =>
      setTrip((t) =>
        t ? missedBus(t, tripProgress(t.plan, snapshot.fix, new Set(t.seen)), new Date(), langRef.current) : t,
      ),
    [],
  );
  const finish = useCallback(() => setTrip(null), []);

  const keepAwake = useMemo(
    () => (CAN_KEEP_AWAKE ? { on: keepAwakeOn, set: setKeepAwakeOn } : null),
    [keepAwakeOn],
  );

  return { trip, start, boarded, missed, finish, keepAwake };
}
