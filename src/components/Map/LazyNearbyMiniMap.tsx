import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { NearbyMiniMapProps } from './NearbyMiniMap';

/**
 * The mini map, and nothing of it until it is on screen. `lazy()` alone defers the chunk
 * until the component renders, and below lg the board stays mounted behind `hidden` — so
 * Leaflet was being built inside `display: none` on every cold start (255 KB, 700 ms of
 * blocked main thread). An element with no box never intersects, which is the question.
 */
const NearbyMiniMap = lazy(() => import('./NearbyMiniMap').then((m) => ({ default: m.NearbyMiniMap })));

/** The map's own height, so nothing moves when it arrives. */
const Placeholder = () => <div className="h-[240px] w-full bg-surface" />;

export function LazyNearbyMiniMap(props: NearbyMiniMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const el = holder.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true);
    // A little ahead of the fold, so scrolling down finds the map already there.
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <div ref={holder}>
      {seen ? (
        <Suspense fallback={<Placeholder />}>
          <NearbyMiniMap {...props} />
        </Suspense>
      ) : (
        <Placeholder />
      )}
    </div>
  );
}
