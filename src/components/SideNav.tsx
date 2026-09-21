import { asideSections, navSections, type Tab } from './navSections';
import { tabLink } from '../hooks/useTabRoute';
import { useT } from '../i18n';
import { Settings, type SettingsProps } from './ui/Settings';

interface SideNavProps extends SettingsProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  alertCount: number;
  /** A ride is being followed: the Ruta row says so from any other section. */
  tripActive?: boolean;
}

const row = (on: boolean) => `flex h-11 items-center gap-3 rounded-control px-3 text-left text-body ${on ? 'bg-ink font-semibold text-bg' : 'font-medium text-ink-2'}`;

/**
 * The desktop shell's left rail: the same four destinations as the phone's bottom bar,
 * where a pointer lives instead of where a thumb reaches, with the settings at its foot.
 * Never rendered below lg.
 */
export function SideNav({ activeTab, setActiveTab, alertCount, tripActive = false, ...settings }: SideNavProps) {
  const t = useT();
  return (
    // A landmark, so a screen reader moving by landmark does not meet a rail with holes in it.
    <aside aria-label={t.nav.appName} className="hidden w-[236px] shrink-0 flex-col border-r border-line bg-bg lg:flex">
      <div className="px-5 pb-4 pt-5">
        <span className="text-emph font-semibold tracking-[-0.012em]">{t.nav.appName}</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2.5" aria-label={t.nav.main}>
        {navSections(t).map(({ id, Icon, label }) => {
          const on = activeTab === id;
          return (
            <a key={id} {...tabLink(id, setActiveTab)} aria-current={on ? 'page' : undefined} className={row(on)}>
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
        {asideSections(t, alertCount).map(({ id, Icon, label, badge }) => (
          <a key={id} {...tabLink(id, setActiveTab)} aria-current={activeTab === id ? 'page' : undefined} aria-label={badge > 0 ? `${label} (${badge})` : undefined} className={row(activeTab === id)}>
            <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="flex-1">{label}</span>
            {badge > 0 && <span className="tnum rounded-control bg-warn px-2 py-0.5 text-label font-bold text-warn-ink">{badge}</span>}
          </a>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-line p-3.5">
        <Settings {...settings} />
        <p className="px-1 text-label leading-relaxed text-ink-3">{t.menu.sourceShort}</p>
      </div>
    </aside>
  );
}
