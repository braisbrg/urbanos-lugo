import React, { useEffect, useRef } from 'react';
import { Lang, translations } from '../../i18n';
import { escapeHtml } from './escapeHtml';
import L from 'leaflet';
import { ScheduledBus } from '../../types';

interface VehicleLayerProps {
  map: L.Map | null;
  buses: ScheduledBus[];
  /** Lines to draw; null means every line. */
  visibleLineIds: string[] | null;
  showBuses: boolean;
  lang: Lang;
  /** Open the line this bus belongs to. */
  onOpenLine: (lineId: string) => void;
}

/** Same reasoning as StopLayer: these strings end up in innerHTML. */
/** Expected crowding, in the reader's language. Derived from the time of day, never measured. */
const occupancyLabel = (
  occupancy: ScheduledBus['occupancy'],
  t: ReturnType<typeof translations>,
): string =>
  ({ low: t.map.occupancyLow, medium: t.map.occupancyMedium, high: t.map.occupancyHigh })[occupancy];

/**
 * The bus: one object, not three.
 *
 * It was a square badge, a triangle floating some distance off it, and a dashed ring
 * around both — three separate things that had to be assembled by eye into a single bus,
 * and each of which had to be fixed separately to be visible at all. That is what made it
 * read as dated: not the colours, the assembly.
 *
 * It is one SVG now. A round chip in the line's colour carrying the number, with a nose
 * that turns to face the way the bus is going. The nose belongs to the chip rather than
 * orbiting it, so there is nothing to line up and nothing to collide with, and the number
 * sits outside the rotating group so it stays upright at every bearing — a rotated label
 * is the usual way this goes wrong.
 *
 * The dashed "estimated" ring is gone. Every position here is computed from the timetable
 * and the popup says so in words, which is where that belongs: the ring took two attempts
 * merely to become visible and still did not say what it meant, and a symbol nobody reads
 * as uncertainty is not a caveat, it is clutter.
 */
const busIconSvg = (bus: ScheduledBus): string => {
  const colour = escapeHtml(bus.lineColor);
  const number = escapeHtml(bus.lineNumber);
  // "1.1" and "11" are both common here; the longer ones step down so they still fit the
  // chip rather than overflowing it.
  const fontSize = number.length > 2 ? 10 : 12.5;
  return `
    <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true"
         style="display:block; overflow:visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));">
      <g transform="rotate(${bus.bearing} 23 23)">
        <path d="M23 2.5 L30 14 L16 14 Z" fill="${colour}"
              stroke="var(--c-bg)" stroke-width="2.5" stroke-linejoin="round"
              paint-order="stroke"></path>
      </g>
      <circle cx="23" cy="23" r="13" fill="${colour}"
              stroke="var(--c-bg)" stroke-width="2.5"></circle>
      <text x="23" y="23" text-anchor="middle" dominant-baseline="central"
            fill="#ffffff" font-family="var(--font-sans)" font-weight="700"
            font-size="${fontSize}" letter-spacing="-0.2">${number}</text>
    </svg>
  `;
};

function busIcon(bus: ScheduledBus): L.DivIcon {
  return L.divIcon({
    className: 'custom-bus-marker',
    html: `<div class="cursor-pointer">${busIconSvg(bus)}</div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });
}

/**
 * The popup is built as a node rather than a string so the line heading can carry a real
 * click handler: from a bus on the map, its line's own page is one tap away.
 */
function popupNode(bus: ScheduledBus, onOpenLine: (lineId: string) => void, lang: Lang): HTMLElement {
  const t = translations(lang);
  const node = document.createElement('div');
  // Leaflet popups live outside React, so the tokens are read through var() rather than
  // Tailwind classes — same palette, same dark-mode switch, same 12 px floor.
  node.innerHTML = `
    <div style="min-width: 200px; padding: 2px; font-family: var(--font-sans); color: var(--c-ink);">
      <button type="button" data-open-line="1" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; background:none; border:none; padding:0; cursor:pointer; text-align:left; font-family:inherit;">
        <span style="background-color:${escapeHtml(bus.lineColor)}; color:#fff; font-weight:700; font-size:12px; padding:3px 7px; border-radius:5px;">${escapeHtml(bus.lineNumber)}</span>
        <span style="font-weight:600; font-size:13px; color:var(--c-ink); text-decoration:underline; text-underline-offset:2px;">${escapeHtml(bus.destination)}</span>
      </button>
      <div style="font-size:12px; color:var(--c-ink-2);">${escapeHtml(t.map.nextStop)}: <b>${escapeHtml(bus.nextStopName)}</b></div>
      <div style="font-size:12px; color:var(--c-ink-3);">${escapeHtml(t.map.occupancyLabel)}: ${escapeHtml(occupancyLabel(bus.occupancy, t))}</div>
      <div style="font-size:12px; color:var(--c-estimated-fg); margin-top:6px; line-height:1.4;">
        ${t.map.estimatedPosition}
      </div>
    </div>
  `;
  node.querySelector('button[data-open-line]')?.addEventListener('click', () => onOpenLine(bus.lineId));
  return node;
}

export const VehicleLayer: React.FC<VehicleLayerProps> = ({
  map,
  buses,
  visibleLineIds,
  showBuses,
  lang,
  onOpenLine,
}) => {
  const markersRef = useRef<Record<string, L.Marker>>({});
  const onOpenLineRef = useRef(onOpenLine);
  onOpenLineRef.current = onOpenLine;

  useEffect(() => {
    if (!map) return;

    const visible = showBuses
      ? visibleLineIds === null
        ? buses
        : buses.filter((b) => visibleLineIds.includes(b.lineId))
      : [];
    const visibleIds = new Set(visible.map((b) => b.id));

    Object.keys(markersRef.current).forEach((id) => {
      if (!visibleIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    // Buses of different lines legitimately share a point (common terminus, shared
    // corridor). Drawn raw, one marker hides the other and the fleet looks short by
    // one; nudge coincident markers apart so every vehicle stays visible.
    const seenAt = new Map<string, number>();
    const placed = visible.map((bus) => {
      const key = `${bus.currentLat.toFixed(5)},${bus.currentLng.toFixed(5)}`;
      const n = seenAt.get(key) ?? 0;
      seenAt.set(key, n + 1);
      if (n === 0) return bus;
      const angle = (n * 2 * Math.PI) / 6;
      const OFFSET_DEG = 0.00012; // ~13 m
      return {
        ...bus,
        currentLat: bus.currentLat + Math.sin(angle) * OFFSET_DEG,
        currentLng: bus.currentLng + Math.cos(angle) * OFFSET_DEG,
      };
    });

    placed.forEach((bus) => {
      const existing = markersRef.current[bus.id];
      if (existing) {
        // Markers used to be created once and never refreshed, so heading, next stop
        // and occupancy stayed frozen at whatever they were on first sight.
        existing.setLatLng([bus.currentLat, bus.currentLng]);
        existing.setIcon(busIcon(bus));
        existing.setPopupContent(popupNode(bus, onOpenLineRef.current, lang));
      } else {
        const marker = L.marker([bus.currentLat, bus.currentLng], {
          icon: busIcon(bus),
          zIndexOffset: 1000,
        }).addTo(map);
        marker.bindPopup(popupNode(bus, onOpenLineRef.current, lang));
        markersRef.current[bus.id] = marker;
      }
    });
  }, [map, buses, visibleLineIds, showBuses, lang]);

  // Drop every marker when the map itself goes away.
  useEffect(
    () => () => {
      Object.values(markersRef.current).forEach((m: L.Marker) => m.remove());
      markersRef.current = {};
    },
    [map],
  );

  return null;
};
