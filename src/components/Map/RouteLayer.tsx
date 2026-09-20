import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { translations, useLang, type Lang } from '../../i18n';
import { escapeHtml } from '../../utils/html';
import { directionLabel } from '../../utils/serviceLabels';
import { BusDirection, BusLine, BusStop } from '../../types';
import { stopById } from '../../data/transitData';
import { metresBetween } from '../../utils/geo';
import { badgeHtml, popupBox, rowButtonStyle } from './popupHtml';

interface RouteLayerProps {
  map: L.Map | null;
  lines: BusLine[];
  /** Lines to draw; null means every line. */
  visibleLineIds: string[] | null;
  /** The lines lifted out of the network, painted in full over the rest kept faint. */
  emphasisLineIds?: string[];
  showRoutes: boolean;
  onSelectLine: (line: BusLine) => void;
  onOpenLine: (line: BusLine) => void;
}

/** How close a click has to land, in screen pixels, to count as hitting a route. Nobody aims at 3.5 px. */
const HIT_PX = 20;

/**
 * The lane, in screen pixels. Lugo's lines converge on the same corridors, so routes that
 * share a street are drawn side by side. Pixels and not metres: metres vanish at zoom 14
 * and turn a roundabout inside out at 18. Nothing below 15, where the tap on a corridor
 * lists everything that runs there.
 */
const laneWidthPx = (zoom: number): number => (zoom >= 16 ? 3 : zoom >= 15 ? 2 : 0);
/** Lanes a side before they are reused: twelve pixels a side, still narrower than the road. */
const LANES = 4;
/** The lane width the line being looked at gets whatever the zoom, so its ida and volta stay apart. */
const SUBJECT_LANE_PX = 6;

/**
 * Only the vertices a zoom can show: 26,175 vertices over 48 directions, most under a
 * pixel apart at zoom 13, and Leaflet projected and stroked every one on every redraw
 * (2.2 s blocked over four zoom steps). Douglas-Peucker at 0.7 px in the zoom's own pixel
 * frame, remembered per direction and zoom; the survivors are the original coordinates.
 */
const verticesAt = new Map<string, [number, number][]>();
function verticesFor(key: string, coords: [number, number][], zoom: number): [number, number][] {
  const cached = verticesAt.get(`${key}@${zoom}`);
  if (cached) return cached;
  const scale = 256 * 2 ** zoom;
  const points = coords.map(([lat, lng], i) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale, i };
  });
  // LineUtil.simplify only reads x and y, and hands back the same objects it was given.
  const kept = (L.LineUtil.simplify(points as unknown as L.Point[], 0.7) as unknown as typeof points).map((p) => coords[p.i]);
  verticesAt.set(`${key}@${zoom}`, kept);
  return kept;
}

const M_PER_DEG_LAT = 111_320;
const cosLat = (lat: number) => Math.cos(lat * (Math.PI / 180));

/**
 * Shift a path sideways by `metres`, perpendicular to its own direction, in a local
 * metric frame (longitude scaled by the cosine of the latitude, 0.731 here). Each vertex
 * moves along the average of its two segments' perpendiculars so corners stay joined, and
 * a vertex whose shifted segment reverses against its own original is dropped.
 */
function offsetPath(coords: [number, number][], metres: number): [number, number][] {
  if (metres === 0 || coords.length < 2) return coords;
  const perpendiculars: [number, number][] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[i + 1];
    const dx = (lng2 - lng1) * cosLat((lat1 + lat2) / 2) * M_PER_DEG_LAT;
    const dy = (lat2 - lat1) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    perpendiculars.push(len === 0 ? (perpendiculars[i - 1] ?? [0, 0]) : [dy / len, -dx / len]);
  }
  const shifted: [number, number][] = coords.map(([lat, lng], i) => {
    const before = perpendiculars[i - 1];
    const after = perpendiculars[i];
    const px = ((before?.[0] ?? after?.[0] ?? 0) + (after?.[0] ?? before?.[0] ?? 0)) / 2;
    const py = ((before?.[1] ?? after?.[1] ?? 0) + (after?.[1] ?? before?.[1] ?? 0)) / 2;
    const norm = Math.hypot(px, py) || 1;
    return [lat + ((py / norm) * metres) / M_PER_DEG_LAT, lng + ((px / norm) * metres) / (M_PER_DEG_LAT * (cosLat(lat) || 1))];
  });
  const keep: [number, number][] = [shifted[0]];
  for (let i = 1; i < shifted.length; i++) {
    const cos = cosLat(coords[i][0]);
    const ox = (coords[i][1] - coords[i - 1][1]) * cos;
    const oy = coords[i][0] - coords[i - 1][0];
    const sx = (shifted[i][1] - shifted[i - 1][1]) * cos;
    const sy = shifted[i][0] - shifted[i - 1][0];
    if (ox * sx + oy * sy >= 0 || i === shifted.length - 1) keep.push(shifted[i]);
  }
  return keep;
}

