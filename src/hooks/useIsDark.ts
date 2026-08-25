import { useEffect, useState } from 'react';

/**
 * Whether the dark palette is live right now.
 *
 * `useTheme` owns the choice and writes it as a class on <html>; this only reads the
 * result. Leaflet is not React — it bakes colours into a layer when the layer is made —
 * so the map cannot use a CSS variable and has to be told, in JavaScript, which palette
 * to draw with. Reading the class the theme already sets keeps one source of truth
 * instead of threading a prop from the top of the app down to every layer.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

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
