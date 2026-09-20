import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '../security/themeInit';
import { readString, writeString } from '../utils/storage';

export type ThemeChoice = 'auto' | 'light' | 'dark';

/**
 * Dark, light, or whatever the device says. Dark by default: this is read standing at a
 * pole, most often after nightfall. Only a choice is stored, so clearing site data returns
 * to dark; the inline theme script reads the same key before the first paint.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const stored = readString(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'auto' ? stored : 'dark';
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle('dark', choice === 'dark' || (choice === 'auto' && media.matches));
    apply();
    if (choice !== 'auto') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);

  return [
    choice,
    (next) => {
      setChoice(next);
      writeString(THEME_STORAGE_KEY, next === 'dark' ? null : next);
    },
  ];
}
