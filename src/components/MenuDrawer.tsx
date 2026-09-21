import { ChevronRight, X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { tabLink } from '../hooks/useTabRoute';
import { useT } from '../i18n';
import { asideSections, type Tab } from './navSections';
import { REPO_URL } from '../project';
import { Settings, type SettingsProps } from './ui/Settings';

interface MenuDrawerProps extends SettingsProps {
  open: boolean;
  onClose: () => void;
  onOpenTab: (tab: Tab) => void;
  alertCount: number;
}

/**
 * Everything consulted now and then, out of the way of everything consulted every time.
 * Favourites are deliberately NOT here: they are the home screen.
 */
export function MenuDrawer({ open, onClose, onOpenTab, alertCount, ...settings }: MenuDrawerProps) {
  const t = useT();
  const dialogRef = useDialog(open, onClose);
  if (!open) return null;

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t.menu.open} className="fixed inset-0 z-[1500]">
      {/* For the finger, not the Tab key: the X beside the title is the same action. */}
      <button className="absolute inset-0 bg-scrim" onClick={onClose} aria-label={t.menu.close} tabIndex={-1} />
      <div className="absolute inset-y-0 right-0 flex w-[306px] max-w-[85vw] flex-col border-l border-line bg-bg">
        <div className="flex items-center justify-between border-b border-line px-[18px] py-4">
          <span className="text-emph font-semibold">{t.nav.appName}</span>
          <button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-control text-ink-2" aria-label={t.menu.close}>
            <X className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-0.5 px-2.5 py-3">
          {asideSections(t, alertCount).map(({ id, Icon, label, badge }) => (
            // The count is part of the name, with a pause: read from the markup it came out as "Avisos do servizo1".
            <a
              key={id}
              {...tabLink(id, (tab) => {
                onOpenTab(tab);
                onClose();
              })}
              aria-label={badge > 0 ? `${label} (${badge})` : undefined}
              className="flex h-14 items-center gap-4 rounded-card px-3 text-left"
            >
              <Icon className={`h-5 w-5 shrink-0 ${id === 'info' ? 'text-estimated' : 'text-ink-2'}`} strokeWidth={2} aria-hidden="true" />
              <span className="flex-1 text-emph font-semibold">{label}</span>
              {badge > 0 && <span className="tnum shrink-0 rounded-control bg-warn px-2 py-0.5 text-label font-bold text-warn-ink">{badge}</span>}
              <ChevronRight className="h-4.5 w-4.5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
            </a>
          ))}
          <div className="px-3 py-2">
            <Settings {...settings} />
          </div>
        </div>

        {/* Who made this, and what it does with you: the person holding the phone was the only one not being told. */}
        <div className="mt-auto flex flex-col gap-1 border-t border-line p-5 text-label text-ink-3">
          <span>{t.menu.sourceTimetables}</span>
          <span>{t.menu.sourceGeometry}</span>
          <span>{t.menu.sourceNoGps}</span>
          <span className="mt-2 border-t border-line pt-2 text-ink-2">{t.menu.unofficial}</span>
          <span>{t.menu.privacy}</span>
          {/* On its own line, so the 44 px applies to it. */}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex min-h-11 items-center self-start underline decoration-dotted underline-offset-2">
            {t.menu.sourceCode}
          </a>
        </div>
      </div>
    </div>
  );
}
