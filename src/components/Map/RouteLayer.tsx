import React, { useEffect, useRef } from 'react';
import { Lang, translations } from '../../i18n';
import { escapeHtml } from './escapeHtml';
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
}

export const RouteLayer: React.FC<RouteLayerProps> = ({
  map,
  lines,
  visibleLineIds,
  showRoutes,
  lang,
  onSelectLine,
}) => {
  const groupRef = useRef<L.LayerGroup | null>(null);

  // The parent passes a fresh arrow every render. Keeping it in a ref stops that
  // from re-running the effect and redrawing the whole map on each live-bus tick.
  const onSelectLineRef = useRef(onSelectLine);
  onSelectLineRef.current = onSelectLine;

  useEffect(() => {
    if (!map) return;

    const group = L.layerGroup().addTo(map);
    groupRef.current = group;

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
            `<div class="font-sans text-label"><b>${escapeHtml(translations(lang).lines.lineLabel(line.number))}</b><br/>${escapeHtml(dir.name)}</div>`,
            { sticky: true, className: 'transit-map-tooltip' },
          );
          polyline.on('click', () => onSelectLineRef.current(line));

          // A 3px line is hard to grab; an invisible fat line underneath widens the hit area.
          const hitArea = L.polyline(dir.pathCoordinates, { color: line.color, weight: 14, opacity: 0 });
          hitArea.on('click', () => onSelectLineRef.current(line));

          group.addLayer(hitArea);
          group.addLayer(polyline);
        });
      });
    }

    return () => {
      group.remove();
      groupRef.current = null;
    };
  }, [map, lines, visibleLineIds, showRoutes]);

  return null;
};
