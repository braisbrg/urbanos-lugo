import React, { useEffect, useRef } from 'react';
import { Lang, translations } from '../../i18n';
import { escapeHtml } from './escapeHtml';
import { directionLabel } from '../../utils/serviceLabels';
import L from 'leaflet';
import { BusLine } from '../../types';

/** Tooltip strings are rendered as HTML by Leaflet. */
interface RouteLayerProps {
  map: L.Map | null;
  lines: BusLine[];
  /** Lines to draw; null means every line. */
  visibleLineIds: string[] | null;
  showRoutes: boolean;
  lang: Lang;
  onSelectLine: (line: BusLine) => void;
  onOpenLine: (line: BusLine) => void;
}

/**
 * How close a click has to land, in screen pixels, to count as hitting a route.
 *
 * A drawn route is 3.5 px wide and nobody aims at 3.5 px. Measured on a real click
 * that plainly looked like it was on the line, the nearest segment was 16 px away.
 * The invisible grab area under each route is already 14 px wide, so this is the same
 * promise made to the click that lands beside it rather than on it. Being generous
 * only lengthens the list, and the nearest route is always first.
 */
const HIT_PX = 20;

/**
 * The routes under a click, as a node so the buttons can carry real handlers.
 *
 * Built rather than templated because a corridor can carry six lines and the reader
 * has to be able to say which one they meant — the map used to answer for them, with
 * whichever polyline Leaflet happened to draw last.
 */
function linesHerePopup(
  hits: { line: BusLine; dir: BusLine['directions'][number] }[],
  lang: Lang,
  onSelect: (line: BusLine) => void,
  onOpen: (line: BusLine) => void,
): HTMLElement {
  const t = translations(lang);
  const node = document.createElement('div');
  node.className = 'font-sans';
  node.innerHTML = `
    <div style="min-width: 210px; padding: 2px; color: var(--c-ink);">
      <div style="font-size: 12px; font-weight: 700; color: var(--c-ink-3); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px;">
        ${escapeHtml(t.map.linesHere)}
      </div>
      <div data-rows="1" style="display: flex; flex-direction: column; gap: 4px;"></div>
    </div>`;

  const rows = node.querySelector('[data-rows]')!;
  for (const { line, dir } of hits) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:stretch; gap:4px;';
    row.innerHTML = `
      <button type="button" data-draw="1" title="${escapeHtml(t.map.drawRoute)}"
        style="display:flex; flex:1; align-items:center; gap:8px; min-height:44px; padding:0 8px; background:none; border:none; cursor:pointer; text-align:left; font-family:inherit;">
        <span style="background-color:${escapeHtml(line.color)}; color:#fff; font-weight:700; font-size:12px; padding:3px 7px; border-radius:5px;">${escapeHtml(line.number)}</span>
        <span style="font-size:13px; color:var(--c-ink-2);">${escapeHtml(directionLabel(dir, lang))}</span>
      </button>
      <button type="button" data-open="1" title="${escapeHtml(t.map.openLineInfo)}"
        aria-label="${escapeHtml(t.map.openLineInfo)}: ${escapeHtml(line.number)}"
        style="min-height:44px; width:44px; background:none; border:none; cursor:pointer; color:var(--c-accent); font-size:16px;">&rarr;</button>`;
    row.querySelector('button[data-draw]')?.addEventListener('click', () => onSelect(line));
    row.querySelector('button[data-open]')?.addEventListener('click', () => onOpen(line));
    rows.appendChild(row);
  }
  return node;
}

export const RouteLayer: React.FC<RouteLayerProps> = ({
  map,
  lines,
  visibleLineIds,
  showRoutes,
  lang,
  onSelectLine,
  onOpenLine,
}) => {
  const groupRef = useRef<L.LayerGroup | null>(null);

  // The parent passes a fresh arrow every render. Keeping it in a ref stops that
  // from re-running the effect and redrawing the whole map on each live-bus tick.
  const onSelectLineRef = useRef(onSelectLine);
  onSelectLineRef.current = onSelectLine;
  const onOpenLineRef = useRef(onOpenLine);
  onOpenLineRef.current = onOpenLine;

  useEffect(() => {
    if (!map) return;

    const group = L.layerGroup().addTo(map);
    groupRef.current = group;

    const drawn: { line: BusLine; dir: BusLine['directions'][number] }[] = [];

    if (showRoutes) {
      const showingAll = visibleLineIds === null;
      const linesToRender = showingAll ? lines : lines.filter((l) => visibleLineIds.includes(l.id));
      // Both directions only when a single line is on screen; otherwise they stack.
      const singleLine = linesToRender.length === 1;

      linesToRender.forEach((line) => {
        // Ida and volta run the same corridor, so drawing both at once just stacks
        // one polyline on top of the other. Show the outbound trace in the overview
        // and only split the two apart once a single line is selected.
        const directions = singleLine ? line.directions : line.directions.slice(0, 1);

        directions.forEach((dir, dirIndex) => {
          if (!dir.pathCoordinates || dir.pathCoordinates.length < 2) return;

          const isReturn = dirIndex === 1;
          const polyline = L.polyline(dir.pathCoordinates, {
            color: line.color,
            weight: singleLine ? 5 : 3.5,
            opacity: singleLine ? 0.9 : 0.7,
            dashArray: isReturn ? '10 7' : undefined,
            lineJoin: 'round',
            lineCap: 'round',
          });

          polyline.bindTooltip(
            `<div class="font-sans text-label"><b>${escapeHtml(translations(lang).lines.lineLabel(line.number))}</b><br/>${escapeHtml(directionLabel(dir, lang))}</div>`,
            { sticky: true, className: 'transit-map-tooltip' },
          );

          // A 3px line is hard to grab; an invisible fat line underneath widens the hit area.
          // A 3 px line is hard to grab; an invisible fat one underneath widens it.
          const hitArea = L.polyline(dir.pathCoordinates, { color: line.color, weight: 14, opacity: 0 });
          hitArea.on('click', (e) => openLinesHere(e as L.LeafletMouseEvent));
          polyline.on('click', (e) => openLinesHere(e as L.LeafletMouseEvent));

          group.addLayer(hitArea);
          group.addLayer(polyline);
          drawn.push({ line, dir });
        });
      });
    }

    const openLinesHere = (e: L.LeafletMouseEvent) => {
      const click = map.latLngToContainerPoint(e.latlng);
      const hits = drawn
        .map(({ line, dir }) => {
          let nearest = Infinity;
          const pts = dir.pathCoordinates.map((c) => map.latLngToContainerPoint(c as L.LatLngTuple));
          for (let i = 1; i < pts.length; i++) {
            const d = L.LineUtil.pointToSegmentDistance(click, pts[i - 1], pts[i]);
            if (d < nearest) nearest = d;
          }
          return { line, dir, d: nearest };
        })
        .filter((h) => h.d <= HIT_PX)
        .sort((a, b) => a.d - b.d);

      if (!hits.length) return;
      L.popup({ closeButton: true, className: 'transit-map-popup' })
        .setLatLng(e.latlng)
        .setContent(linesHerePopup(hits, lang, onSelectLineRef.current, onOpenLineRef.current))
        .openOn(map);
    };
    // Leaflet hands a click to the topmost interactive layer and stops there, so the
    // map-level listener never hears about a click that lands on a route. Every route
    // asks the same question instead, and the map catches whatever falls between them.
    map.on('click', openLinesHere);

    return () => {
      map.off('click', openLinesHere);
      group.remove();
      groupRef.current = null;
    };
  }, [map, lines, visibleLineIds, showRoutes, lang]);

  return null;
};
