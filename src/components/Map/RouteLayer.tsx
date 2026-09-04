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
  /**
   * The one line being looked at, drawn in full over the rest.
   *
   * Picking a line used to remove every other route from the map, which answered the
   * question "where does the 6 go" and destroyed the answer to "and where does that leave
   * me" — a route with nothing around it is a shape, not a place. The others stay, thin
   * and faint, so the chosen one is read against the network it belongs to.
   */
  emphasisLineId?: string | null;
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
 * How far apart to run routes that share a street, in metres on the ground.
 *
 * Lugo's lines converge on the same handful of corridors — Rda. da Muralla, Avda. da
 * Coruña — and drawn on their true geometry they are not close together, they are
 * *identical*, one polyline hiding five. Whichever Leaflet painted last was the only one
 * anybody could see.
 *
 * So each route is shifted sideways off the centreline by a fixed distance on the ground,
 * which is how a transit map has always done this. Metres and not pixels because a ground
 * offset scales with the map for free: separate at the zoom where you are reading street
 * names, merged back into one corridor when you are looking at the whole city, which is
 * the right answer at both ends and needs no redraw on zoom.
 *
 * Six metres is about half a lane. A route drawn that far off the centreline still reads
 * as being on its street — city streets are 10 to 20 m wide — while five of them side by
 * side span 30 m and are plainly five.
 */
const LANE_METRES = 6;

/**
 * How many distinct lanes there are before they start being reused.
 *
 * Twenty-four lines cannot each have their own lane: at six metres that would spread a
 * shared corridor across 144 m, which is no longer a street. Nine lanes span 48 m, which
 * is a wide avenue, and no real corridor here carries nine lines anyway — so in practice
 * the reuse never shows, and where it did the two sharing a lane would be no worse off
 * than every line was before.
 */
const LANES = 9;

/**
 * Shift a path sideways by `metres`, perpendicular to its own direction.
 *
 * Each vertex moves along the average of the perpendiculars of the segments meeting
 * there, which keeps corners joined instead of opening a wedge on every turn.
 *
 * Degrees per metre are not constant, so the maths is done in a local metric frame:
 * latitude is a flat 111,320 m per degree, longitude is that times the cosine of where
 * you are. At Lugo's 43°N that cosine is 0.731, so dropping it would draw east-west
 * offsets 1.37 times too wide — checked by measuring a due-north and a due-east street,
 * which both come back at 6.00 m.
 */
