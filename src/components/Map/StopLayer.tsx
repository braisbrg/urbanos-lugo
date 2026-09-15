import React, { useEffect, useRef, useState } from 'react';
import { escapeHtml } from './escapeHtml';
import L from 'leaflet';
import { BusStop } from '../../types';
import { poleCode } from '../../data/transitData';
import { useIsDark } from '../../hooks/useIsDark';
import { mapColors } from './palette';
import { stopNamesLayer } from './StopNames';

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
 * The rungs used to be cut by how many lines a stop serves -- 46 stops serve six or more,
 * 109 four or more, 233 two or more, and 184 are the single-line long tail -- and that
 * count still decides who wins a crowded spot; what it no longer decides is who is drawn
 * at all. See SPREAD_PX below for why.
 *
 * `label` is the change that matters on a phone. Names lived in a hover tooltip, and a
 * phone has no hover — so no matter how far you zoomed, no stop ever told you its name,
 * on the one screen meant for working out where you are.
 */
const ZOOM_LADDER: { from: number; radius: number; label: boolean }[] = [
  { from: 16, radius: 7, label: true },
  { from: 15, radius: 6, label: false },
  { from: 14, radius: 5, label: false },
  { from: 0, radius: 4, label: false },
];

const rungFor = (zoom: number) => ZOOM_LADDER.find((r) => zoom >= r.from) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1];

/**
 * The room a stop keeps around itself in the overview, centre to centre, in pixels at
 * the rung's zoom. Dots there are 8 to 12 px across, so this leaves at least a dot's
 * width of clear ground between any two -- close enough to read a corridor as a row of
 * stops, far enough that no two ever touch.
 */
const SPREAD_PX = 24;

