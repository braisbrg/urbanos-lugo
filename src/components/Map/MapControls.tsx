import type { RefObject } from 'react';
import { Bus, Check, ChevronDown, ChevronRight, Layers, LocateFixed, MapPin, Navigation } from 'lucide-react';
import { useT } from '../../i18n';
import { BusLine, BusStop } from '../../types';
import type { NearbyLine } from '../../utils/places';
import { LineBadge } from '../ui/LineBadge';

export type Preset = 'all' | 'nearby' | 'stop' | 'hula' | 'campus' | 'ceao';
export type Layer = 'stops' | 'buses' | 'routes';

/** Matches the stop board: what somebody standing there could reasonably walk to. */
export const AROUND_STOP_RADIUS_M = 400;
/** How far someone will walk to a different line. */
export const NEARBY_RADIUS_M = 750;

const card = 'bg-bg rounded-card p-3.5 shadow-sm border border-edge';
const heading = 'text-label font-bold text-ink-3 uppercase tracking-widest block mb-2';

export interface MapControlsProps {
  sheetRef: RefObject<HTMLDivElement | null>;
  sheetOpen: boolean;
  onCloseSheet: () => void;
  busCount: number;
  stopCount: number;
  stopsWithQr: number;
  locate: { isLocating: boolean; isFollowing: boolean; error: string | null; toggle: () => void };
  onCenterLugo: () => void;
  preset: Preset;
  onPreset: (preset: Preset) => void;
  /** The stop whose neighbourhood is on show, when the preset is 'stop'. */
  aroundStop: BusStop | null;
  nearbyLines: NearbyLine[];
  layers: Record<Layer, boolean>;
  onToggleLayer: (layer: Layer) => void;
  listedLines: BusLine[];
  pickedLineIds: string[];
  onSelectLine: (line: BusLine) => void;
  onOpenLine: (line: BusLine) => void;
}

/**
 * Everything the map is controlled with. A sheet over the map below `lg`, an ordinary
 * sidebar from `lg` up — one set of markup, because two would drift apart the first time
 * either was edited. `invisible` when closed and not merely translated off, so tabbing
 * cannot walk into a list of twenty-four lines nobody can see.
 */
