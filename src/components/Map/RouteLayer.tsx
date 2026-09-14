import React, { useEffect, useRef, useState } from 'react';
import { Lang, translations } from '../../i18n';
import { escapeHtml } from './escapeHtml';
import { directionLabel } from '../../utils/serviceLabels';
import L from 'leaflet';
import { BusLine } from '../../types';
import { BUS_STOPS } from '../../data/transitData';

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
  /**
   * The lines lifted out of the network, if any.
   *
   * Was a single id, because the map could only ever have one line picked. Comparing two
   * needs both painted over the backdrop rather than one of them chosen as the subject:
   * with one emphasised and the other left in the mute, the map answers a question the
   * reader did not ask.
   */
  emphasisLineIds?: string[];
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
 * The lane, in screen pixels, and where the lanes start.
 *
 * Lugo's lines converge on the same handful of corridors, and drawn on their true
 * geometry they are not close together, they are
 * identical, one polyline hiding five. So routes that share a street are drawn side by
 * side, which is how a transit map has always done this.
 *
 * In pixels. The offset used to be six metres at every zoom, and metres do two wrong
 * things at once: far out they vanish -- under a pixel at zoom 14 -- and close in they
 * are wider than the road bends, so a route offset 24 m round a 15 m roundabout turned
 * inside out and drew a loop, which is the shape that was reported.
 *
 * Three pixels from 16 and two at 15, nothing further out. At four pixels from 13 the
 * densest corridor, a dozen lines, had a bundle eating the screen. Below 15 a
 * corridor is one strand of whatever is painted last, and the tap on it lists everything
 * that runs there; that is the honest overview, not a plait wider than the street.
 */
function laneWidthPx(zoom: number): number {
  return zoom >= 16 ? 3 : zoom >= 15 ? 2 : 0;
}

/**
 * How many lanes there are on each side of a street before they are reused.
 *
 * Four, at three pixels, is twelve pixels a side -- a bundle you can still tell apart
 * without it being wider than the road it is on. Lines beyond the fourth share a lane
 * and hide one another, and the tap on the corridor lists every one of them; nine lanes
 * kept them all apart and cost the densest corridor seventy pixels.
 */
const LANES = 4;

/**
 * The lane width the line being looked at gets, whatever the zoom: its ida and volta are
 * drawn half a lane either side of the centreline, so this is the distance between their
 * centres. Six pixels keeps two 5 px strokes apart. Choosing a line frames it at zoom 13
 * or 14, where the bundle has no lanes at all, and there the two directions of the one
 * line the reader asked about sat exactly on top of each other; with only one line
 * selected there is room to split ida and volta, so they are.
 */
