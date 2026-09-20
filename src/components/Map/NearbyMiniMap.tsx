import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { escapeHtml } from '../../utils/html';
import { BusStop } from '../../types';
import { useIsDark } from '../../hooks/useIsDark';
import { useLeafletMap } from '../../hooks/useLeafletMap';
import { mapColors, stopDotStyle, userDotStyle } from './palette';

export interface NearbyMiniMapProps {
  /** What the map is about: the reader as the browser reported it, or the pole itself — a different claim, drawn as a different thing. */
  centre: { lat: number; lng: number; label: string; kind: 'user' | 'stop' };
  stops: (BusStop & { walkMeters: number })[];
  onSelectStop: (stop: BusStop) => void;
  /** What this map is, for a reader who will never see it. */
  regionLabel: string;
}

/**
 * The few stops around you, drawn: "which of these five is the one across the road?" is a
 * question a list cannot answer. Deliberately not the map — no filters, no vehicles.
 */
export function NearbyMiniMap({ centre, stops, onSelectStop, regionLabel }: NearbyMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelectStop);
  onSelectRef.current = onSelectStop;
  const colors = mapColors(useIsDark());
  const { label, kind } = centre;
  const map = useLeafletMap(containerRef, { center: [centre.lat, centre.lng], zoom: 16, scrollWheelZoom: false, region: regionLabel });

  useEffect(() => {
    if (!map) return;
    const at: [number, number] = [centre.lat, centre.lng];
    const group = L.layerGroup().addTo(map);
    group.addLayer(
      L.circleMarker(at, kind === 'user' ? userDotStyle(colors) : { ...stopDotStyle(colors, 8, true), radius: 8, fillOpacity: 0.95 }).bindTooltip(escapeHtml(label), { direction: 'top', offset: [0, -8] }),
    );
    const bounds = L.latLngBounds([at]);
    for (const stop of stops) {
      bounds.extend([stop.lat, stop.lng]);
      const marker = L.circleMarker([stop.lat, stop.lng], stopDotStyle(colors, 6)).bindTooltip(`${escapeHtml(stop.name)} · ~${Math.round(stop.walkMeters)} m`, { direction: 'top', offset: [0, -8] });
      marker.on('click', () => onSelectRef.current(stop));
      group.addLayer(marker);
    }
    if (stops.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
    return () => {
      group.remove();
    };
  }, [map, centre.lat, centre.lng, label, kind, stops, colors]);

  return <div ref={containerRef} className="h-[240px] w-full" />;
}
