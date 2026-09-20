import { Bus, ChevronDown, Clock, Footprints } from 'lucide-react';
import { useT } from '../../i18n';
import type { BusLine, BusStop, TripSegment } from '../../types';
import { stopName } from '../../data/transitData';
import { LineBadge } from '../ui/LineBadge';
import { Provenance } from '../ui/Provenance';

interface ItineraryProps {
  segments: TripSegment[];
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
}

const NODE = { bus: 'bg-accent text-on-accent', wait: 'bg-warn text-warn-ink', walk: 'bg-ink text-on-accent' };
const CARD = { bus: 'border-edge bg-surface/30', wait: 'border-warn bg-warn/40', walk: 'border-edge bg-surface/60' };
const ICON = { bus: Bus, wait: Clock, walk: Footprints };

/** The stop you get on or off at: the label and the time on one line, the name whole on the next, never truncated. */
function StopRow({ label, time, stop, onSelect }: { label: string; time?: string; stop?: BusStop; onSelect: (stop: BusStop) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label text-ink-3">{label}</span>
        <span className="tnum shrink-0 text-body font-semibold">{time}</span>
      </div>
      <button onClick={() => stop && onSelect(stop)} title={stop?.name} className="flex min-h-11 w-full items-center text-left text-body font-semibold underline underline-offset-2">
        {stop?.name}
      </button>
    </div>
  );
}

function BusStep({ seg, onSelectStop, onSelectLine }: { seg: TripSegment & { line: BusLine } } & Omit<ItineraryProps, 'segments'>) {
  const t = useT();
  const direction = seg.line.directions.find((d) => d.id === seg.directionId);
  const all = direction?.stops ?? [];
  const from = all.indexOf(seg.fromStop?.id ?? '');
  const to = all.indexOf(seg.toStop?.id ?? '');
  const between = from >= 0 && to > from ? all.slice(from + 1, to) : [];
  const count = seg.stopsCount ?? between.length + 1;
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <LineBadge number={seg.line.number} color={seg.line.color} title={seg.line.name} onClick={() => onSelectLine(seg.line)} />
        {/* Where this bus is going, not what the line is called: the name is its two termini and did not fit. */}
        <span className="min-w-0 flex-1 truncate text-body font-semibold" title={seg.line.name}>
          <span className="sr-only">{t.service.towards('')}</span>
          <span aria-hidden="true" className="text-ink-3">
            →{' '}
          </span>
          {direction?.destination ?? seg.line.name}
        </span>
        <span className="tnum shrink-0 text-emph font-bold">{seg.durationMinutes} min</span>
      </div>
      <div className="mt-3">
        <StopRow label={t.planner.board} time={seg.departureTime} stop={seg.fromStop} onSelect={onSelectStop} />
      </div>
      {/* Collapsed by default: the question is normally "how long", and one tap answers "is my stop on this?". */}
      {between.length === 0 ? (
        <p className="mt-1.5 border-l-2 border-line py-1.5 pl-3 text-label text-ink-3">{t.planner.ride(count, seg.durationMinutes)}</p>
      ) : (
        <details className="mt-1.5 border-l-2 border-line pl-3">
          <summary className="flex h-11 cursor-pointer items-center gap-1.5 text-label text-ink-2">
            <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t.planner.ride(count, seg.durationMinutes)}
          </summary>
          <ol className="pb-2 pl-[21px]" aria-label={t.planner.viaStops}>
            {between.map((id) => (
              <li key={id} title={stopName(id)} className="truncate py-1 text-label text-ink-3">
                {stopName(id)}
              </li>
            ))}
          </ol>
        </details>
      )}
      <StopRow label={t.planner.alight} time={seg.arrivalTime} stop={seg.toStop} onSelect={onSelectStop} />
      <div className="mt-2.5">
        <Provenance precision={seg.precision ?? 'estimated'} />
      </div>
    </div>
  );
}

/** A wait or a walk: the heading, the clock span and the sentence. */
function PlainStep({ seg }: { seg: TripSegment }) {
  const t = useT();
  const wait = seg.type === 'wait';
  const Icon = wait ? Clock : Footprints;
  const ink = wait ? 'text-warn-ink' : 'text-ink';
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <span className={`text-label font-bold flex items-center gap-1.5 ${wait ? 'uppercase tracking-wide text-warn-ink' : 'text-ink'}`}>
          <Icon className={`w-3.5 h-3.5 ${wait ? 'text-estimated' : 'text-ink-2'}`} />
          {wait ? t.planner.scheduledWait : seg.walkMeters ? t.planner.walkMetres(seg.walkMeters) : t.planner.walkConnection}
        </span>
        <div className="flex items-center gap-2">
          {seg.departureTime && seg.arrivalTime && (
            <span className={`px-2 py-0.5 rounded font-mono font-bold text-label ${wait ? 'bg-warn text-warn-ink border border-warn' : 'bg-surface text-ink'}`}>
              {seg.departureTime} &rarr; {seg.arrivalTime}
            </span>
          )}
          <span className={`text-body font-black font-mono ${ink}`}>{seg.durationMinutes} min</span>
        </div>
      </div>
      <p className={wait ? 'text-label text-warn-ink font-medium bg-bg/80 p-2.5 rounded-control border border-warn' : 'text-label text-ink-2 mt-1'}>{seg.instruction}</p>
    </div>
  );
}

/** Step by step: one node and one card per segment, on a timeline. */
export function Itinerary({ segments, onSelectStop, onSelectLine }: ItineraryProps) {
  return (
    <div className="space-y-4 relative pl-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface">
      {segments.map((seg, idx) => {
        const Icon = ICON[seg.type];
        return (
          <div key={idx} className="relative">
            <div className={`absolute -left-6 top-1.5 w-5 h-5 rounded-full border-2 border-white shadow-xs flex items-center justify-center ${NODE[seg.type]}`}>
              <Icon className="w-3 h-3" />
            </div>
            <div className={`p-4 rounded-card border transition-all ${CARD[seg.type]}`}>
              {seg.type === 'bus' && seg.line ? <BusStep seg={seg as TripSegment & { line: BusLine }} onSelectStop={onSelectStop} onSelectLine={onSelectLine} /> : <PlainStep seg={seg} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
