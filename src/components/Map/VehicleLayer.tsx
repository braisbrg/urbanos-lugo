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
 * The bus, and how sure the map is about where it is.
 *
 * Not sure at all, is the answer. Every position here is computed from the timetable —
 * where a bus that left on time would be by now — and the operator publishes no live
 * feed for anyone to check it against. The popup has always said so in words. The marker
 * said the opposite: a crisp square pin, drawn exactly like the stops around it, which
 * are surveyed coordinates that do not move.
 *
 * The dashed ring is that sentence in the marker itself. Dashed rather than solid, and
 * wider than the badge, because that is what a map means by "somewhere around here" —
 * the same idea as the accuracy circle drawn around the reader's own position, which is
 * also a claim about uncertainty rather than a point.
 *
 * Neutral, not the line's colour. It began as the line's colour at 55% and was invisible
 * on the dark basemap, which is the failure that matters most for the one element whose
 * whole job is to qualify a claim. Neutral is also the truer colour: the ring means
 * "uncertain", not "line 1.1" — the badge already says which line. `--c-ink-2` reads on
 * both basemaps because it flips with the theme, and the hairline of `--c-bg` on either
 * side of the dash keeps it off whatever it happens to be crossing.
 */
function busIcon(bus: ScheduledBus): L.DivIcon {
  return L.divIcon({
    className: 'custom-bus-marker',
    html: `
      <div class="relative cursor-pointer">
        <div class="pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full"
             style="border: 2px dashed var(--c-ink-2); opacity: 0.8;
                    box-shadow: 0 0 0 1px var(--c-bg), inset 0 0 0 1px var(--c-bg);"></div>
        <div class="w-8 h-8 rounded-lg shadow-md flex items-center justify-center text-white ring-2 ring-white"
             style="background-color: ${escapeHtml(bus.lineColor)}">
          <span class="text-label font-bold tracking-tight">${bus.lineNumber}</span>
        </div>
        <!-- Which way it is going.
             Three goes at this. It began as a CSS border triangle orbiting 15 px from the
             centre of a 32 px badge — so it sat inside the square — drawn in the same
             colour as that square, 8 px across. Moving it out and adding a drop-shadow
             was still not enough to see: a 1.5 px shadow is not an outline, and a small
             shape in the line's own colour disappears next to a large shape in the line's
             own colour.
             So: SVG, with a real 2.5 px white stroke drawn behind the fill
             (paint-order), a dart rather than a plain triangle because the notch reads as
             direction at a glance, and pushed to 32 px so it clears the dashed ring
             instead of crossing it. Centre, rotate, then push out, so the distance
             follows the bearing rather than adding to it. -->
        <svg class="pointer-events-none absolute left-1/2 top-1/2" width="20" height="20"
             viewBox="0 0 20 20" aria-hidden="true"
             style="overflow: visible; transform: translate(-50%, -50%) rotate(${bus.bearing}deg) translateY(-32px);">
          <path d="M10 0.5 L18 19 L10 14.5 L2 19 Z"
                fill="${escapeHtml(bus.lineColor)}" stroke="#ffffff" stroke-width="2.5"
                stroke-linejoin="round" paint-order="stroke"></path>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
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
