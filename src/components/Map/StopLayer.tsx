import React, { useEffect, useRef, useState } from 'react';
import { escapeHtml } from './escapeHtml';
import L from 'leaflet';
import { BusStop } from '../../types';
import { poleCode } from '../../data/transitData';
import { useIsDark } from '../../hooks/useIsDark';
import { mapColors } from './palette';

/**
 * Stop and line names come from a scraped source and are written into innerHTML below.
 * They contain no markup today; escaping keeps it that way if the source ever changes.
 */
interface StopLayerProps {
  map: L.Map | null;
  stops: BusStop[];
  /** Lines to draw; null means every line. */
  visibleLineIds: string[] | null;
  /** The one line to emphasise, if any. */
  selectedStop?: BusStop;
  showStops: boolean;
  /** A stop was tapped. The board for it rises over the map; this layer only reports it. */
  onTapStop: (stop: BusStop) => void;
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

/* Canvas markers are drawn into the map's shared canvas, and Leaflet bakes the colour in
   when the layer is built rather than re-reading it, so these are fixed values read from
   the theme at build time rather than CSS tokens. */
export const StopLayer: React.FC<StopLayerProps> = ({
  map,
  stops,
  visibleLineIds,
  selectedStop,
  showStops,
  onTapStop,
}) => {
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const colors = mapColors(useIsDark());
  // Held in a ref so a fresh arrow from the parent does not rebuild every marker.
  const onTapStopRef = useRef(onTapStop);
  onTapStopRef.current = onTapStop;

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
        // 271 of the 417 carry a code on the pole. That used to be drawn — a size up and a
        // heavier ring — and it did not read: two pixels of radius between dots that are
        // four to seven pixels wide is a difference nobody sees, and the thing it was
        // signalling is not what anybody comes to this screen to find. Every stop is drawn
        // the same now; the code still appears in the sheet and in the hover label, where
        // it is a fact you can act on rather than a hint you have to decode.

        // circleMarker draws into the map's shared canvas. divIcon, used here before,
        // creates one DOM node per stop — 417 of them on the overview.
        const marker = L.circleMarker([stop.lat, stop.lng], {
          radius: rung.radius,
          color: colors.stopStroke,
          weight: 2,
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

        /* Tapping a stop opens the stop, in a sheet over the map.
           It used to open a Leaflet popup built here as an HTML string, whose only real
           content was a button that switched tabs — so the question that brings people to
           this screen, "that stop there, when does it come", was answered by leaving the
           screen. The board rises over the map instead, and building it as a component
           takes fifty lines of innerHTML and escaping out of this file with it.

           Claim the click while we are at it. Nearly every stop stands on a route, and the
           route layer answers map clicks within twenty pixels of a line; both fired, and
           the route layer's answer replaced this one. Leaflet runs layer handlers before
           the map's own, so the mark is always set by the time it looks. */
        marker.on('click', (e: L.LeafletMouseEvent) => {
          (e.originalEvent as MouseEvent & { _stopClaimed?: boolean })._stopClaimed = true;
          onTapStopRef.current(stop);
        });

        group.addLayer(marker);
        markersRef.current[stop.id] = marker;
      });
    }

    return () => {
      group.remove();
      markersRef.current = {};
    };
  }, [map, stops, visibleLineIds, showStops, zoom, selectedStop?.id]);

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
