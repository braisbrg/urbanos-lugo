import React from 'react';
import { Lang, translations } from '../i18n';
import { navSections, type Tab } from './navSections';


interface BottomNavProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  /** A ride is being followed: the Ruta tab says so from any other tab. */
  tripActive?: boolean;
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
export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, setActiveTab, tripActive = false, lang }) => {
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
            <span className="relative">
              <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              {/* The trip goes on while you look at a line or the map; this is the one
                  place that says so, and the way back to it. */}
              {tripActive && id === 'plan' && (
                <>
                  <span
                    className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent"
                    aria-hidden="true"
                  />
                  <span className="sr-only">{t.companion.onTrip}</span>
                </>
              )}
            </span>
            <span className={`text-label ${on ? 'font-semibold' : 'font-normal'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
