import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { getDistanceMeters } from '../../utils/geo';
import { getNearbyStops, NEARBY_STOP_LIMIT_METRES } from '../../utils/places';
import { useT } from '../../i18n';
import { mapColors, userDotStyle } from './palette';

/**
 * Follow the phone on the map, rather than photograph it once: a dot with the accuracy
 * circle around it (a wifi fix indoors can be five hundred metres out), centred on the
 * first fix and then left where the reader put the map unless the dot walks off the edge.
 * Pressing again stops it, because a watch nobody turned off is a radio nobody turned off.
 */
export function useFollowMe(map: L.Map | null, colors: ReturnType<typeof mapColors>, onMoved: (lat: number, lng: number) => void) {
  const t = useT();
  const [isLocating, setIsLocating] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  /** Where `onMoved` last fired, so walking a few metres does not redo the nearby list. */
  const lastFixRef = useRef<[number, number] | null>(null);
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    markerRef.current?.remove();
    accuracyRef.current?.remove();
    markerRef.current = null;
    accuracyRef.current = null;
    lastFixRef.current = null;
    setIsFollowing(false);
  }, []);

  const start = useCallback(() => {
    if (!navigator.geolocation) return setError(t.map.geolocationUnavailable);
    setIsLocating(true);
    setError(null);
    let centred = false;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setIsLocating(false);
        setIsFollowing(true);
        const { latitude: lat, longitude: lng } = pos.coords;
        const accuracy = Math.max(pos.coords.accuracy ?? 0, 0);
        // Outside the network there is nothing to look at: do not fly to another province.
        if (!getNearbyStops(lat, lng).some((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES)) {
          stop();
          setError(t.map.outOfArea);
          return;
        }
        if (map) {
          if (!centred) {
            map.setView([lat, lng], 16, { animate: true });
            centred = true;
          } else if (!map.getBounds().pad(-0.15).contains([lat, lng])) {
            map.panTo([lat, lng], { animate: true });
          }
          if (accuracyRef.current) accuracyRef.current.setLatLng([lat, lng]).setRadius(accuracy);
          else accuracyRef.current = L.circle([lat, lng], { radius: accuracy, color: colors.userStroke, fillColor: colors.userFill, weight: 1, opacity: 0.35, fillOpacity: 0.12, interactive: false }).addTo(map);
          if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
          else markerRef.current = L.circleMarker([lat, lng], userDotStyle(colors)).addTo(map);
          markerRef.current.bindPopup(t.map.yourPositionAccurate(Math.round(accuracy)));
        }
        // Fifty metres is about when a different stop starts being the closest one.
        const last = lastFixRef.current;
        if (!last || getDistanceMeters(last[0], last[1], lat, lng) > 50) {
          lastFixRef.current = [lat, lng];
          onMovedRef.current(lat, lng);
        }
      },
      () => {
        // Refused or unavailable: say so, rather than measure "near me" from the centre of Lugo.
        stop();
        setIsLocating(false);
        setError(t.map.locationDenied);
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 5000 },
    );
  }, [map, colors, stop, t]);

  // A watch outlives the screen unless somebody stops it, and this one is reading the GPS.
  useEffect(() => stop, [stop]);

  return { isLocating, isFollowing, error, setError, start, stop, toggle: isFollowing ? stop : start };
}
