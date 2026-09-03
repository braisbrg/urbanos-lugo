import React from 'react';
import { useDialog } from '../hooks/useDialog';
import { AlertTriangle, ChevronRight, CreditCard, Globe, Moon, X } from 'lucide-react';
import type { ThemeChoice } from '../hooks/useTheme';
import { Lang, LANGS, LANG_CODE, translations } from '../i18n';
import type { Tab } from './navSections';
import { REPO_URL } from '../project';

interface MenuDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenTab: (tab: Tab) => void;
  alertCount: number;
  lang: Lang;
  setLang: (lang: Lang) => void;
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
}

/**
 * Everything that is consulted now and then, out of the way of everything that is
 * consulted every time.
 *
 * Favourites are deliberately NOT here: they are the home screen. Burying the
 * thing people open nine times out of ten behind a menu is how an app gets slow
 * to use without ever getting slow.
 */
export const MenuDrawer: React.FC<MenuDrawerProps> = ({
  open,
  onClose,
  onOpenTab,
  alertCount,
  lang,
  setLang,
  theme,
  setTheme,
}) => {
  const dialogRef = useDialog(open, onClose);

  if (!open) return null;

  const t = translations(lang);

  /** The two screens the bottom bar does not carry. */
  const asides = [
    { id: 'info' as const, Icon: AlertTriangle, tint: 'text-estimated', label: t.menu.alerts, badge: alertCount },
    { id: 'fares' as const, Icon: CreditCard, tint: 'text-ink-2', label: t.menu.fares, badge: 0 },
  ];

  const themes: { id: ThemeChoice; label: string }[] = [
    { id: 'auto', label: t.menu.themeAuto },
    { id: 'light', label: t.menu.themeLight },
    { id: 'dark', label: t.menu.themeDark },
  ];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.menu.open}
      className="fixed inset-0 z-[1500]"
    >
      <button
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
        aria-label={t.menu.close}
      />
      <div className="absolute inset-y-0 right-0 flex w-[306px] max-w-[85vw] flex-col border-l border-line bg-bg">
        <div className="flex items-center justify-between border-b border-line px-[18px] py-4">
          <span className="text-emph font-semibold">{t.nav.appName}</span>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-[10px] text-ink-2"
            aria-label={t.menu.close}
          >
            <X className="h-[19px] w-[19px]" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-0.5 px-2.5 py-3">
          {/* One row per screen. What is happening, and how the thing works. */}
          {asides.map(({ id, Icon, tint, label, badge }) => (
            <button
              key={id}
              onClick={() => {
                onOpenTab(id);
                onClose();
              }}
              className="flex h-14 items-center gap-4 rounded-xl px-3 text-left"
            >
              <Icon className={`h-[21px] w-[21px] shrink-0 ${tint}`} strokeWidth={2} aria-hidden="true" />
              <span className="flex-1 text-emph font-semibold">{label}</span>
              {badge > 0 && (
                <span className="tnum shrink-0 rounded-[10px] bg-warn px-2 py-0.5 text-label font-bold text-warn-ink">
                  {badge}
                </span>
              )}
              <ChevronRight className="h-[17px] w-[17px] shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
            </button>
          ))}

          <div className="flex min-h-14 items-center gap-4 px-3 py-2">
            <Globe className="h-[21px] w-[21px] shrink-0 text-ink-2" strokeWidth={2} aria-hidden="true" />
            <span className="flex-1 text-body font-semibold">{t.menu.language}</span>
            <div className="flex shrink-0 overflow-hidden rounded-[9px] border border-edge">
              {LANGS.map((code) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={`h-11 w-12 text-label font-semibold ${
                    lang === code ? 'bg-ink text-bg' : 'text-ink-2'
                  }`}
                >
                  {LANG_CODE[code]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 px-3 py-2">
            <div className="flex items-center gap-4">
              <Moon className="h-[21px] w-[21px] shrink-0 text-ink-2" strokeWidth={2} aria-hidden="true" />
              <span className="flex-1 text-body font-semibold">{t.menu.theme}</span>
            </div>
            <div className="flex gap-1.5">
              {themes.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  aria-pressed={theme === id}
                  className={`h-11 flex-1 rounded-[9px] border text-label font-semibold ${
                    theme === id ? 'border-ink bg-ink text-bg' : 'border-edge text-ink-2'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Who made this, and what it does with you.
            Everything above says where the numbers come from; nothing said where the app
            itself comes from. On screen it reads "the whole Lugo urban bus network,
            operated by Monbus" and "official prices", which is exactly what the
            operator's own app would say — so a reader had no way to tell this is not it.
            The README, DATA.md and the structured data a crawler reads all say so
            plainly. The person holding the phone was the only one not being told. */}
        <div className="mt-auto flex flex-col gap-1 border-t border-line p-5 text-label text-ink-3">
          <span>{t.menu.sourceTimetables}</span>
          <span>{t.menu.sourceGeometry}</span>
          <span>{t.menu.sourceNoGps}</span>
          <span className="mt-2 border-t border-line pt-2 text-ink-2">{t.menu.unofficial}</span>
          <span>{t.menu.privacy}</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 self-start underline decoration-dotted underline-offset-2"
          >
            {t.menu.sourceCode}
          </a>
        </div>
      </div>
    </div>
  );
};
