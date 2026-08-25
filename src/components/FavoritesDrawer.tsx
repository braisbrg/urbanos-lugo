import React, { useState } from 'react';
import { useDialog } from '../hooks/useDialog';
import { Lang, translations } from '../i18n';
import { daysLabel, frequencyLabel } from '../utils/serviceLabels';
import { Star, X, MapPin, Trash2, ArrowRight, Route, Clock } from 'lucide-react';
import { BusStop, BusLine } from '../types';
import { BUS_STOPS, BUS_LINES, poleCode } from '../data/transitData';

interface FavoritesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  favoriteStopIds: string[];
  favoriteLineIds: string[];
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  onRemoveFavoriteStop: (stopId: string) => void;
  onRemoveFavoriteLine: (lineId: string) => void;
  lang: Lang;
}

export const FavoritesDrawer: React.FC<FavoritesDrawerProps> = ({
  isOpen,
  onClose,
  favoriteStopIds,
  favoriteLineIds,
  onSelectStop,
  onSelectLine,
  onRemoveFavoriteStop,
  onRemoveFavoriteLine,
  lang,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'stops' | 'lines'>('stops');

  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  const t = translations(lang);

  const favoriteStops = BUS_STOPS.filter((s) => favoriteStopIds.includes(s.id));
  const favoriteLines = BUS_LINES.filter((l) => favoriteLineIds.includes(l.id));

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.favourites.title}
      className="fixed inset-0 z-[2000] overflow-hidden"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-bg shadow-2xl flex flex-col border-l border-edge">
          {/* Header */}
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
              <button
                onClick={onClose}
                aria-label={t.favourites.close}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Sub-tabs for Stops & Lines */}
            <div className="flex rounded-lg bg-surface/80 p-1">
              <button
                onClick={() => setActiveSubTab('stops')}
                className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md text-label font-bold transition-all ${
                  activeSubTab === 'stops'
                    ? 'bg-bg text-ink shadow-xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                <MapPin className="w-3.5 h-3.5 text-accent" />
                <span>{t.favourites.tabStops} ({favoriteStops.length})</span>
              </button>

              <button
                onClick={() => setActiveSubTab('lines')}
                className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md text-label font-bold transition-all ${
                  activeSubTab === 'lines'
                    ? 'bg-bg text-ink shadow-xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                <Route className="w-3.5 h-3.5 text-estimated" />
                <span>{t.favourites.tabLines} ({favoriteLines.length})</span>
              </button>
            </div>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
            {activeSubTab === 'stops' && (
              <>
                {favoriteStops.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Star className="w-12 h-12 text-ink-3 mx-auto mb-3" />
                    <h3 className="text-body font-bold text-ink-2">{t.favourites.noFavoriteStops}</h3>
                    <p className="text-label text-ink-3 mt-1">{t.favourites.noFavoriteStopsHint}</p>
                  </div>
                ) : (
                  favoriteStops.map((stop) => (
                    <div
                      key={stop.id}
                      className="p-3.5 rounded-lg border border-edge hover:border-accent hover:bg-surface/40 transition-all flex items-center justify-between gap-3 group bg-bg shadow-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectStop(stop);
                          onClose();
                        }}
                        className="flex-1 cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-accent shrink-0" />
                          <span className="font-bold text-body text-ink group-hover:text-accent">
                            {stop.name}
                          </span>
                        </div>
                        <div className="text-label text-ink-3 mt-0.5 ml-6">
                          {poleCode(stop) && (
                            <>
                              {t.favourites.codeShort}{' '}
                              <span className="font-mono font-bold text-ink-2">{poleCode(stop)}</span> &bull;{' '}
                            </>
                          )}
                          {stop.zone}
                        </div>

                        <div className="flex gap-1 flex-wrap mt-2 ml-6">
                          {stop.lines.map((l) => {
                            const lineObj = BUS_LINES.find((li) => li.id === l);
                            return (
                              <span
                                key={l}
                                className="px-1.5 py-0.2 rounded text-label font-black text-white"
                                style={{ backgroundColor: lineObj?.color || '#1e40af' }}
                              >
                                {l}
                              </span>
                            );
                          })}
                        </div>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onRemoveFavoriteStop(stop.id)}
                          className="p-1.5 text-ink-3 hover:text-warn-ink rounded-md hover:bg-warn transition-colors"
                          title={t.favourites.remove}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            onSelectStop(stop);
                            onClose();
                          }}
                          className="p-1.5 text-accent hover:text-accent"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}

            {activeSubTab === 'lines' && (
              <>
                {favoriteLines.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Route className="w-12 h-12 text-ink-3 mx-auto mb-3" />
                    <h3 className="text-body font-bold text-ink-2">{t.favourites.noFavoriteLines}</h3>
                    <p className="text-label text-ink-3 mt-1">{t.favourites.noFavoriteLinesHint}</p>
                  </div>
                ) : (
                  favoriteLines.map((line) => (
                    <div
                      key={line.id}
                      className="p-3.5 rounded-lg border border-edge hover:border-accent hover:bg-surface/40 transition-all flex items-center justify-between gap-3 group bg-bg shadow-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectLine(line);
                          onClose();
                        }}
                        className="flex-1 cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-7 h-7 rounded-md flex items-center justify-center font-black text-white text-label shrink-0 shadow-xs"
                            style={{ backgroundColor: line.color }}
                          >
                            {line.number}
                          </span>
                          <div>
                            <span className="font-bold text-body text-ink group-hover:text-accent">
                              {line.name}
                            </span>
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
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onRemoveFavoriteLine(line.id)}
                          className="p-1.5 text-ink-3 hover:text-warn-ink rounded-md hover:bg-warn transition-colors"
                          title={t.favourites.remove}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            onSelectLine(line);
                            onClose();
                          }}
                          className="p-1.5 text-accent hover:text-accent"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
