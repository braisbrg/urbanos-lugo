import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BusStop } from '../../types';
import { Lang, translations } from '../../i18n';
import { useIsDark } from '../../hooks/useIsDark';
import { useMapChrome } from '../../hooks/useMapChrome';
import { mapColors, TILE_ATTRIBUTION } from './palette';

interface NearbyMiniMapProps {
  /**
   * What the map is about. On the stops home that is the reader, as the browser
   * reported it; on a stop's page it is the pole itself, which is a different claim
   * and has to be drawn as a different thing.
   */
  centre: { lat: number; lng: number; label: string; kind: 'user' | 'stop' };
  stops: (BusStop & { walkMeters: number })[];
  onSelectStop: (stop: BusStop) => void;
  lang: Lang;
  /** What this map is, for a reader who will never see it. */
  regionLabel: string;
}

/**
 * The few stops around you, drawn.
 *
 * "Which of these five is the one across the road?" is a question a list cannot answer,
 * and the answer used to cost a trip to the map tab and back. This is deliberately not
 * the map: no line filters, no vehicles, no layer switches — just where you are and
 * which poles are near, sized so the list below it stays on screen.
 */
export const NearbyMiniMap: React.FC<NearbyMiniMapProps> = ({
  centre,
  stops,
  onSelectStop,
  lang,
  regionLabel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelectStop);
  onSelectRef.current = onSelectStop;
  const [built, setBuilt] = useState(false);
  const colors = mapColors(useIsDark());
  const t = translations(lang);
  const at: [number, number] = [centre.lat, centre.lng];
  const { label, kind } = centre;

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
        color: kind === 'user' ? colors.userStroke : colors.stopStroke,
        weight: 3,
        fillColor: kind === 'user' ? colors.userFill : colors.stopSelected,
        fillOpacity: 0.95,
      }).bindTooltip(label, { direction: 'top', offset: [0, -8] }),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre.lat, centre.lng, label, kind, stops, colors]);

  useMapChrome(built ? containerRef.current : null, {
    region: regionLabel,
    zoomIn: t.map.zoomIn,
    zoomOut: t.map.zoomOut,
  });

  return <div ref={containerRef} className="h-[240px] w-full" />;
};
