/**
 * "Tell me when to get off": the device position, watched, and the alarm when it comes
 * within ALARM_RADIUS_M of a stop. Runs only while the page is open — a web page cannot
 * wake itself in the background, and the UI says so.
 */
import { getDistanceMeters } from '../utils/geo';

/** Far enough ahead to stand up and press the button. */
export const ALARM_RADIUS_M = 300;

export type AlarmFailure = 'unavailable' | 'denied';

export interface AlarmHandle {
  stop: () => void;
}

interface PositionFix {
  lat: number;
  lng: number;
}

type Listener = { onFix: (fix: PositionFix) => void; onError: (reason: AlarmFailure) => void };

/**
 * One position watch for the whole app: the board's alarm and the trip companion both read
 * it, and two `watchPosition`s would be two GPS clients and two permission prompts. Started
 * by whoever asks first, cleared when the last listener leaves.
 */
const listeners = new Set<Listener>();
let watchId: number | null = null;

export function subscribePosition(onFix: (fix: PositionFix) => void, onError: (reason: AlarmFailure) => void): () => void {
  if (!navigator.geolocation) {
    onError('unavailable');
    return () => {};
  }
  const listener: Listener = { onFix, onError };
  listeners.add(listener);
  if (watchId === null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        for (const l of listeners) l.onFix(fix);
      },
      () => {
        for (const l of listeners) l.onError('denied');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };
}

export function watchForStop(target: PositionFix, onApproach: (distanceMeters: number) => void, onDistance: (distanceMeters: number) => void, onError: (reason: AlarmFailure) => void): AlarmHandle {
  let fired = false;
  const stop = subscribePosition((fix) => {
    const distance = getDistanceMeters(fix.lat, fix.lng, target.lat, target.lng);
    onDistance(distance);
    if (!fired && distance <= ALARM_RADIUS_M) {
      fired = true;
      onApproach(distance);
    }
  }, onError);
  return { stop };
}

/** Ask once for system notifications. Declining is fine: the in-page banner, vibration and sound still fire. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Show a system notification if allowed. Never throws. */
export function notify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'urbanos-lugo', badge: '/icon-192.png', icon: '/icon-192.png' });
    }
  } catch {
    // some browsers refuse the constructor outside a service worker
  }
}

/** Vibrate and beep. Both best-effort: silent failure is fine, a missed stop is not. */
export function ringAlarm(): void {
  try {
    navigator.vibrate?.([300, 120, 300, 120, 500]);
  } catch {
    // no vibration hardware
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.35);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.7);
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
    osc.onended = () => ctx.close();
  } catch {
    // audio blocked until a user gesture; the banner and vibration still fire
  }
}