export function MapControls(p: MapControlsProps) {
  const t = useT();
  const presets: [Preset, string][] = [
    ['all', t.map.allLines],
    ['nearby', t.map.nearbyFilter],
    ['hula', t.map.filterHula],
    ['campus', t.map.filterCampus],
    ['ceao', t.map.filterCeao],
  ];
  const layerButtons: { id: Layer; Icon: typeof MapPin; tint: string; label: string }[] = [
    { id: 'stops', Icon: MapPin, tint: 'text-accent', label: t.map.layerStops },
    { id: 'buses', Icon: Bus, tint: 'text-estimated', label: t.map.layerBuses },
    { id: 'routes', Icon: Layers, tint: 'text-accent', label: t.map.layerRoutes },
  ];
  const locateLabel = p.locate.isLocating ? t.map.locating : p.locate.isFollowing ? t.map.stopFollowing : t.map.myLocation;

  return (
    <div
      ref={p.sheetRef}
      role={p.sheetOpen ? 'dialog' : undefined}
      aria-modal={p.sheetOpen ? true : undefined}
      aria-label={p.sheetOpen ? t.map.controls : undefined}
      className={`order-2 flex flex-col gap-3.5 lg:order-none lg:col-span-4 fixed inset-x-0 bottom-0 z-[510] max-h-[78dvh] overflow-y-auto rounded-t-2xl border-t border-edge bg-surface p-3.5 shadow-2xl transition-transform duration-200 motion-reduce:transition-none lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:visible lg:translate-y-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none ${
        p.sheetOpen ? 'translate-y-0' : 'invisible translate-y-full'
      }`}
    >
      {/* The handle: which way the sheet goes, and its own way out. Gone at `lg`. */}
      <div className="order-first -mt-1 flex items-center justify-between gap-2 lg:hidden">
        <span className="text-label font-bold uppercase tracking-widest text-ink-3">{t.map.controls}</span>
        <button type="button" onClick={p.onCloseSheet} aria-label={t.map.closeControls} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2">
          <ChevronDown className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-line">
          <div>
            <h2 className="font-bold text-ink text-body uppercase tracking-wider flex items-center gap-1.5">
              <Navigation className="w-4 h-4 text-accent" />
              {t.map.mapTitle}
            </h2>
            <p className="text-label text-ink-3 font-medium">{t.map.subtitle}</p>
          </div>
          <div className="text-right">
            <span className="flex items-center gap-1 text-label font-black text-estimated">
              <Bus className="w-3.5 h-3.5 text-estimated" aria-hidden="true" />
              {p.busCount} {t.map.liveBusesCount}
            </span>
            <span className="text-label text-ink-3 font-medium">{t.map.stopsCount(p.stopCount, p.stopsWithQr)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2.5">
          <button
            id="btn-map-locate"
            onClick={p.locate.toggle}
            disabled={p.locate.isLocating}
            aria-pressed={p.locate.isFollowing}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-control px-3.5 text-label font-bold shadow-xs transition-colors disabled:opacity-50 ${
              p.locate.isFollowing ? 'bg-surface text-ink border border-accent' : 'bg-accent text-on-accent'
            }`}
          >
            <LocateFixed className="w-3.5 h-3.5" />
            <span>{locateLabel}</span>
          </button>
          <button id="btn-map-center" onClick={p.onCenterLugo} className="flex h-11 items-center justify-center gap-1.5 rounded-control px-3.5 bg-surface text-label font-bold text-ink-2 border border-edge transition-colors">
            {t.map.centerLugo}
          </button>
        </div>
        {p.locate.error && (
          <p role="alert" className="mt-2 text-label leading-relaxed text-ink-2">
            {p.locate.error}
          </p>
        )}
      </div>

      {/* First of the panels on a phone, so the map has its own controls directly under it. */}
      <div className={`order-first ${card} lg:order-none`}>
        <span className={heading}>{t.map.quickFilters}</span>
        {/* A scrolling row on a phone, where five stacked buttons took 150 px of a sheet; wrapped in the sidebar, where a sideways scroll hides four of five. */}
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto lg:flex-wrap lg:overflow-x-visible">
          {presets.map(([preset, label]) => (
            <button
              key={preset}
              onClick={() => p.onPreset(preset)}
              aria-pressed={p.preset === preset}
              className={`flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-control px-2.5 py-1.5 text-center text-label font-semibold ${
                p.preset === preset ? 'bg-accent text-on-accent shadow-xs' : 'border border-edge bg-surface text-ink-2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {p.preset === 'stop' && p.aroundStop && (
          <div className="mt-2.5 rounded-control border border-accent bg-accent/10 p-3">
            <p className="text-label leading-relaxed text-ink">{t.map.aroundStopActive(p.aroundStop.name, AROUND_STOP_RADIUS_M)}</p>
            <button onClick={() => p.onPreset('all')} className="mt-2 flex h-9 items-center rounded-control border border-edge bg-bg px-3 text-label font-semibold text-ink-2">
              {t.map.aroundStopClear}
            </button>
          </div>
        )}
      </div>

      {p.preset === 'nearby' && p.nearbyLines.length > 0 && (
        <div className={card}>
          <span className={heading}>{t.map.nearbyTitle(NEARBY_RADIUS_M)}</span>
          <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1">
            {p.nearbyLines.map(({ line, nearestStop, walkMeters }) => (
              <button key={line.id} onClick={() => p.onSelectLine(line)} className="w-full p-2 rounded-md text-left flex items-center gap-2 text-label bg-surface border border-line hover:bg-surface transition-colors">
                <LineBadge number={line.number} color={line.color} size="sm" />
                <span title={nearestStop.name} className="truncate flex-1 text-ink-2">
                  {nearestStop.name}
                </span>
                <span className="tnum shrink-0 font-semibold text-ink-3">~{walkMeters} m</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={card}>
        <span className={heading}>{t.map.layers}</span>
        <div className="grid grid-cols-3 gap-1 bg-surface p-1 rounded-md text-label">
          {layerButtons.map(({ id, Icon, tint, label }) => (
            <button
              key={id}
              onClick={() => p.onToggleLayer(id)}
              aria-pressed={p.layers[id]}
              className={`h-11 rounded-control font-semibold flex items-center justify-center gap-1 transition-all ${p.layers[id] ? 'bg-bg text-ink shadow-xs' : 'text-ink-3'}`}
            >
              <Icon className={`w-3 h-3 ${tint}`} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-label font-bold text-ink-3 uppercase tracking-widest">
            {t.map.linesList}
            {p.pickedLineIds.length > 0 && <span className="ml-1.5 text-accent">· {t.map.linesPicked(p.pickedLineIds.length)}</span>}
          </span>
          <button
            onClick={() => p.onPreset('all')}
            aria-pressed={p.pickedLineIds.length === 0}
            className={`flex h-11 min-w-11 items-center justify-center rounded-control px-3 text-label font-semibold ${p.pickedLineIds.length === 0 ? 'bg-surface text-accent' : 'text-ink-3 hover:text-ink'}`}
          >
            {t.map.allLines}
          </button>
        </div>
        {/* Drawing the route and reading the timetable are two different errands, so two buttons. */}
        <div className="space-y-1 max-h-[175px] overflow-y-auto pr-1">
          {p.listedLines.map((line) => {
            const isSelected = p.pickedLineIds.includes(line.id);
            return (
              <div key={line.id} className={`flex items-stretch gap-1 rounded-control text-label transition-all border bg-surface ${isSelected ? 'border-accent font-bold shadow-xs' : 'border-line text-ink-2'}`}>
                <button onClick={() => p.onSelectLine(line)} aria-pressed={isSelected} className="flex min-h-11 flex-1 items-center gap-2 truncate p-2.5 text-left">
                  <LineBadge number={line.number} color={line.color} size="sm" />
                  <span className="truncate" title={line.name}>
                    {line.name}
                  </span>
                  {/* The row is a switch, and a tick is what says so. */}
                  {isSelected && <Check className="ml-auto h-4 w-4 shrink-0 text-accent" strokeWidth={3} aria-hidden="true" />}
                </button>
                <button onClick={() => p.onOpenLine(line)} title={t.map.openLineInfo} aria-label={`${t.map.openLineInfo}: ${line.number}`} className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-r-[8px]">
                  <ChevronRight className={`w-4 h-4 shrink-0 ${isSelected ? 'text-accent' : 'text-ink-3'}`} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
