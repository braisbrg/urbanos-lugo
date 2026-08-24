import React from 'react';
import { Lang, translations } from '../i18n';
import { navSections, type Tab } from './navSections';

export type { Tab };

interface BottomNavProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  lang: Lang;
}

/**
 * The four places worth going, along the bottom.
 *
 * Bottom, not top: this is read standing at a stop, one-handed, often with the
 * other hand full. The top third of a phone needs a second hand to reach, so
 * nothing that gets tapped every session belongs up there. Each target is 60 px
 * tall — well past the 44 px floor, because it is aimed at without looking.
 */
export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, setActiveTab, lang }) => {
  const t = translations(lang);
  const items = navSections(t);

  return (
    <nav
      className="sticky bottom-0 z-[1200] flex border-t border-line bg-bg pb-1.5 lg:hidden"
      aria-label={t.nav.main}
    >
      {items.map(({ id, Icon, label }) => {
        const on = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            aria-current={on ? 'page' : undefined}
            className={`flex h-[60px] flex-1 flex-col items-center justify-center gap-1 border-t-2 transition-colors ${
              on ? 'border-accent text-accent' : 'border-transparent text-ink-3'
            }`}
          >
            <Icon className="h-[21px] w-[21px]" strokeWidth={2} aria-hidden="true" />
            <span className={`text-label ${on ? 'font-semibold' : 'font-normal'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
