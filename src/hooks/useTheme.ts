import { useEffect, useState } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';

const KEY = 'urbanos-lugo-theme';

/**
 * Dark, light, or whatever the device says.
 *
 * The default is 'dark'. This is read standing at a pole, most often when it is
 * already dark out, and a phone set to light all day is not a statement about how
 * somebody wants a bus timetable to look at eleven at night. 'auto' and 'light' are
 * both there, and both are remembered once chosen.
 *
 * Only a choice is stored, so clearing site data returns to dark rather than to
 * whatever was last picked. `public/theme-init.js` reads the same key before the
 * first paint; if this key changes, that changes with it.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    // Safari in private browsing throws from localStorage rather than returning null,
    // and a full quota throws on write. Neither should cost somebody the app over a
    // preference: fall back to following the device.
    try {
      const stored = localStorage.getItem(KEY);
      return stored === 'light' || stored === 'auto' ? stored : 'dark';
    } catch {
      return 'dark';
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
        if (next === 'dark') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        // The choice still applies for this session; it just will not be remembered.
      }
    },
  ];
}
