import { useT } from '../i18n';
import { navSections, type Tab } from './navSections';
import { tabLink } from '../hooks/useTabRoute';

interface BottomNavProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  /** A ride is being followed: the Ruta tab says so from any other tab. */
  tripActive?: boolean;
}

/**
 * The four places worth going, along the bottom: this is read one-handed, standing at a
 * stop, and the top third of a phone needs a second hand. 60 px targets, aimed at without looking.
 */
export function BottomNav({ activeTab, setActiveTab, tripActive = false }: BottomNavProps) {
  const t = useT();
  return (
    <nav className="sticky bottom-0 z-[1200] flex border-t border-line bg-bg pb-1.5 lg:hidden" aria-label={t.nav.main}>
      {navSections(t).map(({ id, Icon, label }) => {
        const on = activeTab === id;
        return (
          <a
            key={id}
            {...tabLink(id, setActiveTab)}
            aria-current={on ? 'page' : undefined}
            className={`flex h-[60px] flex-1 flex-col items-center justify-center gap-1 border-t-2 transition-colors ${on ? 'border-accent text-accent' : 'border-transparent text-ink-3'}`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              {tripActive && id === 'plan' && (
                <>
                  <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" aria-hidden="true" />
                  <span className="sr-only">{t.companion.onTrip}</span>
                </>
              )}
            </span>
            <span className={`text-label ${on ? 'font-semibold' : 'font-normal'}`}>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}
