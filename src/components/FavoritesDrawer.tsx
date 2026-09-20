import { useState, type ReactNode } from 'react';
import { Star, X, MapPin, Trash2, ArrowRight, Route, Clock, type LucideIcon } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { useLang, useT } from '../i18n';
import { daysLabel, frequencyLabel } from '../utils/serviceLabels';
import { BusStop, BusLine } from '../types';
import { BUS_STOPS, BUS_LINES, lineById, poleCode } from '../data/transitData';
import { LineBadge } from './ui/LineBadge';
import { Segmented } from './ui/controls';

interface FavoritesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  favoriteStopIds: string[];
  favoriteLineIds: string[];
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  onRemoveFavoriteStop: (stopId: string) => void;
  onRemoveFavoriteLine: (lineId: string) => void;
}

/** A saved thing: the body opens it, the bin removes it, the arrow opens it too. */
function SavedRow({ onOpen, onRemove, removeLabel, children }: { onOpen: () => void; onRemove: () => void; removeLabel: string; children: ReactNode }) {
  return (
    <div className="p-3.5 rounded-control border border-edge hover:border-accent hover:bg-surface/40 transition-all flex items-center justify-between gap-3 group bg-bg shadow-xs">
      <button type="button" onClick={onOpen} className="flex-1 cursor-pointer text-left">
        {children}
      </button>
      <div className="flex items-center gap-1">
        <button onClick={onRemove} className="p-1.5 text-ink-3 hover:text-warn-ink rounded-md hover:bg-warn transition-colors" title={removeLabel}>
          <Trash2 className="w-4 h-4" />
        </button>
        <button onClick={onOpen} className="p-1.5 text-accent hover:text-accent">
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

const Empty = ({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) => (
  <div className="text-center py-12 px-4">
    <Icon className="w-12 h-12 text-ink-3 mx-auto mb-3" />
    <h3 className="text-body font-bold text-ink-2">{title}</h3>
    <p className="text-label text-ink-3 mt-1">{hint}</p>
  </div>
);

export function FavoritesDrawer({ isOpen, onClose, favoriteStopIds, favoriteLineIds, onSelectStop, onSelectLine, onRemoveFavoriteStop, onRemoveFavoriteLine }: FavoritesDrawerProps) {
  const t = useT();
  const lang = useLang();
  const [tab, setTab] = useState<'stops' | 'lines'>('stops');
  const dialogRef = useDialog(isOpen, onClose);
  if (!isOpen) return null;

  const favoriteStops = BUS_STOPS.filter((s) => favoriteStopIds.includes(s.id));
  const favoriteLines = BUS_LINES.filter((l) => favoriteLineIds.includes(l.id));
  const open = (act: () => void) => () => {
    act();
    onClose();
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t.favourites.title} className="fixed inset-0 z-[2000] overflow-hidden">
      <div className="absolute inset-0 bg-ink/60 backdrop-blur-xs transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-bg shadow-2xl flex flex-col border-l border-edge">
          <div className="p-5 border-b border-edge bg-surface">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-md bg-warn flex items-center justify-center text-estimated">
                  <Star className="w-5 h-5 fill-current text-warn-ink" />
                </div>
                <div>
                  <h2 className="font-bold text-ink text-body uppercase tracking-tight">{t.favourites.title}</h2>
                  <p className="text-label text-ink-3 font-medium">{t.favourites.subtitle}</p>
                </div>
              </div>
              <button onClick={onClose} aria-label={t.favourites.close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-ink-2">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <Segmented
              className="rounded-control bg-surface/80"
              value={tab}
              onChange={setTab}
              options={[
                {
                  id: 'stops',
                  label: (
                    <span className="flex items-center justify-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-accent" />
                      {t.favourites.tabStops} ({favoriteStops.length})
                    </span>
                  ),
                },
                {
                  id: 'lines',
                  label: (
                    <span className="flex items-center justify-center gap-1.5">
                      <Route className="w-3.5 h-3.5 text-estimated" />
                      {t.favourites.tabLines} ({favoriteLines.length})
                    </span>
                  ),
                },
              ]}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
            {tab === 'stops' &&
              (favoriteStops.length === 0 ? (
                <Empty icon={Star} title={t.favourites.noFavoriteStops} hint={t.favourites.noFavoriteStopsHint} />
              ) : (
                favoriteStops.map((stop) => (
                  <SavedRow key={stop.id} onOpen={open(() => onSelectStop(stop))} onRemove={() => onRemoveFavoriteStop(stop.id)} removeLabel={t.favourites.remove}>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-accent shrink-0" />
                      <span className="font-bold text-body text-ink group-hover:text-accent">{stop.name}</span>
                    </div>
                    <div className="text-label text-ink-3 mt-0.5 ml-6">
                      {poleCode(stop) && (
                        <>
                          {t.favourites.codeShort} <span className="font-mono font-bold text-ink-2">{poleCode(stop)}</span> &bull;{' '}
                        </>
                      )}
                      {stop.zone}
                    </div>
                    <div className="flex gap-1 flex-wrap mt-2 ml-6">
                      {stop.lines.map((l) => (
                        <LineBadge key={l} number={l} color={lineById(l)?.color || '#6b615f'} size="sm" className="h-auto min-w-0 py-0.5 font-black" />
                      ))}
                    </div>
                  </SavedRow>
                ))
              ))}

            {tab === 'lines' &&
              (favoriteLines.length === 0 ? (
                <Empty icon={Route} title={t.favourites.noFavoriteLines} hint={t.favourites.noFavoriteLinesHint} />
              ) : (
                favoriteLines.map((line) => (
                  <SavedRow key={line.id} onOpen={open(() => onSelectLine(line))} onRemove={() => onRemoveFavoriteLine(line.id)} removeLabel={t.favourites.remove}>
                    <div className="flex items-center gap-2.5">
                      <LineBadge number={line.number} color={line.color} size="sm" className="h-7 w-7 rounded-md shadow-xs font-black" />
                      <div>
                        <span className="font-bold text-body text-ink group-hover:text-accent">{line.name}</span>
                        <div className="text-label text-ink-3 mt-0.5 flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-ink-3" />
                            {frequencyLabel(line, lang)}
                          </span>
                          <span>&bull;</span>
                          <span>{daysLabel(line, lang)}</span>
                        </div>
                      </div>
                    </div>
                  </SavedRow>
                ))
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
