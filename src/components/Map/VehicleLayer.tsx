import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { translations, useLang, type Lang } from '../../i18n';
import { escapeHtml } from '../../utils/html';
import { ScheduledBus } from '../../types';
import { badgeHtml, popupBox, rowButtonStyle } from './popupHtml';

interface VehicleLayerProps {
  map: L.Map | null;
  buses: ScheduledBus[];
  /** Lines to draw; null means every line. */
  visibleLineIds: string[] | null;
  showBuses: boolean;
  onOpenLine: (lineId: string) => void;
}

/**
 * The bus as one SVG: a round chip in the line's colour carrying the number, with a nose
 * that turns to face the way it is going. The number sits outside the rotating group so
 * it stays upright. The position is computed from the timetable and the popup says so.
 */
function busIcon(bus: ScheduledBus): L.DivIcon {
  const colour = escapeHtml(bus.lineColor);
  const number = escapeHtml(bus.lineNumber);
  const fontSize = number.length > 2 ? 10 : 12.5;
  return L.divIcon({
    className: 'custom-bus-marker',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    html:
      `<div class="cursor-pointer"><svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true" style="display:block; overflow:visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));">` +
      `<g transform="rotate(${bus.bearing} 23 23)"><path d="M23 2.5 L30 14 L16 14 Z" fill="${colour}" stroke="var(--c-bg)" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke"></path></g>` +
      `<circle cx="23" cy="23" r="13" fill="${colour}" stroke="var(--c-bg)" stroke-width="2.5"></circle>` +
      `<text x="23" y="23" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-family="var(--font-sans)" font-weight="700" font-size="${fontSize}" letter-spacing="-0.2">${number}</text></svg></div>`,
  });
}

/** Built as a node so the line heading can carry a real click handler. */
function popupNode(bus: ScheduledBus, onOpenLine: (lineId: string) => void, lang: Lang): HTMLElement {
  const t = translations(lang);
  const occupancy = { low: t.map.occupancyLow, medium: t.map.occupancyMedium, high: t.map.occupancyHigh }[bus.occupancy];
  const node = document.createElement('div');
  node.innerHTML = popupBox(
    `<button type="button" data-open-line="1" style="${rowButtonStyle} margin-bottom:6px; padding:0;">${badgeHtml(bus.lineColor, bus.lineNumber)}` +
      `<span style="font-weight:600; font-size:13px; color:var(--c-ink); text-decoration:underline; text-underline-offset:2px;">${escapeHtml(bus.destination)}</span></button>` +
      `<div style="font-size:12px; color:var(--c-ink-2);">${escapeHtml(t.map.nextStop)}: <b>${escapeHtml(bus.nextStopName)}</b></div>` +
      `<div style="font-size:12px; color:var(--c-ink-3);">${escapeHtml(t.map.occupancyLabel)}: ${escapeHtml(occupancy)}</div>` +
      `<div style="font-size:12px; color:var(--c-estimated-fg); margin-top:6px; line-height:1.4;">${t.map.estimatedPosition}</div>`,
  );
  node.querySelector('button[data-open-line]')?.addEventListener('click', () => onOpenLine(bus.lineId));
  return node;
}

export function VehicleLayer({ map, buses, visibleLineIds, showBuses, onOpenLine }: VehicleLayerProps) {
  const lang = useLang();
  const markersRef = useRef<Record<string, L.Marker>>({});
  /** What each marker was last drawn from, so a tick that changed neither icon nor popup costs neither. */
  const drawnRef = useRef<Record<string, { icon: string; popup: string }>>({});
  const onOpenLineRef = useRef(onOpenLine);
  onOpenLineRef.current = onOpenLine;

  useEffect(() => {
    if (!map) return;
    const visible = showBuses ? (visibleLineIds === null ? buses : buses.filter((b) => visibleLineIds.includes(b.lineId))) : [];
    const visibleIds = new Set(visible.map((b) => b.id));
    for (const id of Object.keys(markersRef.current)) {
      if (visibleIds.has(id)) continue;
      markersRef.current[id].remove();
      delete markersRef.current[id];
      delete drawnRef.current[id];
    }

    // Buses of different lines legitimately share a point (a common terminus); nudge coincident markers apart.
    const seenAt = new Map<string, number>();
    const OFFSET_DEG = 0.00012; // ~13 m
    const placed = visible.map((bus) => {
      const key = `${bus.currentLat.toFixed(5)},${bus.currentLng.toFixed(5)}`;
      const n = seenAt.get(key) ?? 0;
      seenAt.set(key, n + 1);
      if (n === 0) return bus;
      const angle = (n * 2 * Math.PI) / 6;
      return { ...bus, currentLat: bus.currentLat + Math.sin(angle) * OFFSET_DEG, currentLng: bus.currentLng + Math.cos(angle) * OFFSET_DEG };
    });

    const t = translations(lang);
    for (const bus of placed) {
      // Five degrees is under what the chip can show.
      const iconKey = `${bus.lineNumber}|${bus.lineColor}|${Math.round(bus.bearing / 5) * 5}|${lang}`;
      const popupKey = `${bus.destination}|${bus.nextStopName}|${bus.occupancy}|${lang}`;
      const label = t.map.busMarker(bus.lineNumber, bus.destination);
      const existing = markersRef.current[bus.id];
      if (existing) {
        existing.setLatLng([bus.currentLat, bus.currentLng]);
        const drawn = drawnRef.current[bus.id];
        if (drawn?.icon !== iconKey) {
          existing.setIcon(busIcon(bus));
          existing.getElement()?.setAttribute('aria-label', label); // setIcon rebuilds the element
        }
        if (drawn?.popup !== popupKey) existing.setPopupContent(popupNode(bus, onOpenLineRef.current, lang));
      } else {
        const marker = L.marker([bus.currentLat, bus.currentLng], { icon: busIcon(bus), zIndexOffset: 1000 }).addTo(map);
        marker.bindPopup(popupNode(bus, onOpenLineRef.current, lang));
        // Leaflet makes the icon a keyboard-reachable button with no name of its own.
        marker.getElement()?.setAttribute('aria-label', label);
        markersRef.current[bus.id] = marker;
      }
      drawnRef.current[bus.id] = { icon: iconKey, popup: popupKey };
    }
  }, [map, buses, visibleLineIds, showBuses, lang]);

  useEffect(
    () => () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      drawnRef.current = {};
    },
    [map],
  );

  return null;
}