/** A set this small is built whole; above it, only the part in view, the rest on demand. */
const BUILD_ALL_UP_TO = 120;

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
  /** Undoes what the effect below leaves running between renders: a moveend handler and queued frames. */
  const teardownRef = useRef<(() => void) | null>(null);
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const colors = mapColors(useIsDark());
  // Held in a ref so a fresh arrow from the parent does not rebuild every marker.
  const onTapStopRef = useRef(onTapStop);
  onTapStopRef.current = onTapStop;
  // The same for the selection: a marker placed after a pan reads the current one here,
  // and a change of selection restyles the markers below instead of rebuilding them.
  const selectedIdRef = useRef(selectedStop?.id);
  selectedIdRef.current = selectedStop?.id;

  /*
   * The rung, not the zoom.
   *
   * This kept the zoom level itself in state and listed it as a dependency of the effect
   * below, so every step of the zoom control tore down all 417 markers and up to eighty
   * label nodes and built them again — including 16 to 17, where nothing about what is
   * drawn changes. That is the pause you feel when you try to pan straight after zooming.
   *
   * There are four rungs and they only change at four thresholds. rungFor returns the
   * same object out of ZOOM_LADDER each time, so keeping the rung in state means React
   * bails out on the identical reference and the rebuild happens on a boundary crossing
   * rather than on every notch.
   */
  const [rung, setRung] = useState(() => rungFor(map?.getZoom() ?? 14));
  /** Bumped when a stop selected at a thinning zoom has no dot yet; see the selection effect. */
  const [thinnedIn, setThinnedIn] = useState(0);
  useEffect(() => {
    if (!map) return;
    const sync = () => setRung(rungFor(map.getZoom()));
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
      const detailed = visibleLineIds !== null;
      /*
       * The overview keeps the stops that fit, not the stops that pass a threshold.
       *
       * The rungs cut by how many lines a stop serves, and that read as arbitrary on the
       * screen: every pole on a five-line corridor drawn, and the street beside it -- one
       * line, same distance from you -- empty until zoom 16, when all 417 arrived at
       * once -- a scatter that looked arbitrary rather than chosen. What the eye wants from
       * an overview is an even scatter that fills in as you come closer.
       *
       * So: most-served first, and each stop is kept if no kept stop is within
       * SPREAD_PX of it -- measured at the rung's own zoom, not the live one, so the set
       * does not churn as you pinch inside a rung; distances only grow from there, and
       * the next rung recomputes with more room. The lines-served order is what decides
       * who wins a crowded spot, which is what the old threshold was trying to say.
       */
      const visible =
        detailed || rung.label
          ? onLine
          : (() => {
              const at = Math.max(rung.from, 12);
              const kept: L.Point[] = [];
              const chosen = [...onLine].sort(
                (a, b) =>
                  Number(b.id === selectedIdRef.current) - Number(a.id === selectedIdRef.current) ||
                  b.lines.length - a.lines.length ||
                  a.name.localeCompare(b.name),
              );
              return chosen.filter((s) => {
                const p = map.project([s.lat, s.lng], at);
                if (kept.some((k) => k.distanceTo(p) < SPREAD_PX)) return false;
                kept.push(p);
                return true;
              });
            })();

      const placed: Record<string, BusStop> = {};
      /** The label that opens on hover: the pole code and the name. */
      const hoverLabel = (marker: L.CircleMarker, stop: BusStop) => {
        const code = poleCode(stop);
        marker.bindTooltip(
          `<div style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--c-ink); padding: 3px 5px;">
            ${code ? `<span style="color: var(--c-accent); margin-right: 5px;">${escapeHtml(code)}</span>` : ''}${escapeHtml(stop.name)}
          </div>`,
          { direction: 'top', offset: [0, -8], opacity: 0.95, className: 'stop-hover-tooltip' },
        );
      };
      /*
       * The written names, from the rung that has them. One canvas for all of them --
       * StopNames.ts says why it is not a tooltip per stop -- fed the stops that exist
       * and painting the ones in view, on its own, whenever the map settles.
       */
      const names = rung.label
        ? stopNamesLayer({ ink: colors.nameInk, halo: colors.nameHalo, radius: rung.radius }).addTo(map)
        : null;

      /*
       * Build only the stops that are in view, and the rest as they come into it.
       *
       * Crossing into a dense rung used to build every marker of the set in one go -- all
       * 417 at zoom 16 -- and that single task is the freeze felt when panning right after
       * zooming: measured at 4x CPU, 2,9 s blocked, of which the stops were 2,7. The
       * written names were most of it and are a canvas now; the rest was the markers
       * themselves. A phone at that zoom has sixty of the 417 on screen, so the other 350
       * are work done for nothing the reader can see. They are built when a pan brings
       * them within the margin, and never taken down again -- the count is bounded by the
       * set and only grows as far as somebody actually pans.
       *
       * The markers in view land in one task, not sixteen a frame. They were spread out,
       * and it cost more than it saved: every batch added to the shared canvas asks for a
       * redraw, and a redraw repaints every route under the batch's bounds -- forty-eight
       * polylines, half of them dashed. Built together they are one redraw.
       */
      const drawBounds = map.getBounds().pad(0.3);
      const pending = new Map<string, BusStop>();

      const place = (stop: BusStop) => {
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
        //
        // `auto` and not `right` for the written name: a dot near the right edge of a
        // 375 px phone put the name off the screen — measured, three of the thirteen on
        // view at zoom 16, the widest of them 157 px. The names canvas measures each one
        // and writes it on the side that fits, which is the whole of the fix.
        hoverLabel(marker, stop);
        placed[stop.id] = stop;

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

        // A marker built in a later frame misses the selection effect below, which runs
        // once per selection over whatever exists at that moment; so the selected look is
        // applied here too, and the two agree on what it is.
        if (stop.id === selectedIdRef.current) {
          marker.setStyle({ radius: 9, fillColor: colors.stopSelected, weight: 3 });
        }
        group.addLayer(marker);
        markersRef.current[stop.id] = marker;
        if (stop.id === selectedIdRef.current) marker.bringToFront();
      };

      // What is in view lands in this task, one redraw; what is not waits for a pan.
      for (const stop of visible) {
        if (visible.length <= BUILD_ALL_UP_TO || drawBounds.contains([stop.lat, stop.lng])) place(stop);
        else pending.set(stop.id, stop);
      }
      names?.setStops(Object.values(placed));

      // A pan brings the stops it uncovered within the margin, and their names with them.
      const arrive = () => {
        if (!pending.size) return;
        const reach = map.getBounds().pad(0.3);
        let any = false;
        for (const [id, stop] of pending) {
          if (!reach.contains([stop.lat, stop.lng])) continue;
          pending.delete(id);
          place(stop);
          any = true;
        }
        if (any) names?.setStops(Object.values(placed));
      };
      map.on('moveend', arrive);
      teardownRef.current = () => {
        map.off('moveend', arrive);
        names?.remove();
      };
    }

    return () => {
      teardownRef.current?.();
      teardownRef.current = null;
      group.remove();
      markersRef.current = {};
    };
    // `colors` too: the names canvas bakes the theme in when it is built, like the dots.
    // Not the selection: it used to be here, so every tap on a stop rebuilt all 417.
    // `thinnedIn` only: a selection made at a zoom that thins the dots rebuilds once, so
    // the chosen stop gets a dot to restyle.
  }, [map, stops, visibleLineIds, showStops, rung, colors, thinnedIn]);

  // Selection restyles one marker rather than rebuilding the layer. The others go back
  // to the rung's radius, not to a fixed one: this ran after every rebuild and set the
  // markers that already existed to 5 px while the rung asked for 7, so two sizes of dot
  // shared the screen at zoom 16.
  useEffect(() => {
    const selectedId = selectedStop?.id;
    // At the zooms that thin the dots the selected stop is kept on purpose (the sort
    // above), but only when the layer is built; selected afterwards, it may have no dot.
    if (selectedId && !markersRef.current[selectedId] && !rung.label) {
      setThinnedIn((n) => n + 1);
      return;
    }
    Object.entries(markersRef.current).forEach(([id, marker]: [string, L.CircleMarker]) => {
      const isSelected = id === selectedId;
      marker.setStyle({
        radius: isSelected ? 9 : rung.radius,
        color: colors.stopStroke,
        fillColor: isSelected ? colors.stopSelected : colors.stopFill,
        weight: isSelected ? 3 : 2,
      });
      if (isSelected) marker.bringToFront();
    });
  }, [selectedStop?.id, rung, colors]);

  return null;
};
