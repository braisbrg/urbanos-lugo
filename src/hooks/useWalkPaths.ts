import { useEffect, useState } from 'react';
import { fetchWalkingPath, walkHopKey, type Hop, type WalkPaths } from '../services/walkingPath';

/**
 * The real pedestrian route for every walked hop, routed on the device (about six
 * milliseconds a hop) and filled in as each answer arrives. Null means there is no
 * pedestrian route at all; until then the caller keeps its straight-line estimate.
 */
export function useWalkPaths(hops: Hop[]): WalkPaths {
  const [paths, setPaths] = useState<WalkPaths>({});
  useEffect(() => {
    if (!hops.length) return;
    const controller = new AbortController();
    for (const [a, b] of hops) {
      fetchWalkingPath(a, b, controller.signal)
        .then((path) => {
          if (!controller.signal.aborted) setPaths((prev) => ({ ...prev, [walkHopKey(a, b)]: path }));
        })
        .catch(() => {}); // aborted: the estimate is already on screen
    }
    return () => controller.abort();
  }, [hops]);
  return paths;
}