function offsetPath(coords: [number, number][], metres: number): [number, number][] {
  if (metres === 0 || coords.length < 2) return coords;
  const M_PER_DEG_LAT = 111_320;
  const perpendiculars: [number, number][] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[i + 1];
    const cos = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const dx = (lng2 - lng1) * cos * M_PER_DEG_LAT;
    const dy = (lat2 - lat1) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    // A repeated coordinate has no direction to be perpendicular to; carry the last one.
    perpendiculars.push(len === 0 ? (perpendiculars[i - 1] ?? [0, 0]) : [dy / len, -dx / len]);
  }

  return coords.map(([lat, lng], i) => {
    const before = perpendiculars[i - 1];
    const after = perpendiculars[i];
    const px = ((before?.[0] ?? after?.[0] ?? 0) + (after?.[0] ?? before?.[0] ?? 0)) / 2;
    const py = ((before?.[1] ?? after?.[1] ?? 0) + (after?.[1] ?? before?.[1] ?? 0)) / 2;
    const norm = Math.hypot(px, py) || 1;
    const cos = Math.cos(lat * (Math.PI / 180)) || 1;
    return [
      lat + ((py / norm) * metres) / M_PER_DEG_LAT,
      lng + ((px / norm) * metres) / (M_PER_DEG_LAT * cos),
    ];
  });
}

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
  emphasisLineId,
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

    // The path as drawn, not as stored: a click has to be measured against the line the
    // reader can see, which is the offset one.
    const drawn: {
      line: BusLine;
      dir: BusLine['directions'][number];
      path: [number, number][];
    }[] = [];

    if (showRoutes) {
      const showingAll = visibleLineIds === null;
      const inScope = showingAll ? lines : lines.filter((l) => visibleLineIds.includes(l.id));
      const emphasised = emphasisLineId ? inScope.find((l) => l.id === emphasisLineId) : undefined;
      // Emphasised last, so it is painted over the network rather than under it.
      const linesToRender = emphasised
        ? [...inScope.filter((l) => l.id !== emphasised.id), emphasised]
        : inScope;
      // Both directions only when there is one line and nothing else competing for the
      // corridor; otherwise ida and volta are two more traces in an already busy street.
      const singleLine = linesToRender.length === 1;

      linesToRender.forEach((line, lineIndex) => {
        const isEmphasised = line.id === emphasisLineId;
        // A backdrop, not a second subject: thin enough to read the chosen line over, dark
        // enough to still say a street carries a bus.
        const muted = Boolean(emphasised) && !isEmphasised;
        // Ida and volta run the same corridor, so drawing both at once just stacks
        // one polyline on top of the other. Show the outbound trace in the overview
        // and only split the two apart once a single line is selected.
        const directions = isEmphasised || singleLine ? line.directions : line.directions.slice(0, 1);

        directions.forEach((dir, dirIndex) => {
          if (!dir.pathCoordinates || dir.pathCoordinates.length < 2) return;

          const isReturn = dirIndex === 1;

          /* Which lane this trace runs in.
             With one line on screen the two lanes are its own directions, half a lane
             either side of the centreline — ida and volta share the whole corridor, which
             is why the return had to be dashed to be told apart at all. With several
             lines it is one lane each, dealt out around the centre so the group stays
             centred on the street rather than drifting off one side of it. */
          const laneMetres =
            isEmphasised || singleLine
              ? (isReturn ? 1 : -1) * (LANE_METRES / 2)
              : ((lineIndex % LANES) - Math.floor(LANES / 2)) * LANE_METRES;
          const path = offsetPath(dir.pathCoordinates as [number, number][], laneMetres);

          const polyline = L.polyline(path, {
            color: line.color,
            weight: muted ? 2 : isEmphasised || singleLine ? 5 : 3.5,
            opacity: muted ? 0.35 : isEmphasised || singleLine ? 0.95 : 0.7,
            dashArray: isReturn ? '10 7' : undefined,
            lineJoin: 'round',
            lineCap: 'round',
          });

          polyline.bindTooltip(
            `<div class="font-sans text-label"><b>${escapeHtml(translations(lang).lines.lineLabel(line.number))}</b><br/>${escapeHtml(directionLabel(dir, lang))}</div>`,
            { sticky: true, className: 'transit-map-tooltip' },
          );

          /* No click handler on the route, and no invisible fat line under it either.
             Both used to be here. The handlers are what made stops unreachable — layer
             handlers run before the map's, and these were added before the stop layer's,
             so they answered the click before the stop could say it was its. Answering
             only from the map-level handler below fixed that.
             Which left the grab area doing nothing at all: no handler, and the tooltip is
             bound to the visible line, not to it. It was one inert 14 px polyline per
             route, and the comment beside it claimed it widened hover. What actually
             makes a 3 px line easy to hit is HIT_PX up top: the map handler measures the
             distance from the click to every route in pixels and takes anything within
             twenty, which is wider than the invisible line ever was. */
          group.addLayer(polyline);
          drawn.push({ line, dir, path });
        });
      });
    }

    const openLinesHere = (e: L.LeafletMouseEvent) => {
      // A stop got there first. Stops sit on routes, so without this the route popup
      // opened over the stop popup a moment after it and the stop was unreachable —
      // its times, its code and its lines all behind a click that could not be made.
      // The stop layer marks the DOM event from its own click handler, and Leaflet runs
      // every layer handler before the map's, so the mark is always set by now.
      if ((e.originalEvent as MouseEvent & { _stopClaimed?: boolean })?._stopClaimed) return;
      const click = map.latLngToContainerPoint(e.latlng);
      const hits = drawn
        .map(({ line, dir, path }) => {
          let nearest = Infinity;
          const pts = path.map((c) => map.latLngToContainerPoint(c as L.LatLngTuple));
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
    // The only place a route click is answered.
    //
    // The comment that used to be here said the map never hears a click that lands on a
    // layer, which is why each route also listened for itself. That is true of Leaflet's
    // SVG renderer and not of the canvas one this map uses: the canvas renderer fires the
    // layer events and the map's click both, so the per-route handlers were a second
    // answer to the same click — and, being registered before the stop layer existed, the
    // first one. Answering only here means every layer has already had its say, including
    // the stop that was tapped.
    map.on('click', openLinesHere);

    return () => {
      map.off('click', openLinesHere);
      group.remove();
      groupRef.current = null;
    };
  }, [map, lines, visibleLineIds, emphasisLineId, showRoutes, lang]);

  return null;
};