const SUBJECT_LANE_PX = 6;

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

  const shifted: [number, number][] = coords.map(([lat, lng], i) => {
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

  /*
   * Each shifted segment is compared with its own original and nothing else. The first
   * version compared it with the last point kept, so one dropped vertex made the next
   * look reversed too, and a corner at zoom 14 -- where a lane is twenty metres -- took
   * the whole street with it: the chosen line was drawn as straight chords across the
   * city. A vertex that reverses its own segment is dropped, and the two beside it join.
   */
  const keep: [number, number][] = [shifted[0]];
  for (let i = 1; i < shifted.length; i++) {
    const cos = Math.cos(coords[i][0] * (Math.PI / 180));
    const ox = (coords[i][1] - coords[i - 1][1]) * cos;
    const oy = coords[i][0] - coords[i - 1][0];
    const sx = (shifted[i][1] - shifted[i - 1][1]) * cos;
    const sy = shifted[i][0] - shifted[i - 1][0];
    if (ox * sx + oy * sy >= 0 || i === shifted.length - 1) keep.push(shifted[i]);
  }
  return keep;
}

/**
 * How far apart the direction arrows sit along a route, in screen pixels.
 *
 * The one thing a drawn route does not say is which way the bus goes along it, and on
 * a loop like the 1.1 round the walls that is the whole question. Pixels and not metres,
 * unlike the lane offset: a fixed 200 m was 55 px apart at zoom 14 and 220 at 16, so the
 * same line was a row of chevrons at one zoom and a hint at the next, and with two lines
 * up it was a row on four traces. At a fixed 120 px the
 * density is the same at every zoom -- about 840 m apart at 14, 210 at 16, 50 at 18 --
 * which means re-placing them when the zoom changes, and that is cheap: a few dozen
 * markers. Below 14 they are hidden altogether, because a whole city of chevrons is
 * texture, not direction.
 */
const ARROW_EVERY_PX = 120;
/** Below this the arrows come off: the city fits on the screen and they would be noise. */
const ARROW_MIN_ZOOM = 14;
/**
 * With several lines up, arrows only from here. Two subjects share most of their corridor
 * and their lanes are 9 m apart, which is under 3 px until zoom 17 -- so below it the
 * traces overlap, one line covers the other, and the arrows of the covered one surface on
 * the wrong ribbon: blue chevrons riding the teal 1.2 at zoom 15. Where the
 * lanes cannot be told apart, an arrow cannot be attributed, and is left out.
 */
const ARROW_MIN_ZOOM_SHARED = 17;
/** No arrow this close to a pole, so a stop dot is never half hidden under one. */
const ARROW_CLEAR_OF_STOP_M = 20;

/**
 * Where to draw the arrows along a path, and which way each one points.
 *
 * Walks the path accumulating ground distance and drops a point every `everyMetres`,
 * starting half a spacing in so neither end is crowded. The bearing is measured in
 * screen space -- the projected points, not the coordinates -- so an arrow follows the
 * line as drawn, which is what a rotation in CSS has to match.
 */
function arrowsAlong(
  path: [number, number][],
  keepClear: { lat: number; lng: number }[],
  everyMetres: number,
): { at: [number, number]; deg: number }[] {
  const M_PER_DEG_LAT = 111_320;
  const metres = (a: [number, number], b: [number, number]) => {
    const cos = Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
    return Math.hypot((b[0] - a[0]) * M_PER_DEG_LAT, (b[1] - a[1]) * M_PER_DEG_LAT * cos);
  };
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
      // Web Mercator is conformal, so the angle is the same at every zoom: any one will do.
      const pa = L.CRS.EPSG3857.latLngToPoint(L.latLng(a[0], a[1]), 16);
      const pb = L.CRS.EPSG3857.latLngToPoint(L.latLng(b[0], b[1]), 16);
      out.push({ at, deg: (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI });
    }
    untilNext -= length - walked;
  }
  return out;
}

/**
 * One arrow, and it is part of the line: an open chevron in the line's own colour, drawn
 * with the line's own stroke, its point on the centreline and its two arms reaching past
 * the edges. Where it lies on the line it is the line; what shows is the two arms coming
 * out of it, which is enough to say which way. The first version was a filled triangle
 * with a light edge, which read as a sticker on the line.
 *
 * Drawn pointing right and turned by CSS. Not interactive -- the route and the stops
 * under it answer the taps, and this is the one kind of layer that must never get in
 * their way.
 */
