import React from 'react';
import { Lang, translations } from '../i18n';
import { navSections, type Tab } from './navSections';
import { tabLink } from '../hooks/useTabRoute';


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
  // -1 on the two screens the bar does not list (notices, fares): the mark hides.
  const current = items.findIndex((item) => item.id === activeTab);

  return (
    <nav
      className="relative sticky bottom-0 z-[1200] flex border-t border-line bg-bg pb-1.5 lg:hidden"
      aria-label={t.nav.main}
    >
      {/* The mark slides from the tab you left to the one you chose (200 ms), which is the
          whole of what a tab change looks like: the screens themselves do not move.
          `aria-current` below is what says which tab is on; this is only the drawing. */}
      <span
        aria-hidden="true"
        className="absolute -top-px left-0 h-0.5 bg-accent transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{
          width: `${100 / items.length}%`,
          transform: `translateX(${Math.max(current, 0) * 100}%)`,
          opacity: current < 0 ? 0 : 1,
        }}
      />
      {items.map(({ id, Icon, label }) => {
        const on = activeTab === id;
        return (
          <a
            key={id}
            {...tabLink(id, setActiveTab)}
            aria-current={on ? 'page' : undefined}
            className={`flex h-[60px] flex-1 flex-col items-center justify-center gap-1 transition-colors ${
              on ? 'text-accent' : 'text-ink-3'
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
          </a>
        );
      })}
    </nav>
  );
};
