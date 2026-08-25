import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BusStop } from '../../types';
import { Lang, translations } from '../../i18n';
import { useIsDark } from '../../hooks/useIsDark';
import { useMapChrome } from '../../hooks/useMapChrome';
import { mapColors, TILE_ATTRIBUTION } from './palette';

interface NearbyMiniMapProps {
  /** Where the reader is, as the browser reported it. */
  at: [number, number];
  stops: (BusStop & { walkMeters: number })[];
  onSelectStop: (stop: BusStop) => void;
  lang: Lang;
}

/**
 * The few stops around you, drawn.
 *
 * "Which of these five is the one across the road?" is a question a list cannot answer,
 * and the answer used to cost a trip to the map tab and back. This is deliberately not
 * the map: no line filters, no vehicles, no layer switches — just where you are and
 * which poles are near, sized so the list below it stays on screen.
 */
export const NearbyMiniMap: React.FC<NearbyMiniMapProps> = ({ at, stops, onSelectStop, lang }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelectStop);
  onSelectRef.current = onSelectStop;
  const [built, setBuilt] = useState(false);
  const colors = mapColors(useIsDark());
  const t = translations(lang);
  const youAreHere = t.stopHome.youAreHere;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: at,
      zoom: 16,
      zoomControl: false,
      // A small map inside a scrolling page: grabbing it to scroll past is the common
      // gesture, so it only pans once you mean to.
      scrollWheelZoom: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    tilesRef.current = L.tileLayer(colors.tiles, {
      attribution: TILE_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    setBuilt(true);

    // The container is often 0 px tall on first paint inside a flex column.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Built once: `at` changing moves the view below rather than rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tilesRef.current?.setUrl(colors.tiles);
  }, [colors.tiles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    markersRef.current = group;

    group.addLayer(
      L.circleMarker(at, {
        radius: 8,
        color: colors.userStroke,
        weight: 3,
        fillColor: colors.userFill,
        fillOpacity: 0.95,
      }).bindTooltip(youAreHere, { direction: 'top', offset: [0, -8] }),
    );

    const bounds = L.latLngBounds([at]);
    for (const stop of stops) {
      bounds.extend([stop.lat, stop.lng]);
      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 6,
        color: colors.stopStroke,
        weight: 2,
        fillColor: colors.stopFill,
        fillOpacity: 1,
      }).bindTooltip(`${stop.name} · ~${Math.round(stop.walkMeters)} m`, {
        direction: 'top',
        offset: [0, -8],
      });
      marker.on('click', () => onSelectRef.current(stop));
      group.addLayer(marker);
    }
    if (stops.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
  }, [at, stops, colors, youAreHere]);

  useMapChrome(built ? containerRef.current : null, {
    region: t.map.nearbyRegion,
    zoomIn: t.map.zoomIn,
    zoomOut: t.map.zoomOut,
  });

  return <div ref={containerRef} className="h-[240px] w-full" />;
};
