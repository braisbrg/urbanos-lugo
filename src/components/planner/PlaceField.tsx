import { LocateFixed, MapPin } from 'lucide-react';
import { useT } from '../../i18n';
import { MAX_QUERY_LENGTH } from '../../utils/searchUtils';
import { rankLandmarks, rankStops } from '../../utils/places';

/** One row of the origin/destination autocomplete: a real stop, or a named place. */
export interface Suggestion {
  id: string;
  name: string;
  code?: string;
  type: 'stop' | 'landmark';
  score: number;
}

/** The best eight stops and places for what was typed. */
export function suggestionsFor(query: string): Suggestion[] {
  const q = query.trim();
  if (!q || q === 'my_location') return [];
  return [
    ...rankStops(q).map(({ stop, score }): Suggestion => ({ id: stop.id, name: stop.name, code: stop.code, type: 'stop', score })),
    ...rankLandmarks(q).map(({ landmark, score }, idx): Suggestion => ({ id: `lm-${idx}`, name: landmark.name, type: 'landmark', score })),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

interface PlaceFieldProps {
  id: string;
  role: 'origin' | 'dest';
  value: string;
  /** What the field shows while `value` is the GPS token. */
  display?: string;
  placeholder: string;
  label: string;
  suggestions: Suggestion[];
  open: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onPick: (name: string) => void;
  /** The origin's GPS button, or the destination's clear button. */
  trailing: { kind: 'gps'; locating: boolean; onClick: () => void } | { kind: 'clear'; onClick: () => void } | null;
}

/**
 * Where from or where to: a field with the dot or the ring that says which, the trailing
 * control that fills or empties it, and the rows that open under it. The label is for a
 * screen reader; the placeholder already carries "street, place or stop".
 */
export function PlaceField({ id, role, value, display, placeholder, label, suggestions, open, onChange, onFocus, onPick, trailing }: PlaceFieldProps) {
  const t = useT();
  const first = role === 'origin';
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute left-5 top-0 flex h-12 items-center text-ink-2" aria-hidden="true">
        <span className={`h-2 w-2 rounded-full ${first ? 'bg-ink-2' : 'border-2 border-ink-2'}`} />
      </span>
      <input
        id={id}
        maxLength={MAX_QUERY_LENGTH}
        type="text"
        value={display ?? value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className={`anim-fade h-12 w-full bg-transparent pl-11 pr-12 text-body font-semibold text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent ${first ? 'focus:rounded-t-xl' : 'focus:rounded-b-xl'}`}
      />
      {trailing?.kind === 'gps' && (
        <button
          onClick={trailing.onClick}
          aria-label={trailing.locating ? t.planner.locating : t.planner.useMyLocation}
          title={trailing.locating ? t.planner.locating : t.planner.useMyLocation}
          className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-accent"
        >
          <LocateFixed className={`h-4.5 w-4.5 ${trailing.locating ? 'animate-pulse' : ''}`} />
        </button>
      )}
      {trailing?.kind === 'clear' && (
        <button onClick={trailing.onClick} aria-label={t.search.clear} className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-label text-ink-3">
          ✕
        </button>
      )}
      {open && suggestions.length > 0 && (
        <div className="anim-drop absolute left-0 right-0 top-full mt-1 bg-bg border border-edge rounded-control shadow-md z-30 divide-y divide-line max-h-56 overflow-y-auto">
          {suggestions.map((sug) => (
            <button key={sug.id} type="button" onClick={() => onPick(sug.name)} className="w-full p-2.5 text-label hover:bg-surface cursor-pointer flex items-center justify-between gap-2 transition-colors text-left">
              <div className="flex items-center gap-2 truncate">
                <MapPin className={`w-3.5 h-3.5 shrink-0 ${first ? 'text-accent' : 'text-warn-ink'}`} />
                <span className="truncate font-bold text-ink" title={sug.name}>
                  {sug.name}
                </span>
              </div>
              {sug.code && <span className="text-label font-mono font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shrink-0">#{sug.code}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
