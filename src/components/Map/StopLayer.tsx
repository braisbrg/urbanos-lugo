import React, { useEffect, useRef, useState } from 'react';
import { escapeHtml } from './escapeHtml';
import { Lang, translations } from '../../i18n';
import L from 'leaflet';
import { BusStop, BusLine } from '../../types';
import { poleCode } from '../../data/transitData';
import { getNearbyLines } from '../../utils/transitEngine';
import { useIsDark } from '../../hooks/useIsDark';
import { mapColors } from './palette';

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
  /** Narrow the map to the lines that serve this stop, without leaving the map. */
  onShowLinesHere: (stop: BusStop) => void;
  lang: Lang;
}

/**
 * How much of the network appears as you come in, and how big it is drawn.
 *
 * This was a cliff, not a ladder: below zoom 15 only stops with six lines or more were
 * drawn — 46 of the 417 — and at 15 all 417 arrived at once, every one of them a 5px dot
 * whatever the zoom. Coming in one step went from eleven per cent of the network to all
 * of it, and going further in made nothing easier to hit or to read.
 *
 * The rungs are cut by how many lines a stop serves, because that is what makes one worth
 * seeing from far away: 46 stops serve six lines or more, 109 serve four or more, 233
 * serve two or more, and the remaining 184 are the single-line long tail that only means
 * anything once you are looking at your own street.
 *
 * `label` is the change that matters on a phone. Names lived in a hover tooltip, and a
 * phone has no hover — so no matter how far you zoomed, no stop ever told you its name,
 * on the one screen meant for working out where you are.
 */
const ZOOM_LADDER: { from: number; minLines: number; radius: number; label: boolean }[] = [
  { from: 16, minLines: 0, radius: 7, label: true },
  { from: 15, minLines: 2, radius: 6, label: false },
  { from: 14, minLines: 4, radius: 5, label: false },
  { from: 0, minLines: 6, radius: 4, label: false },
];

const rungFor = (zoom: number) => ZOOM_LADDER.find((r) => zoom >= r.from) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1];