/** Direction arrows every so many screen pixels, so the density is the same at every zoom. */
const ARROW_EVERY_PX = 120;
/** Below this the city fits on the screen and chevrons would be texture. */
const ARROW_MIN_ZOOM = 14;
/** With several lines up their lanes overlap until here, and an arrow on the wrong ribbon is worse than none. */
const ARROW_MIN_ZOOM_SHARED = 17;
/** No arrow this close to a pole, so a stop dot is never half hidden under one. */
const ARROW_CLEAR_OF_STOP_M = 20;

/** Where to draw the arrows along a path and which way each points, the bearing measured in screen space. */
function arrowsAlong(path: [number, number][], keepClear: { lat: number; lng: number }[], everyMetres: number): { at: [number, number]; deg: number }[] {
  const metres = (a: [number, number], b: [number, number]) => metresBetween(a[0], a[1], b[0], b[1]);
  const out: { at: [number, number]; deg: number }[] = [];
  let untilNext = everyMetres / 2;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const length = metres(a, b);
    if (length === 0) continue;
    let walked = 0;
    while (length - walked >= untilNext) {
      walked += untilNext;
      untilNext = everyMetres;
      const t = walked / length;
      const at: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (keepClear.some((s) => metres(at, [s.lat, s.lng]) < ARROW_CLEAR_OF_STOP_M)) continue;
      // Web Mercator is conformal, so the angle is the same at every zoom.
      const pa = L.CRS.EPSG3857.latLngToPoint(L.latLng(a[0], a[1]), 16);
      const pb = L.CRS.EPSG3857.latLngToPoint(L.latLng(b[0], b[1]), 16);
      out.push({ at, deg: (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI });
    }
    untilNext -= length - walked;
  }
  return out;
}

