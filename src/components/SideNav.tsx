import React from 'react';
import { AlertTriangle, CreditCard, Globe, Moon } from 'lucide-react';
import { navSections, type Tab } from './navSections';
import { tabLink } from '../hooks/useTabRoute';
import type { ThemeChoice } from '../hooks/useTheme';
import { Lang, LANGS, LANG_CODE, LANG_NAME, translations } from '../i18n';

interface SideNavProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  alertCount: number;
  /** A ride is being followed: the Ruta row says so from any other section. */
  tripActive?: boolean;
  lang: Lang;
  setLang: (lang: Lang) => void;
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
}

/**
 * The desktop shell's left rail — the same four destinations as the phone's bottom bar,
 * moved to where a pointer lives instead of where a thumb reaches.
 *
 * It is a rail rather than a hamburger because a desktop window has the room: every
 * section is one click away and permanently labelled, and the settings a phone hides in
 * a drawer sit at the foot of the rail where they are visible but out of the way.
 *
 * Never rendered below lg — the phone keeps its own shell rather than inheriting a
 * shrunken version of this one.
 */
export const SideNav: React.FC<SideNavProps> = ({
  activeTab,
  setActiveTab,
  alertCount,
  tripActive = false,
  lang,
  setLang,
  theme,
  setTheme,
}) => {
  const t = translations(lang);

  const sections = navSections(t);

  /** The two screens below the rule: read now and then, not on every trip. */
  const asides = [
    { id: 'info' as const, Icon: AlertTriangle, label: t.menu.alerts, badge: alertCount },
    { id: 'fares' as const, Icon: CreditCard, label: t.menu.fares, badge: 0 },
  ];

  const themes: { id: ThemeChoice; label: string }[] = [
    { id: 'auto', label: t.menu.themeAutoShort },
    { id: 'light', label: t.menu.themeLight },
    { id: 'dark', label: t.menu.themeDark },
  ];

  return (
    // A landmark: the name at the top and the two settings at the foot sat outside every
    // region, which is how a screen reader moving by landmark met a rail with holes in it.
    <aside aria-label={t.nav.appName} className="hidden w-[236px] shrink-0 flex-col border-r border-line bg-bg lg:flex">
      <div className="px-5 pb-4 pt-5">
        <span className="text-emph font-semibold tracking-[-0.012em]">{t.nav.appName}</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2.5" aria-label={t.nav.main}>
        {sections.map(({ id, Icon, label }) => {
          const on = activeTab === id;
          return (
            <a
              key={id}
              {...tabLink(id, setActiveTab)}
              aria-current={on ? 'page' : undefined}
              className={`flex h-11 items-center gap-3 rounded-control px-3 text-left text-body ${
                on ? 'bg-ink font-semibold text-bg' : 'font-medium text-ink-2'
              }`}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {tripActive && id === 'plan' && (
                <>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${on ? 'bg-bg' : 'bg-accent'}`} aria-hidden="true" />
                  <span className="sr-only">{t.companion.onTrip}</span>
                </>
              )}
            </a>
          );
        })}
      </nav>

      <div className="mt-5 flex flex-col gap-0.5 border-t border-line px-2.5 pt-4">
        {/* Two rows again, because they are two screens again. The badge counts announced
            incidents; "the network is closed for the night" is not one, and the night
            banner already says so. */}
        {asides.map(({ id, Icon, label, badge }) => (
          // The count is part of the name, with a pause: read from the markup it came out
          // as one word, "Avisos do servizo1". Same as the menu.
          <a
            key={id}
            {...tabLink(id, setActiveTab)}
            aria-current={activeTab === id ? 'page' : undefined}
            aria-label={badge > 0 ? `${label} (${badge})` : undefined}
            className={`flex h-11 items-center gap-3 rounded-control px-3 text-left text-body ${
              activeTab === id ? 'bg-ink font-semibold text-bg' : 'font-medium text-ink-2'
            }`}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className="tnum rounded-control bg-warn px-2 py-0.5 text-label font-bold text-warn-ink">
                {badge}
              </span>
            )}
          </a>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-line p-3.5">
        <div>
          <div className="mb-1.5 flex items-center gap-2 px-1 text-label text-ink-3">
            <Moon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t.menu.theme}
          </div>
          {/* Named groups, as in the menu: the heading beside them is only for the eye. */}
          <div role="group" aria-label={t.menu.theme} className="flex gap-1">
            {themes.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className={`h-11 flex-1 rounded-[7px] border text-label font-medium ${
                  theme === id ? 'border-ink bg-ink text-bg' : 'border-edge text-ink-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2 px-1 text-label text-ink-3">
            <Globe className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t.menu.language}
          </div>
          <div role="group" aria-label={t.menu.language} className="flex gap-1">
            {LANGS.map((code) => (
              // Each language named in itself, with the code kept so "click GL" still
              // finds it by voice, and `lang` so it is pronounced that way.
              <button
                key={code}
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                aria-label={`${LANG_CODE[code]}: ${LANG_NAME[code]}`}
                lang={code}
                className={`h-11 flex-1 rounded-[7px] border text-label font-semibold ${
                  lang === code ? 'border-ink bg-ink text-bg' : 'border-edge text-ink-2'
                }`}
              >
                {LANG_CODE[code]}
              </button>
            ))}
          </div>
        </div>

        <p className="px-1 text-label leading-relaxed text-ink-3">
          {t.menu.sourceShort}
        </p>
      </div>
    </aside>
  );
};
