import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { NearbyMiniMapProps } from './NearbyMiniMap';

/**
 * The mini map, and nothing of it until it is on screen.
 *
 * `lazy()` alone defers the chunk until the component *renders*, which is not the same
 * as being seen. Below lg the stops tab keeps the board mounted behind `hidden` so that
 * choosing a stop does not cost a remount -- so on a phone the board's map was being
 * built inside `display: none` on every cold start. Measured at 6x CPU on Slow 4G that
 * was 255 KB over the wire and about 700 ms of blocked main thread, for a canvas nobody
 * could see, plus a tile request to an off-origin host for a map nobody had opened.
 *
 * An element inside `display: none` has no box and therefore never intersects, which is
 * exactly the question being asked. The placeholder is the same 240px the map itself
 * occupies, so nothing moves when it arrives.
 *
 * Both callers used to declare this `lazy()` themselves; it lives here once so the
 * deferral cannot be forgotten at a third call site.
 */
const NearbyMiniMap = lazy(() => import('./NearbyMiniMap').then((m) => ({ default: m.NearbyMiniMap })));

/** The map's own height, so the placeholder holds the space rather than collapsing it. */
const Placeholder: React.FC = () => <div className="h-[240px] w-full bg-surface" />;

export const LazyNearbyMiniMap: React.FC<NearbyMiniMapProps> = (props) => {
  const holder = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const el = holder.current;
    // No IntersectionObserver means an older browser than the floor we support; draw it
    // rather than leave a grey box where the map should be.
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true);
    // A little ahead of the fold: scrolling the stop board down should find the map
    // already there rather than watch it appear.
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setSeen(true),
      { rootMargin: '200px' },
    );
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
};
