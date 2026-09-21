import { Globe, Moon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { LANGS, LANG_CODE, LANG_NAME, useLang, useT, type Lang } from '../../i18n';
import type { ThemeChoice } from '../../hooks/useTheme';

const pressed = (on: boolean) => `h-11 flex-1 rounded-[7px] border text-label font-semibold ${on ? 'border-ink bg-ink text-bg' : 'border-edge text-ink-2'}`;

/** A labelled row of settings buttons. The heading beside the group is for the eye; the group carries the name. */
function Row({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 px-1 text-label text-ink-3">
        <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        {label}
      </div>
      <div role="group" aria-label={label} className="flex gap-1">
        {children}
      </div>
    </div>
  );
}

export interface SettingsProps {
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
  setLang: (lang: Lang) => void;
}

/** Dark, light or automatic, and the three languages — the same two controls in the menu and the desktop rail. */
export function Settings({ theme, setTheme, setLang }: SettingsProps) {
  const t = useT();
  const lang = useLang();
  const themes: { id: ThemeChoice; label: string }[] = [
    { id: 'auto', label: t.menu.themeAutoShort },
    { id: 'light', label: t.menu.themeLight },
    { id: 'dark', label: t.menu.themeDark },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Row icon={Moon} label={t.menu.theme}>
        {themes.map(({ id, label }) => (
          <button key={id} onClick={() => setTheme(id)} aria-pressed={theme === id} className={pressed(theme === id)}>
            {label}
          </button>
        ))}
      </Row>
      <Row icon={Globe} label={t.menu.language}>
        {LANGS.map((code) => (
          // Each language named in itself, with the code kept so "click GL" still finds it by voice.
          <button key={code} onClick={() => setLang(code)} aria-pressed={lang === code} aria-label={`${LANG_CODE[code]}: ${LANG_NAME[code]}`} lang={code} className={pressed(lang === code)}>
            {LANG_CODE[code]}
          </button>
        ))}
      </Row>
    </div>
  );
}