/** How many lines a stop needs to stay on screen when zoomed out. */
/** Matches the board: near enough to walk when the wait is long. */
const NEARBY_LINE_RADIUS_M = 400;
const NEARBY_LINE_LIMIT = 6;

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
  onShowLinesHere,
  lang,
}) => {
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const colors = mapColors(useIsDark());
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;
  const onOpenLineRef = useRef(onOpenLine);
  onOpenLineRef.current = onOpenLine;
  const onShowLinesHereRef = useRef(onShowLinesHere);
  onShowLinesHereRef.current = onShowLinesHere;

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
      const rung = rungFor(zoom);
      // A filtered set is sparse enough to show whole at any zoom.
      const detailed = visibleLineIds !== null;
      const visible = detailed
        ? onLine
        : onLine.filter((s) => s.lines.length >= rung.minLines || s.id === selectedStop?.id);

      visible.forEach((stop) => {
        const code = poleCode(stop);
        // 271 of the 417 carry a code on the pole: those are the ones you can scan, and
        // the ones the operator's own page knows about. Drawn a size up with a heavier
        // ring so the difference is visible before you tap, rather than only after.
        const scannable = Boolean(code);

        // circleMarker draws into the map's shared canvas. divIcon, used here before,
        // creates one DOM node per stop — 417 of them on the overview.
        const marker = L.circleMarker([stop.lat, stop.lng], {
          radius: scannable ? rung.radius : Math.max(3, rung.radius - 2),
          color: colors.stopStroke,
          weight: scannable ? 2.5 : 1.5,
          fillColor: colors.stopFill,
          fillOpacity: 1,
        });

        // One tooltip per marker: binding twice replaces the first, so this is either the
        // name written beside the dot and left there, or the one that opens on hover —
        // never both. Close in the name is already on screen, which is the point of it.
        if (rung.label) {
          // `auto` and not `right`: a name is written beside its dot, and a dot near the
          // right edge of a 375 px phone put the name off the screen — measured, three of
          // the thirteen on view at zoom 16, the widest of them 157 px. Leaflet's own
          // `auto` flips the side once the marker passes the middle of the map, which is
          // the whole of the fix and none of the arithmetic.
          marker.bindTooltip(escapeHtml(stop.name), {
            permanent: true,
            direction: 'auto',
            offset: [rung.radius + 2, 0],
            className: 'stop-name-label',
          });
        } else {
          marker.bindTooltip(
            `<div style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--c-ink); padding: 3px 5px;">
              ${code ? `<span style="color: var(--c-accent); margin-right: 5px;">${escapeHtml(code)}</span>` : ''}${escapeHtml(stop.name)}
            </div>`,
            { direction: 'top', offset: [0, -8], opacity: 0.95, className: 'stop-hover-tooltip' },
          );
        }

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

        // Lines that pass within a short walk without calling here.
        const nearby = getNearbyLines(stop.lat, stop.lng, NEARBY_LINE_RADIUS_M)
          .filter((n) => !stop.lines.includes(n.line.id))
          .sort((a, b) => a.walkMeters - b.walkMeters)
          .slice(0, NEARBY_LINE_LIMIT);
        const nearbyBadges = nearby
          .map(
            (n) =>
              `<button type="button" data-line-id="${escapeHtml(n.line.id)}" title="${escapeHtml(n.line.name)} — ~${Math.round(n.walkMeters)} m" style="background-color: ${escapeHtml(n.line.color)}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 12px; border: none; cursor: pointer; opacity: 0.75;">${escapeHtml(n.line.number)}</button>`,
          )
          .join('');

        const popup = document.createElement('div');
        popup.className = 'p-1 min-w-[200px] font-sans';
        popup.innerHTML = `
          <div style="font-weight: 600; font-size: 15px; color: var(--c-ink); margin-bottom: 3px;">${escapeHtml(stop.name)}</div>
          <div style="font-size: 12px; color: var(--c-ink-3); margin-bottom: 8px;">${code ? `${escapeHtml(translations(lang).map.stopCode)}: <b>${escapeHtml(code)}</b> &bull; ` : ''}${escapeHtml(stop.zone)}</div>
          <div style="margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px;">${linesBadges}</div>
          ${nearby.length ? `<div style="margin-bottom: 10px;">
            <div style="font-size: 12px; color: var(--c-ink-3); margin-bottom: 4px;">${escapeHtml(translations(lang).arrivals.nearbyLinesTitle)}</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">${nearbyBadges}</div>
          </div>` : ''}
          <button data-stop-times="1" style="width: 100%; min-height: 44px; background-color: var(--c-accent); color: var(--c-on-accent); border: none; border-radius: 9px; padding: 0 12px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; cursor: pointer;">
            ${viewText} &rarr;
          </button>
          <button data-lines-here="1" style="width: 100%; min-height: 44px; margin-top: 6px; background: transparent; color: var(--c-ink-2); border: 1px solid var(--c-border); border-radius: 9px; padding: 0 12px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; cursor: pointer;">
            ${escapeHtml(translations(lang).map.onlyLinesHere)}
          </button>
        `;
        // Wire the button by reference. Building a querySelector from stop.id used to
        // throw for any id that is not a valid CSS identifier.
        popup.querySelector('button[data-stop-times]')?.addEventListener('click', () => onSelectStopRef.current(stop));
        // Acts on the map behind the popup, so the popup gets out of the way first.
        popup.querySelector('button[data-lines-here]')?.addEventListener('click', () => {
          marker.closePopup();
          onShowLinesHereRef.current(stop);
        });
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
        color: colors.stopStroke,
        fillColor: isSelected ? colors.stopSelected : colors.stopFill,
        weight: isSelected ? 3 : 2,
      });
      if (isSelected) marker.bringToFront();
    });
  }, [selectedStop?.id, zoom, colors]);

  return null;
};
