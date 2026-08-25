import { useEffect } from 'react';

interface MapChromeLabels {
  /** What this map is, for someone who will never see it. */
  region: string;
  zoomIn: string;
  zoomOut: string;
}

/**
 * Names the map for assistive technology, in the reader's language.
 *
 * Leaflet gives its container `tabindex="0"` and no accessible name, so a keyboard
 * user lands inside an unannounced box; and it writes its own control titles in
 * English once, at creation, where the app's language switch can never reach them.
 * Both are fixed from an effect rather than at creation so that switching language
 * relabels a map that already exists.
 */
export function useMapChrome(el: HTMLElement | null, labels: MapChromeLabels) {
  const { region, zoomIn, zoomOut } = labels;
  useEffect(() => {
    if (!el) return;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', region);
    const controls: [string, string][] = [
      ['.leaflet-control-zoom-in', zoomIn],
      ['.leaflet-control-zoom-out', zoomOut],
    ];
    for (const [selector, text] of controls) {
      const node = el.querySelector(selector);
      node?.setAttribute('title', text);
      node?.setAttribute('aria-label', text);
    }
  }, [el, region, zoomIn, zoomOut]);
}
