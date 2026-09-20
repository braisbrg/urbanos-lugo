import { useEffect, useState } from 'react';

/**
 * Whether the dark palette is live right now, read off the class `useTheme` sets on
 * <html>. Leaflet bakes colours into a layer when the layer is made, so the map cannot
 * use a CSS variable and has to be told in JavaScript.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
