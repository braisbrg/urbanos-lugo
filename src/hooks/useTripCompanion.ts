import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lang, translations } from '../i18n';
import { AlarmFailure, notify, requestNotificationPermission, ringAlarm, subscribePosition } from '../services/stopAlarm';
import { RoutePlanResult } from '../types';
import {
  TripFix,
  TripPlace,
  TripProgress,
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

/** How often the minutes in the header are recounted against the clock. */
const TICK_MS = 15_000;

export interface TripCompanion {
  trip: TripState | null;
  /** The last position the phone gave, or null before the first one. */
  fix: TripFix | null;
  progress: TripProgress | null;
  gpsError: AlarmFailure | null;
  /** Re-read every TICK_MS so "~ 11 min" counts down without a fix. */
  now: Date;
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
  const [fix, setFix] = useState<TripFix | null>(null);
  const [gpsError, setGpsError] = useState<AlarmFailure | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Every change is written through, and the end of the trip removes it.
  useEffect(() => {
    try {
      if (trip) sessionStorage.setItem(KEY, packTrip(trip));
      else sessionStorage.removeItem(KEY);
    } catch {
      // Storage refused: the trip still works, it just will not survive a reload.
    }
  }, [trip]);

  // The position watch and the clock run for exactly as long as there is a trip.
  const active = trip !== null;
  useEffect(() => {
    if (!active) return;
    setGpsError(null);
    const unsubscribe = subscribePosition(setFix, setGpsError);
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => {
      unsubscribe();
      clearInterval(tick);
      setFix(null);
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

  const progress = useMemo(
    () => (trip ? tripProgress(trip.plan, fix, new Set(trip.seen)) : null),
    [trip, fix],
  );

  // What the fix changed, and the one alert per leg.
  useEffect(() => {
    if (!trip || !progress || !fix) return;
    const { state, ring } = advanceTrip(trip, progress);
    if (ring) {
      const stop = trip.plan.segments[progress.segmentIndex]?.toStop;
      ringAlarm();
      if (stop) notify(translations(lang).arrivals.watchTitle, translations(lang).arrivals.alarmFired(stop.name));
    }
    if (state !== trip) setTrip(state);
  }, [progress]);

  const start = useCallback((plan: RoutePlanResult, origin: TripPlace | null, destination: TripPlace | null) => {
    setTrip(startTrip(plan, origin, destination));
    // The same single permission the board asks for; declining keeps the in-page alert.
    void requestNotificationPermission();
  }, []);

  const boarded = useCallback(() => setTrip((t) => (t ? confirmBoarded(t, progress) : t)), [progress]);
  const missed = useCallback(
    () => setTrip((t) => (t ? missedBus(t, progress, new Date(), lang) : t)),
    [progress, lang],
  );
  const finish = useCallback(() => setTrip(null), []);

  const keepAwake = useMemo(
    () => (CAN_KEEP_AWAKE ? { on: keepAwakeOn, set: setKeepAwakeOn } : null),
    [keepAwakeOn],
  );

  return { trip, fix, progress, gpsError, now, start, boarded, missed, finish, keepAwake };
}
