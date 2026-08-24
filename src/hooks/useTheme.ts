import { useEffect, useState } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'urbanos-lugo-theme';

/**
 * Light, dark, or whatever the device says.
 *
 * The default is 'auto': this app gets read at a bus stop at eight in the morning
 * and at eleven at night, and the phone already knows which it is. An explicit
 * choice is remembered because some people run their phone light and still want a
 * dark screen in the street.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    // Safari in private browsing throws from localStorage rather than returning null,
    // and a full quota throws on write. Neither should cost somebody the app over a
    // preference: fall back to following the device.
    try {
      const stored = localStorage.getItem(KEY);
      return stored === 'light' || stored === 'dark' ? stored : 'auto';
    } catch {
      return 'auto';
    }
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'auto' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (choice !== 'auto') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);

  return [
    choice,
    (next: ThemeChoice) => {
      setChoice(next);
      try {
        if (next === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        // The choice still applies for this session; it just will not be remembered.
      }
    },
  ];
}