/** An open chevron in the line's own stroke, its point on the centreline. Not interactive. */
const arrowIcon = (color: string, weight: number, deg: number): L.DivIcon =>
  L.divIcon({
    className: 'route-arrow',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html:
      `<svg width="16" height="16" viewBox="-8 -8 16 16" style="display:block;transform:rotate(${deg.toFixed(1)}deg)" aria-hidden="true">` +
      `<path d="M-4 -6 L3 0 L-4 6" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  });

/** The routes under a click, one row per line, with real handlers: a corridor can carry six lines and the reader says which. */
function linesHerePopup(hits: { line: BusLine; dir: BusDirection }[], lang: Lang, onSelect: (line: BusLine) => void, onOpen: (line: BusLine) => void): HTMLElement {
  const t = translations(lang);
  const node = document.createElement('div');
  node.className = 'font-sans';
  node.innerHTML = popupBox(
    `<div style="font-size: 12px; font-weight: 700; color: var(--c-ink-3); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px;">${escapeHtml(t.map.linesHere)}</div>` +
      `<div data-rows="1" style="display: flex; flex-direction: column; gap: 4px;"></div>`,
    210,
  );
  const byLine = new Map<string, { line: BusLine; dirs: BusDirection[] }>();
  for (const { line, dir } of hits) byLine.set(line.id, { line, dirs: [...(byLine.get(line.id)?.dirs ?? []), dir] });
  const rows = node.querySelector('[data-rows]')!;
  for (const { line, dirs } of byLine.values()) {
    const where = dirs.length > 1 ? t.map.bothDirections : directionLabel(dirs[0], lang);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:stretch; gap:4px;';
    row.innerHTML =
      `<button type="button" data-draw="1" title="${escapeHtml(t.map.drawRoute)}" style="${rowButtonStyle} flex:1; min-height:44px; padding:0 8px;">` +
      `${badgeHtml(line.color, line.number)}<span style="font-size:13px; color:var(--c-ink-2);">${escapeHtml(where)}</span></button>` +
      `<button type="button" data-open="1" title="${escapeHtml(t.map.openLineInfo)}" aria-label="${escapeHtml(t.map.openLineInfo)}: ${escapeHtml(line.number)}" ` +
      `style="min-height:44px; width:44px; background:none; border:none; cursor:pointer; color:var(--c-accent); font-size:16px;">&rarr;</button>`;
    row.querySelector('button[data-draw]')?.addEventListener('click', () => onSelect(line));
    row.querySelector('button[data-open]')?.addEventListener('click', () => onOpen(line));
    rows.appendChild(row);
  }
  return node;
}

interface Drawn {
  line: BusLine;
  dir: BusDirection;
  path: [number, number][];
}

interface Arrowed {
  lineId: string;
  path: [number, number][];
  color: string;
  weight: number;
  poles: BusStop[];
}

export function RouteLayer({ map, lines, visibleLineIds, emphasisLineIds = [], showRoutes, onSelectLine, onOpenLine }: RouteLayerProps) {
  const lang = useLang();
  // Fractional, since the basemap lets the map settle at any zoom; read at the end of each gesture.
  const [zoom, setZoom] = useState(() => map?.getZoom() ?? 14);
  useEffect(() => {
    if (!map) return;
    const sync = () => setZoom(map.getZoom());
    sync();
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [map]);
  // Held in refs so a fresh arrow from the parent does not redraw the map on every tick.
  const onSelectLineRef = useRef(onSelectLine);
  onSelectLineRef.current = onSelectLine;
  const onOpenLineRef = useRef(onOpenLine);
  onOpenLineRef.current = onOpenLine;
  const zoomForDrawing = Math.round(zoom);

  useEffect(() => {
    if (!map) return;
    const zoom = zoomForDrawing;
    const group = L.layerGroup().addTo(map);

    if (!map.getPane('routeArrows')) {
      // Between the overlay canvas (400) and the shadow pane (500); taps pass through to the stops.
      const pane = map.createPane('routeArrows');
      pane.style.zIndex = '450';
      pane.style.pointerEvents = 'none';
    }
    const arrows = L.layerGroup();
    const metresPerPx = (156543.03 * cosLat(map.getCenter().lat)) / 2 ** zoom;
    const drawn: Drawn[] = [];
    const arrowed: Arrowed[] = [];

    // Only the arrows in view plus half a screen: a line has two hundred at zoom 16 and a phone shows a dozen.
    const placeArrows = () => {
      if (Math.round(map.getZoom()) !== zoom) return; // a zoom step fires moveend too; the rebuild handles it
      arrows.clearLayers();
      const subjectLines = new Set(arrowed.map((t) => t.lineId)).size;
      if (zoom < ARROW_MIN_ZOOM || (subjectLines > 1 && zoom < ARROW_MIN_ZOOM_SHARED)) return;
      const reach = map.getBounds().pad(0.5);
      for (const trace of arrowed) {
        for (const { at, deg } of arrowsAlong(trace.path, trace.poles, ARROW_EVERY_PX * metresPerPx)) {
          if (reach.contains(at)) arrows.addLayer(L.marker(at, { icon: arrowIcon(trace.color, trace.weight, deg), pane: 'routeArrows', interactive: false, keyboard: false }));
        }
      }
      arrows.addTo(map);
    };

    if (showRoutes) {
      const inScope = visibleLineIds === null ? lines : lines.filter((l) => visibleLineIds.includes(l.id));
      const emphasised = inScope.filter((l) => emphasisLineIds.includes(l.id));
      // Emphasised last, so they are painted over the network rather than under it.
      const linesToRender = emphasised.length ? [...inScope.filter((l) => !emphasisLineIds.includes(l.id)), ...emphasised] : inScope;
      const singleLine = linesToRender.length === 1;

      // A fixed lane per line, always to the right of travel (buses keep right, and the two
      // directions land on their own kerbs). The subjects take the kerb lanes in the order
      // chosen; the backdrop is dealt the lanes behind them by list position, so choosing a
      // line does not reshuffle the others.
      const subjects = lines.filter((line) => inScope.includes(line) && (emphasisLineIds.includes(line.id) || singleLine));
      const laneOf = (line: BusLine) => {
        const s = subjects.indexOf(line);
        if (s >= 0) return Math.min(s, LANES - 1);
        const i = lines.indexOf(line);
        return subjects.length ? 1 + (i % (LANES - 1)) : i % LANES;
      };
      const laneMetres = laneWidthPx(zoom) * metresPerPx;
      const subjectLaneMetres = Math.max(laneWidthPx(zoom), SUBJECT_LANE_PX) * metresPerPx;

      for (const line of linesToRender) {
        const isEmphasised = emphasisLineIds.includes(line.id);
        const muted = emphasised.length > 0 && !isEmphasised;
        const subject = isEmphasised || singleLine;
        line.directions.forEach((dir, dirIndex) => {
          if (!dir.pathCoordinates || dir.pathCoordinates.length < 2) return;
          const isReturn = dirIndex === 1;
          // Half a lane out from the kerb, then whole lanes; nothing where lanes are off.
          const path = offsetPath(verticesFor(`${line.id}/${dirIndex}`, dir.pathCoordinates, zoom), (laneOf(line) + 0.5) * (subject ? subjectLaneMetres : laneMetres));
          const weight = muted ? 2 : subject ? 5 : 3.5;
          const polyline = L.polyline(path, {
            color: line.color,
            weight,
            opacity: muted ? 0.35 : subject ? 0.95 : 0.7,
            dashArray: isReturn ? '10 7' : undefined,
            lineJoin: 'round',
            lineCap: 'round',
          });
          polyline.bindTooltip(`<div class="font-sans text-label"><b>${escapeHtml(translations(lang).lines.lineLabel(line.number))}</b><br/>${escapeHtml(directionLabel(dir, lang))}</div>`, {
            sticky: true,
            className: 'transit-map-tooltip',
          });
          // No click handler on the route: layer handlers run before the map's, and these answered the click before the stop could.
          group.addLayer(polyline);
          drawn.push({ line, dir, path });
          // Which way the bus goes, on the subject's ida only: the volta is the dashed trace and runs the other way.
          if (subject) arrowed.push({ lineId: line.id, path, color: line.color, weight, poles: dir.stops.map(stopById).filter((s): s is BusStop => !!s) });
        });
      }
    }

    // Routes are the floor of the shared canvas: rebuilt after the stops, they would paint over the dots.
    for (const layer of [...group.getLayers()].reverse()) (layer as L.Path).bringToBack();

    // The only place a route click is answered — after every layer has had its say, including a tapped stop.
    const openLinesHere = (e: L.LeafletMouseEvent) => {
      if ((e.originalEvent as MouseEvent & { _stopClaimed?: boolean })?._stopClaimed) return;
      const click = map.latLngToContainerPoint(e.latlng);
      const hits = drawn
        .map(({ line, dir, path }) => {
          const pts = path.map((c) => map.latLngToContainerPoint(c as L.LatLngTuple));
          let nearest = Infinity;
          for (let i = 1; i < pts.length; i++) nearest = Math.min(nearest, L.LineUtil.pointToSegmentDistance(click, pts[i - 1], pts[i]));
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
    map.on('click', openLinesHere);
    placeArrows();
    if (arrowed.length) map.on('moveend', placeArrows);

    return () => {
      map.off('click', openLinesHere);
      map.off('moveend', placeArrows);
      arrows.remove();
      group.remove();
    };
  }, [map, lines, visibleLineIds, emphasisLineIds, showRoutes, lang, zoomForDrawing]);

  return null;
}
