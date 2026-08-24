import React, { useEffect, useRef, useState } from 'react';
import { escapeHtml } from './escapeHtml';
import { Lang, translations } from '../../i18n';
import L from 'leaflet';
import { BusStop, BusLine } from '../../types';
import { poleCode } from '../../data/transitData';

/**
 * Stop and line names come from a scraped source and are written into innerHTML below.
 * They contain no markup today; escaping keeps it that way if the source ever changes.
 */
interface StopLayerProps {
  map: L.Map | null;
  stops: BusStop[];
  lines: BusLine[];
  /** Lines to draw; null means every line. */
  visibleLineIds: string[] | null;
  /** The one line to emphasise, if any. */
  selectedStop?: BusStop;
  showStops: boolean;
  onSelectStop: (stop: BusStop) => void;
  /** Open a line's own page. The badges in a stop popup are the shortest way there. */
  onOpenLine: (line: BusLine) => void;
  lang: Lang;
}

/**
 * Below this zoom only interchanges are drawn. Every serious transit map declutters this
 * way: 429 dots over a city-wide view hide the very lines they belong to, and none of
 * them can carry a label at that scale anyway.
 */
const ALL_STOPS_FROM_ZOOM = 15;
/** How many lines a stop needs to stay on screen when zoomed out. */
const INTERCHANGE_MIN_LINES = 6;

/* Canvas markers sit on CARTO's tiles, which stay light whatever theme the app is in,
   and Leaflet bakes the colour when the layer is built rather than re-reading it. Both
   reasons say: fixed values here, tokens only in the popup HTML, which is real DOM. */
export const StopLayer: React.FC<StopLayerProps> = ({
  map,
  stops,
  lines,
  visibleLineIds,
  selectedStop,
  showStops,
  onSelectStop,
  onOpenLine,
  lang,
}) => {
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;
  const onOpenLineRef = useRef(onOpenLine);
  onOpenLineRef.current = onOpenLine;

  const [zoom, setZoom] = useState<number>(() => map?.getZoom() ?? 14);
  useEffect(() => {
    if (!map) return;
    const sync = () => setZoom(map.getZoom());
    sync();
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    const group = L.layerGroup().addTo(map);
    markersRef.current = {};

    if (showStops) {
      const onLine =
        visibleLineIds === null ? stops : stops.filter((s) => s.lines.some((l) => visibleLineIds.includes(l)));
      // A filtered set is sparse enough to show whole at any zoom.
      const detailed = zoom >= ALL_STOPS_FROM_ZOOM || visibleLineIds !== null;
      const visible = detailed
        ? onLine
        : onLine.filter((s) => s.lines.length >= INTERCHANGE_MIN_LINES || s.id === selectedStop?.id);

      visible.forEach((stop) => {
        // circleMarker draws into the map's shared canvas. divIcon, used here before,
        // creates one DOM node per stop — 429 of them on the overview.
        const marker = L.circleMarker([stop.lat, stop.lng], {
          radius: 5,
          color: '#ffffff',
          weight: 2,
          fillColor: '#0f172a',
          fillOpacity: 1,
        });

        const code = poleCode(stop);

        marker.bindTooltip(
          `<div style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--c-ink); padding: 3px 5px;">
            ${code ? `<span style="color: var(--c-accent); margin-right: 5px;">${escapeHtml(code)}</span>` : ''}${escapeHtml(stop.name)}
          </div>`,
          { direction: 'top', offset: [0, -8], opacity: 0.95, className: 'stop-hover-tooltip' },
        );

        const servingLines = stop.lines
          .map((l) => lines.find((li) => li.id === l))
          .filter((l): l is BusLine => Boolean(l));

        // Buttons, not spans: a badge is the obvious thing to press to read that line.
        const linesBadges = servingLines
          .map(
            (l) =>
              `<button type="button" data-line-id="${escapeHtml(l.id)}" title="${escapeHtml(l.name)}" style="background-color: ${escapeHtml(l.color)}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 12px; margin-right: 4px; border: none; cursor: pointer;">${escapeHtml(l.number)}</button>`,
          )
          .join('');

        const viewText = translations(lang).map.viewStopDepartures;

        const popup = document.createElement('div');
        popup.className = 'p-1 min-w-[200px] font-sans';
        popup.innerHTML = `
          <div style="font-weight: 600; font-size: 15px; color: var(--c-ink); margin-bottom: 3px;">${escapeHtml(stop.name)}</div>
          <div style="font-size: 12px; color: var(--c-ink-3); margin-bottom: 8px;">${code ? `${escapeHtml(translations(lang).map.stopCode)}: <b>${escapeHtml(code)}</b> &bull; ` : ''}${escapeHtml(stop.zone)}</div>
          <div style="margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px;">${linesBadges}</div>
          <button data-stop-times="1" style="width: 100%; min-height: 44px; background-color: var(--c-accent); color: var(--c-on-accent); border: none; border-radius: 9px; padding: 0 12px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; cursor: pointer;">
            ${viewText} &rarr;
          </button>
        `;
        // Wire the button by reference. Building a querySelector from stop.id used to
        // throw for any id that is not a valid CSS identifier.
        popup.querySelector('button[data-stop-times]')?.addEventListener('click', () => onSelectStopRef.current(stop));
        popup.querySelectorAll<HTMLButtonElement>('button[data-line-id]').forEach((badge) => {
          const line = servingLines.find((l) => l.id === badge.dataset.lineId);
          if (line) badge.addEventListener('click', () => onOpenLineRef.current(line));
        });

        marker.bindPopup(popup);
        group.addLayer(marker);
        markersRef.current[stop.id] = marker;
      });
    }

    return () => {
      group.remove();
      markersRef.current = {};
    };
  }, [map, stops, lines, visibleLineIds, showStops, lang, zoom, selectedStop?.id]);

  // Selection restyles one marker rather than rebuilding the layer.
  useEffect(() => {
    const selectedId = selectedStop?.id;
    Object.entries(markersRef.current).forEach(([id, marker]: [string, L.CircleMarker]) => {
      const isSelected = id === selectedId;
      marker.setStyle({
        radius: isSelected ? 9 : 5,
        fillColor: isSelected ? '#2563eb' : '#0f172a',
        weight: isSelected ? 3 : 2,
      });
      if (isSelected) marker.bringToFront();
    });
  }, [selectedStop?.id, zoom]);

  return null;
};