function arrowIcon(color: string, weight: number, deg: number): L.DivIcon {
  return L.divIcon({
    className: 'route-arrow',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html:
      `<svg width="16" height="16" viewBox="-8 -8 16 16" style="display:block;transform:rotate(${deg.toFixed(1)}deg)" aria-hidden="true">` +
      `<path d="M-4 -6 L3 0 L-4 6" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
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
  emphasisLineIds = [],
  showRoutes,
  lang,
  onSelectLine,
  onOpenLine,
}) => {
  const groupRef = useRef<L.LayerGroup | null>(null);

  // The zoom, so the pixel lanes and the arrow spacing are recomputed when it changes.
  // Fractional, since the basemap lets the map settle at any zoom, and read at the end of
  // each gesture rather than during it.
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
  // The parent passes a fresh arrow every render. Keeping it in a ref stops that
  // from re-running the effect and redrawing the whole map on each live-bus tick.
  const onSelectLineRef = useRef(onSelectLine);
  onSelectLineRef.current = onSelectLine;
  const onOpenLineRef = useRef(onOpenLine);
  onOpenLineRef.current = onOpenLine;

  /*
   * The zoom the drawing actually depends on.
   *
   * Lanes are in pixels and arrows are spaced in pixels, so both have to be redone when
   * the zoom changes -- but only when there are any. With the whole network up there are
   * no lanes (too many lines) and no arrows (no subject), and a redraw on every zoom step
   * was 24 dense polylines rebuilt for nothing: measured at 4x CPU, 640 ms of the pause
   * after a zoom. So the effect follows the zoom only while lanes or arrows are on, and
   * otherwise sees a constant and stays put.
   */
  const zoomForDrawing = Math.round(zoom);

  useEffect(() => {
    if (!map) return;
    const zoom = zoomForDrawing;

    const group = L.layerGroup().addTo(map);
    groupRef.current = group;

    if (!map.getPane('routeArrows')) {
      // Between the overlay canvas (400) and the shadow pane (500): over the routes and
      // the stops, under every real marker. Taps pass through -- the pane has no handlers
      // and the icons are non-interactive -- so the stops underneath still answer.
      const pane = map.createPane('routeArrows');
      pane.style.zIndex = '450';
      pane.style.pointerEvents = 'none';
    }
    const arrows = L.layerGroup();
    // Metres per screen pixel at this zoom and latitude: what turns a lane or an arrow
    // spacing given in pixels into ground distance, for this draw.
    const metresPerPx = (156543.03 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** zoom;
    const placeArrows = () => {
      const subjectLines = new Set(arrowed.map((t) => t.lineId)).size;
      if (zoom < ARROW_MIN_ZOOM || (subjectLines > 1 && zoom < ARROW_MIN_ZOOM_SHARED)) return;
      for (const trace of arrowed) {
        for (const { at, deg } of arrowsAlong(trace.path, trace.poles, ARROW_EVERY_PX * metresPerPx)) {
          arrows.addLayer(
            L.marker(at, {
              icon: arrowIcon(trace.color, trace.weight, deg),
              pane: 'routeArrows',
              interactive: false,
              keyboard: false,
            }),
          );
        }
      }
      arrows.addTo(map);
    };

    // The path as drawn, not as stored: a click has to be measured against the line the
    // reader can see, which is the offset one.
    const drawn: {
      line: BusLine;
      dir: BusLine['directions'][number];
      path: [number, number][];
    }[] = [];
    /** The traces that carry direction arrows, placed and re-placed by placeArrows. */
    const arrowed: {
      lineId: string;
      path: [number, number][];
      color: string;
      weight: number;
      poles: { lat: number; lng: number }[];
    }[] = [];

    if (showRoutes) {
      const showingAll = visibleLineIds === null;
      const inScope = showingAll ? lines : lines.filter((l) => visibleLineIds.includes(l.id));
      const emphasised = inScope.filter((l) => emphasisLineIds.includes(l.id));
      // Emphasised last, so they are painted over the network rather than under it.
      const linesToRender = emphasised.length
        ? [...inScope.filter((l) => !emphasisLineIds.includes(l.id)), ...emphasised]
        : inScope;
      // Both directions only when there is one line and nothing else competing for the
      // corridor; otherwise ida and volta are two more traces in an already busy street.
      const singleLine = linesToRender.length === 1;

      /*
       * Both directions of every line, always.
       *
       * The overview used to draw the ida alone, on the reasoning that both would stack
       * one polyline on the other. With sides, they do not: each direction is drawn on
       * its own side of the street. And a street served only by the volta was showing no
       * bus at all, so a street the buses only ever return along looked unserved.
       *
       * The lanes are dealt over exactly this set, in the order of the full line list and
       * not of drawing, so choosing a line does not reshuffle the bundle around it.
       */
      /*
       * Which lane a line gets. A line that is the subject takes the kerb -- lane 0, the
       * first out from the centreline -- so its stops sit on it: dealt by list position
       * it landed three and a half lanes off its own street, and its stops read as being
       * on the next street over. With several subjects they take 0, 1, 2 in the
       * order they were chosen, and the backdrop lines are dealt the lanes behind them by
       * list position, so choosing one does not reshuffle the others.
       */
      /*
       * A fixed lane per line, the same along its whole length, and always to the right of
       * travel -- the first version dealt lanes either side of the centreline, so a line
       * whose lane fell on the left was drawn on the left of its own direction -- on a
       * two-way avenue the trace on the left was the one that drives on the right in real
       * life. Buses keep right here; the drawn line does too, and the two
       * directions of a line land on their own kerbs by construction.
       *
       * Three other deals were built and rendered side by side before this one was kept: per street segment by shared vertices (zig-zagged where
       * two traces of one street do not coincide vertex for vertex); to the right of
       * travel by proximity and bearing, smoothed (a tangle at every junction where the
       * ranks change); a fixed lane by colouring the graph of who meets whom (a trace that
       * meets a big bundle anywhere carried that high lane everywhere). The fixed lane's
       * own cost is bounded: a backdrop line alone on its road sits at most three and a
       * half lanes off it, 10 px at zoom 16, and the chosen line is never that line.
       */
      const subjects = lines.filter((line) => inScope.includes(line) && (emphasisLineIds.includes(line.id) || singleLine));
      const laneOf = (line: BusLine) => {
        const s = subjects.indexOf(line);
        if (s >= 0) return Math.min(s, LANES - 1);
        const i = lines.indexOf(line);
        return subjects.length ? 1 + (i % (LANES - 1)) : i % LANES;
      };
      const laneMetres = laneWidthPx(zoom) * metresPerPx;
      const subjectLaneMetres = Math.max(laneWidthPx(zoom), SUBJECT_LANE_PX) * metresPerPx;

      linesToRender.forEach((line) => {
        const isEmphasised = emphasisLineIds.includes(line.id);
        // A backdrop, not a second subject: thin enough to read the chosen line over, dark
        // enough to still say a street carries a bus.
        const muted = emphasised.length > 0 && !isEmphasised;
        const subject = isEmphasised || singleLine;

        line.directions.forEach((dir, dirIndex) => {
          if (!dir.pathCoordinates || dir.pathCoordinates.length < 2) return;

          const isReturn = dirIndex === 1;

          // Half a lane out from the kerb, then whole lanes; nothing where lanes are off.
          const path = offsetPath(
            dir.pathCoordinates as [number, number][],
            (laneOf(line) + 0.5) * (subject ? subjectLaneMetres : laneMetres),
          );

          const weight = muted ? 2 : subject ? 5 : 3.5;
          const polyline = L.polyline(path, {
            color: line.color,
            weight,
            opacity: muted ? 0.35 : subject ? 0.95 : 0.7,
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

          /*
           * Which way the bus goes, on the lines that are the subject -- and on the ida
           * only. The volta is the dashed trace and runs the other way; arrowing both
           * said the same thing twice and, with two lines up, four times. Without an
           * arrow nothing on the map says which way round the 1.1 goes round the walls.
           * The path order is the direction of travel -- the OSM relation and the
           * fallback router both run first stop to last -- so the bearing along the
           * drawn trace is the answer. Kept clear of the poles so a dot is never half
           * under one.
           */
          if (subject) {
            arrowed.push({
              lineId: line.id,
              path,
              color: line.color,
              weight,
              poles: dir.stops
                .map((id) => BUS_STOPS.find((s) => s.id === id))
                .filter((s): s is (typeof BUS_STOPS)[number] => !!s),
            });
          }
        });
      });
    }

    /*
     * Routes are the floor of the overlay, whatever else is drawn and whenever.
     *
     * Everything on this map shares one canvas, and a canvas paints in the order layers
     * were added. The stops are added once, by their own component; the routes are
     * rebuilt every time a line is chosen or a filter changes, which makes them the newest
     * layers on the canvas and paints them over the stop dots. That was "the circles are
     * sometimes under the lines" -- and sometimes was every redraw after the first one.
     *
     * Sending each route to the back, last-added first so their own order survives, puts
     * them under the stops, the vehicles and the reader's position no matter which
     * component drew what when. A pane of their own would do the same and cost the hover
     * on whichever canvas ends up underneath, since each canvas only hears its own events.
     */
    for (const layer of [...group.getLayers()].reverse()) (layer as L.Path).bringToBack();

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
    placeArrows();

    return () => {
      map.off('click', openLinesHere);
      arrows.remove();
      group.remove();
      groupRef.current = null;
    };
  }, [map, lines, visibleLineIds, emphasisLineIds, showRoutes, lang, zoomForDrawing]);

  return null;
};
