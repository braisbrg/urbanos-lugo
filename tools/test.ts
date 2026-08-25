/**
 * One runnable check for the logic that used to be wrong.
 *
 *   npm test
 *
 * Every case below corresponds to a bug found in the audit, so a regression fails here
 * rather than in the browser.
 */
import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { BUS_STOPS, BUS_LINES } from '../src/data/transitData';
import { daysLabel, frequencyLabel } from '../src/utils/serviceLabels';
import { CSP_HEADER, CSP_META } from '../src/security/csp';
import { calculateRelevanceScore, normalizeText } from '../src/utils/searchUtils';
import { LANGS, translations } from '../src/i18n';
import { poleCode } from '../src/data/transitData';
import { isSnapshotStale } from '../src/utils/snapshotAge';
import { walkHopsOf } from '../src/services/walkingPath';
import { syncOfficialAlerts } from '../src/services/alertSyncService';
import {
  buildRuns,
  isWithinServiceWindow,
  lineRunsOn,
  parseTimeToMinutes,
  formatMinutes,
  anchorIndex,
  isLineInService,
} from '../src/utils/schedule';
import {
  planTrips,
  estimateWalk,
  getArrivalsForStop,
  nextServiceAtStop,
  getScheduledBuses,
  getDistanceMeters,
  getNearbyStops,
  timingPointStopCount,
  getNearestStopToCoords,
  findStop,
  planSmartTrip,
  resolveLocationQuery,
  QUICK_DESTINATIONS,
  LUGO_LANDMARKS,
} from '../src/utils/transitEngine';


/** Every .ts/.tsx under a directory, for checks that read the source rather than run it. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Node has no lazy chunk loading, and the geometry test below would silently pass on an
 * empty dataset otherwise. Hydrate the same way the browser does.
 */
function hydrateGeometry(): void {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../src/data/route-geometry.json');
  const geometry = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    { path: [number, number][]; stopPathIndex: number[] }
  >;
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const entry = geometry[`${line.id}|${direction.id}`];
      if (!entry) continue;
      direction.pathCoordinates = entry.path;
      direction.stopPathIndex = entry.stopPathIndex;
    }
  }
}

hydrateGeometry();


let checks = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

/** Same, for the handful of checks that have to await something. */
const okAsync = async (name: string, fn: () => Promise<void>) => {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
};

console.log('\nsearch');

ok('regex metacharacters in a query do not throw', () => {
  for (const q of ['avda [', 'C+', 'muralla*', 'a(b', '\\', '^$', 'a{2,']) {
    calculateRelevanceScore('Avda. Coruña 102', '515', 's22', q, 'Avenida da Coruña');
  }
});

ok('accents and abbreviations still match', () => {
  assert(normalizeText('Rúa Muralla') === 'rua muralla');
  assert(calculateRelevanceScore('Avda. Coruña 102', '515', 's22', 'coruna', '') > 0);
  assert(calculateRelevanceScore('Rda. Muralla 56 (Sindicatos)', '101', 's19', 'ronda muralla', '') > 0);
});

console.log('\ndata integrity');

ok('stop ids and codes are unique', () => {
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const s of BUS_STOPS) {
    assert(!ids.has(s.id), `duplicate stop id ${s.id}`);
    assert(!codes.has(s.code), `duplicate stop code ${s.code} (${s.name})`);
    ids.add(s.id);
    codes.add(s.code);
  }
});

ok('every stop an itinerary lists exists', () => {
  const ids = new Set(BUS_STOPS.map((s) => s.id));
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      for (const sid of dir.stops) {
        assert(ids.has(sid), `${line.id}/${dir.id} references missing stop ${sid}`);
      }
    }
  }
});

ok('every stop and line carries the fields the app reads', () => {
  // stops.json and lines.json are generated, and imported with a cast: TypeScript takes
  // the shape on trust. A field the generator stops emitting therefore reaches the app
  // as undefined, and the first thing to touch it throws a stack trace somewhere far
  // from the cause. Check the shape once, here, and name the stop that is wrong.
  for (const stop of BUS_STOPS) {
    assert(typeof stop.id === 'string' && stop.id, `a stop has no id`);
    assert(typeof stop.name === 'string' && stop.name, `${stop.id} has no name`);
    assert(Number.isFinite(stop.lat) && Number.isFinite(stop.lng), `${stop.id} has no position`);
    assert(Array.isArray(stop.lines), `${stop.id} has no lines array`);
  }
  for (const line of BUS_LINES) {
    assert(typeof line.id === 'string' && line.id, 'a line has no id');
    assert(typeof line.number === 'string' && line.number, `${line.id} has no number`);
    assert(typeof line.color === 'string' && line.color, `${line.id} has no colour`);
    assert(Array.isArray(line.directions) && line.directions.length > 0, `${line.id} has no directions`);
    for (const direction of line.directions) {
      assert(Array.isArray(direction.stops), `${line.id}/${direction.id} has no stops array`);
      assert(typeof direction.destination === 'string', `${line.id}/${direction.id} has no destination`);
    }
  }
});

ok('stop.lines and the itineraries agree in both directions', () => {
  const served = new Map<string, Set<string>>();
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      for (const sid of dir.stops) {
        if (!served.has(sid)) served.set(sid, new Set());
        served.get(sid)!.add(line.id);
      }
    }
  }
  for (const s of BUS_STOPS) {
    const actual = [...(served.get(s.id) || [])].sort().join(',');
    const claimed = [...s.lines].sort().join(',');
    assert(actual === claimed, `${s.id} (${s.name}) claims [${claimed}] but is served by [${actual}]`);
  }
});

ok('no line references a line id that does not exist', () => {
  const known = new Set(BUS_LINES.map((l) => l.id));
  for (const s of BUS_STOPS) {
    for (const l of s.lines) assert(known.has(l), `${s.id} references unknown line ${l}`);
  }
});

ok('no stop repeats within one direction', () => {
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      const seen = new Set<string>();
      for (const sid of dir.stops) {
        assert(!seen.has(sid), `${line.id}/${dir.id} visits ${sid} twice`);
        seen.add(sid);
      }
    }
  }
});

ok('route geometry follows the streets, not straight lines', () => {
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      if (!dir.stopPathIndex?.length) continue;
      // A straight-line polyline has one point per stop; a snapped one has many more.
      assert(
        dir.pathCoordinates.length > dir.stops.length * 3,
        `${line.id}/${dir.id} has only ${dir.pathCoordinates.length} points for ${dir.stops.length} stops`,
      );
      assert(dir.stopPathIndex.length === dir.stops.length, `${line.id}/${dir.id} stopPathIndex length mismatch`);
    }
  }
});

ok('a stop never sits further along the route than the next one', () => {
  // Matching each stop to its nearest vertex anywhere on the polyline broke wherever a
  // route uses a street twice: the stop matched the other pass, its index landed behind
  // the previous stop's, and the bus drawn between that pair travelled the line
  // backwards — right across the city, off its own route.
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      if (!dir.stopPathIndex?.length) continue;
      for (let i = 1; i < dir.stopPathIndex.length; i++) {
        assert(
          dir.stopPathIndex[i] >= dir.stopPathIndex[i - 1],
          `${line.id}/${dir.id}: stop ${i} sits at vertex ${dir.stopPathIndex[i]}, behind stop ${i - 1} at ${dir.stopPathIndex[i - 1]}`,
        );
      }
      assert(
        Math.max(...dir.stopPathIndex) <= dir.pathCoordinates.length - 1,
        `${line.id}/${dir.id} indexes a vertex the polyline does not have`,
      );
    }
  }
});

ok('a drawn bus moves at a steady pace, not vertex by vertex', () => {
  // Surveyed geometry is spaced by shape: across these directions the median segment is
  // 8.9 m and the longest 358 m. Advancing a bus one vertex per tick therefore crawled it
  // round a roundabout and flung it down a straight. Progress is measured in metres, so
  // consecutive ticks should cover comparable ground.
  hydrateGeometry();
  const base = new Date(2026, 7, 20, 9, 0, 0);
  const tracks = new Map<string, { lat: number; lng: number }[]>();
  for (let s = 0; s < 300; s += 10) {
    for (const bus of getScheduledBuses(new Date(base.getTime() + s * 1000))) {
      if (!tracks.has(bus.id)) tracks.set(bus.id, []);
      tracks.get(bus.id)!.push({ lat: bus.currentLat, lng: bus.currentLng });
    }
  }

  let checked = 0;
  for (const [id, points] of tracks) {
    if (points.length < 25) continue;
    const steps = points
      .slice(1)
      .map((p, i) => getDistanceMeters(points[i].lat, points[i].lng, p.lat, p.lng))
      .filter((d) => d > 0.01)
      .sort((a, b) => a - b);
    if (steps.length < 15) continue;
    checked++;
    const ratio = steps[steps.length - 1] / steps[Math.floor(steps.length / 2)];
    assert(ratio < 5, `${id} jumps ${ratio.toFixed(1)}x its median step between ticks`);
  }
  assert(checked > 5, `only ${checked} buses had enough samples to judge`);
});

ok('every drawn bus stays on its own route', () => {
  // The end of the chain the two checks above protect: sample the fleet through the day
  // and make sure no vehicle is placed off the polyline it belongs to.
  for (const hour of [8, 11, 14, 17, 20]) {
    const now = new Date(2026, 7, 20, hour, 25);
    const fleet = getScheduledBuses(now);
    assert(fleet.length > 0, `no buses at ${hour}:25`);
    for (const bus of fleet) {
      const line = BUS_LINES.find((l) => l.id === bus.lineId)!;
      const dir = line.directions.find((d) => d.id === bus.direction)!;
      const nearest = Math.min(
        ...dir.pathCoordinates.map(([lat, lng]) => getDistanceMeters(lat, lng, bus.currentLat, bus.currentLng)),
      );
      assert(nearest < 60, `line ${bus.lineNumber} is ${Math.round(nearest)} m off its route at ${hour}:25`);
    }
  }
});

ok('measured leg distances are at least the straight-line distance', () => {
  // A road cannot be shorter than the straight line — but the two ends of that line are
  // published stop coordinates, and those carry their own error: they are the average of
  // what the operator prints across pages, and they sit a median of 7 m off the surveyed
  // route (p90 23 m). Where both stops of a leg lie off to the same side, the distance
  // along the route between them is legitimately shorter than between the coordinates.
  // So the lower bound is the straight line less each stop's own offset from the route.
  const TOLERANCE_M = 60;
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      const offset = (i: number) => {
        const stop = BUS_STOPS.find((s) => s.id === dir.stops[i]);
        const vertex = dir.pathCoordinates?.[dir.stopPathIndex?.[i] ?? -1];
        return stop && vertex ? getDistanceMeters(vertex[0], vertex[1], stop.lat, stop.lng) : 0;
      };
      dir.legMeters?.forEach((m, i) => {
        const a = BUS_STOPS.find((s) => s.id === dir.stops[i]);
        const b = BUS_STOPS.find((s) => s.id === dir.stops[i + 1]);
        if (!a || !b) return;
        const straight = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
        const floor = straight - offset(i) - offset(i + 1) - TOLERANCE_M;
        assert(
          m >= floor,
          `${line.id}/${dir.id} leg ${i}: road ${m}m well under straight ${straight}m`,
        );
      });
    }
  }
});

ok('a line ends each direction where the other one starts', () => {
  // The bus does not teleport between trips: the return begins from the pole the
  // outbound left it at. This is the check that caught a bad repair — reordering line
  // 5.1's return by position along the surveyed route moved its first stop from HULA
  // (Ent. Principal) to (Ent. Personal), which would have the bus reversing 651 m before
  // setting off. Termini are now pinned, and this is what would notice if they stopped
  // being. The allowance is for a terminus with a pole on each side of the street.
  for (const line of BUS_LINES) {
    if (line.directions.length < 2) continue;
    const [out, back] = line.directions;
    const at = (id: string) => BUS_STOPS.find((s) => s.id === id);
    const pairs: [string, string][] = [
      [out.stops[out.stops.length - 1], back.stops[0]],
      [back.stops[back.stops.length - 1], out.stops[0]],
    ];
    for (const [endId, startId] of pairs) {
      const end = at(endId);
      const start = at(startId);
      if (!end || !start) continue;
      const gap = getDistanceMeters(end.lat, end.lng, start.lat, start.lng);
      assert(
        gap < 500,
        `line ${line.number} finishes at "${end.name}" but the other direction starts ${Math.round(gap)} m away at "${start.name}"`,
      );
    }
  }
});

ok('every stop sits on the route drawn for its line', () => {
  // The counterpart to the check above: it excuses a short leg by the stop's distance
  // from the line, so that distance has to stay small or the excuse swallows everything.
  // The allowance matches the one buildDataset accepts a surveyed route under — a
  // published coordinate is an average across pages and carries its own error, but a
  // stop half a kilometre away, or many adrift at once, means the wrong route was taken.
  const offsets: number[] = [];
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      let adrift = 0;
      dir.stopPathIndex?.forEach((v, i) => {
        const stop = BUS_STOPS.find((s) => s.id === dir.stops[i]);
        const vertex = dir.pathCoordinates?.[v];
        if (!stop || !vertex) return;
        const off = getDistanceMeters(vertex[0], vertex[1], stop.lat, stop.lng);
        offsets.push(off);
        if (off > 150) adrift++;
        assert(off < 400, `${line.id}/${dir.id} stop ${i} (${stop.name}) is ${Math.round(off)} m off the route`);
      });
      assert(adrift <= 2, `${line.id}/${dir.id} has ${adrift} stops adrift of the route it draws`);
    }
  }
  const median = [...offsets].sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
  assert(median < 25, `stops sit a median of ${Math.round(median)} m off their route`);
});

console.log('\nservice calendar');

ok('a daytime window is respected', () => {
  const line = { days: 'De lunes a viernes (laborables)', firstDeparture: '07:00', lastDeparture: '22:00' } as any;
  assert(isWithinServiceWindow(line, parseTimeToMinutes('12:00')));
  assert(!isWithinServiceWindow(line, parseTimeToMinutes('23:30')));
  assert(!isWithinServiceWindow(line, parseTimeToMinutes('05:00')));
});

ok('a window crossing midnight is not reported as finished', () => {
  const night = { days: 'Todos los días', firstDeparture: '22:30', lastDeparture: '06:30' } as any;
  assert(isWithinServiceWindow(night, parseTimeToMinutes('23:30')), '23:30 should be in service');
  assert(isWithinServiceWindow(night, parseTimeToMinutes('02:00')), '02:00 should be in service');
  assert(!isWithinServiceWindow(night, parseTimeToMinutes('12:00')), 'midday should not be');
});

ok('weekday-only lines do not run on Sunday', () => {
  // Read from the service patterns, not from a prose label: the label is written in one
  // language and cannot be the thing the engine reasons about.
  const weekday = { services: [{ days: ['laborable'] }] } as any;
  assert(lineRunsOn(weekday, 'laborable'));
  assert(!lineRunsOn(weekday, 'domingo'));
  assert(lineRunsOn({ services: [{ days: ['laborable', 'sabado', 'domingo'] }] } as any, 'domingo'));
});

ok('every line states its service pattern in structured form', () => {
  // lineRunsOn has no prose fallback any more, so a line without services would be
  // silently treated as never running.
  for (const line of BUS_LINES) {
    assert(Array.isArray(line.services) && line.services.length > 0, `${line.id} has no services`);
    for (const service of line.services) {
      assert(service.days.length > 0, `${line.id} has a service with no days`);
    }
  }
});

ok('a stated frequency is one a rider could use', () => {
  // "Cada 420 min" was a twice-a-day school run presented as a headway.
  for (const line of BUS_LINES) {
    const label = frequencyLabel(line, 'gl');
    const stated = Number((label.match(/\d+/) || [])[0]);
    if (!Number.isFinite(stated)) continue;
    assert(stated >= 5 && stated <= 120, `${line.id} claims a headway of ${stated} min ("${label}")`);
  }
});

ok('the day and frequency labels follow the interface language', () => {
  for (const line of BUS_LINES) {
    const gl = daysLabel(line, 'gl');
    const es = daysLabel(line, 'es');
    assert(gl.length > 0 && es.length > 0, `${line.id} has no day label`);
    // "De lunes a viernes" leaking into a Galician screen is exactly what this replaced.
    assert(!/lunes|viernes|Todos los/.test(gl), `${line.id} shows Spanish in Galician: "${gl}"`);
    assert(frequencyLabel(line, 'gl').length > 0, `${line.id} has no frequency label`);
  }
});

ok('formatMinutes wraps past midnight', () => {
  assert(formatMinutes(1500) === '01:00', formatMinutes(1500));
  assert(formatMinutes(-30) === '23:30', formatMinutes(-30));
});

console.log('\ntimetable');

ok('passing times increase along every run', () => {
  for (const line of BUS_LINES) {
    line.directions.forEach((dir, i) => {
      for (const run of buildRuns(line, i, BUS_STOPS)) {
        const t = run.minutesByStopIndex;
        for (let k = 1; k < t.length; k++) {
          assert(t[k] >= t[k - 1] - 1e-6, `${line.id}/${dir.id} run goes backwards at stop ${k}`);
        }
      }
    });
  }
});

ok('the fleet is empty outside service hours', () => {
  const deepNight = new Date(2026, 7, 19, 4, 0, 0); // Wednesday 04:00
  const running = getScheduledBuses(deepNight).filter((b) => {
    const line = BUS_LINES.find((l) => l.id === b.lineId)!;
    return isWithinServiceWindow(line, 4 * 60);
  });
  assert(
    getScheduledBuses(deepNight).length === running.length,
    'buses generated for lines that are not running at 04:00',
  );
});

ok('no line has two of its own buses on the same point', () => {
  // Different lines sharing a terminus really do leave together, so only a line
  // overlapping ITSELF is a bug. The map fans coincident markers out so both show.
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  const seen = new Map<string, string>();
  for (const b of getScheduledBuses(midday)) {
    const key = `${b.lineId}|${b.currentLat.toFixed(6)},${b.currentLng.toFixed(6)}`;
    assert(!seen.has(key), `${b.id} overlaps ${seen.get(key)}`);
    seen.set(key, b.id);
  }
});

ok('bus ids are unique', () => {
  const ids = new Set<string>();
  for (const b of getScheduledBuses(new Date(2026, 7, 19, 13, 30, 0))) {
    assert(!ids.has(b.id), `duplicate bus id ${b.id}`);
    ids.add(b.id);
  }
});

console.log('\nwalking as a real option');

ok('walking is always offered', () => {
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  const options = planTrips('Praza Maior / Concello de Lugo', 'Rolda das Fontiñas', { now: midday });
  const onFoot = options.find((p) => p.segments.every((s) => s.type === 'walk'));
  assert(onFoot, 'no walking-only option offered');
  assert(onFoot!.fare?.busLegs === 0, 'walking option charges a fare');
  assert(onFoot!.totalWaitMinutes === 0, 'walking option has a wait');
});

ok('walking wins when it is genuinely quicker', () => {
  // Two stops a few hundred metres apart: no sane bus itinerary beats the walk.
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  const near = [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length)[0];
  const neighbour = BUS_STOPS.map((s) => ({
    s,
    d: getDistanceMeters(near.lat, near.lng, s.lat, s.lng),
  }))
    .filter((x) => x.d > 200 && x.d < 500)
    .sort((a, b) => a.d - b.d)[0];

  const best = planTrips(near.name, neighbour.s.name, { now: midday })[0];
  assert(best, 'no plan at all');
  assert(
    best.segments.every((s) => s.type === 'walk'),
    `expected the walk to win over ${best.durationMinutes} min of bus`,
  );
});

ok('a better-connected stop a short walk away is considered', () => {
  // Boarding candidates reach 1.2 km, so a plan may start at a stop that is not the
  // closest one. Anything else forces you to wait for whatever passes your doorstep.
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  const options = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now: midday });
  const withBus = options.filter((p) => p.segments.some((s) => s.type === 'bus'));
  assert(withBus.length > 1, 'expected several bus itineraries');
  const boardingStops = new Set(
    withBus.map((p) => p.segments.find((s) => s.type === 'bus')?.fromStop?.id),
  );
  assert(boardingStops.size > 1, 'every itinerary boards at the same stop');
});

console.log('\nhonesty of displayed times');

ok('every arrival states where its time came from', () => {
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  for (const stop of BUS_STOPS.slice(0, 60)) {
    for (const arrival of getArrivalsForStop(stop.id, midday).arrivals) {
      assert(
        arrival.precision === 'published' || arrival.precision === 'estimated',
        `${stop.id}/${arrival.lineId} has no stated precision`,
      );
    }
  }
});

ok('every published claim is backed by the row that names that stop', () => {
  // Two conditions, both necessary. The time must be printed, AND it must be printed in
  // the row for a timing point that resolves to this stop.
  //
  // Checking only the first is a test that cannot fail: the headway fallback starts at
  // line.firstDeparture, which is itself a printed time, so a bogus claim on stop 0 would
  // match "some time somewhere in the table" and slip through.
  //
  // The stop is resolved with the engine's own anchorIndex rather than a second matcher
  // written here — "Avd. Américas" has to reach "Avda. Américas 36 (Amadeus)", and a
  // private copy of that rule would drift from the one the engine actually uses.
  for (const line of BUS_LINES) {
    for (const kind of ['laborable', 'sabado', 'domingo'] as const) {
      const pattern = line.services.find((p) => p.days.includes(kind));
      line.directions.forEach((direction, i) => {
        const names = direction.stops.map(
          (id) => BUS_STOPS.find((s) => s.id === id)?.name ?? id,
        );
        for (const run of buildRuns(line, i, BUS_STOPS, kind)) {
          for (const index of run.publishedStopIndices) {
            const at = formatMinutes(run.minutesByStopIndex[index]);
            const backing = (pattern?.rows ?? []).some(
              (row) => anchorIndex(row.timingPoint, names) === index && row.times.includes(at),
            );
            assert(
              backing,
              `${line.number}/${direction.id}/${kind}: "${names[index]}" claims official ${at}, but no printed row for that stop shows it`,
            );
          }
        }
      });
    }
  }
});

ok('an official time belongs to the run that shows it, not to the direction', () => {
  // The board used to ask "does ANY run of this direction publish this stop?" and then
  // label every run at that stop official. 87 of 128 official badges were false.
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  const nowMinutes = 13 * 60 + 30;
  for (const stop of BUS_STOPS) {
    for (const arrival of getArrivalsForStop(stop.id, midday).arrivals) {
      if (arrival.precision !== 'published') continue;
      const line = BUS_LINES.find((l) => l.id === arrival.lineId)!;
      const backing = line.directions.some((direction, i) => {
        const at = direction.stops.indexOf(stop.id);
        if (at === -1) return false;
        return buildRuns(line, i, BUS_STOPS).some(
          (run) =>
            run.publishedStopIndices.includes(at) &&
            Math.abs((run.minutesByStopIndex[at] ?? -999) - (nowMinutes + arrival.etaMinutes)) <= 1,
        );
      });
      assert(backing, `${stop.id}: ${arrival.lineNumber} at ${arrival.etaTime} claims official with no published run`);
    }
  }
});

ok('a departure board never offers a bus that terminates there', () => {
  // At HULA the board listed "4.1 to HULA in 10 min" to somebody standing at HULA.
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  for (const stop of BUS_STOPS) {
    for (const arrival of getArrivalsForStop(stop.id, midday).arrivals) {
      const line = BUS_LINES.find((l) => l.id === arrival.lineId)!;
      for (const direction of line.directions) {
        if (direction.destination !== arrival.destination) continue;
        assert(
          direction.stops[direction.stops.length - 1] !== stop.id,
          `${stop.id}: ${arrival.lineNumber} to ${arrival.destination} ends here`,
        );
      }
    }
  }
});

ok('only real timing points are called published', () => {
  // A stop the operator prints no time for must never be labelled official.
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  let published = 0;
  let estimated = 0;
  for (const stop of BUS_STOPS) {
    for (const arrival of getArrivalsForStop(stop.id, midday).arrivals) {
      const line = BUS_LINES.find((l) => l.id === arrival.lineId)!;
      const dirIndex = Math.max(
        0,
        line.directions.findIndex((d) => d.destination === arrival.destination),
      );
      const direction = line.directions[dirIndex];
      const stopIndex = direction.stops.indexOf(stop.id);
      const runs = buildRuns(line, dirIndex, BUS_STOPS, 'laborable');
      const isTimingPoint = runs.some((r) => r.publishedStopIndices.includes(stopIndex));
      if (arrival.precision === 'published') {
        assert(isTimingPoint, `${stop.id}/${arrival.lineId} claims an official time it does not have`);
        published++;
      } else {
        estimated++;
      }
    }
  }
  assert(published > 0 && estimated > 0, 'expected a mix of published and estimated times');
});

ok('a planned trip states the provenance of every bus leg', () => {
  const plan = planSmartTrip('Fonte dos Ranchos', 'HULA', { now: new Date(2026, 7, 19, 13, 30, 0) });
  assert(plan, 'no plan returned');
  for (const segment of plan!.segments) {
    if (segment.type !== 'bus') continue;
    assert(
      segment.precision === 'published' || segment.precision === 'estimated',
      'bus segment has no stated precision',
    );
  }
});

ok('no vehicle carries a field we cannot honestly fill', () => {
  // speedKmH, lastUpdated and delaySeconds were invented and shown as if measured.
  for (const bus of getScheduledBuses(new Date(2026, 7, 19, 13, 30, 0))) {
    for (const banned of ['speedKmH', 'lastUpdated', 'isDelayed', 'delaySeconds']) {
      assert(!(banned in bus), `ScheduledBus still exposes ${banned}`);
    }
  }
});

console.log('\narrivals and planning');

ok('a busy stop has a board at midday and none at 04:00', () => {
  const busiest = [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length)[0];
  const midday = getArrivalsForStop(busiest.id, new Date(2026, 7, 19, 13, 30, 0));
  assert(midday.stop, 'stop not resolved');
  assert(midday.arrivals.length > 0, `no arrivals at ${busiest.name} at 13:30`);
  assert(
    midday.arrivals.every((a) => a.etaMinutes >= 0),
    'negative ETA',
  );
  const night = getArrivalsForStop(busiest.id, new Date(2026, 7, 19, 4, 0, 0));
  assert(night.arrivals.length === 0, `${night.arrivals.length} arrivals invented at 04:00`);
});

ok('every landmark sits near a real stop', () => {
  // A landmark that drifts away from the network resolves to the wrong stop and the
  // planner then reports "no route". HULA was 818 m out and did exactly that.
  const MAX_M = 600;
  for (const lm of LUGO_LANDMARKS) {
    const nearest = getNearestStopToCoords(lm.lat, lm.lng);
    assert(
      nearest.walkMeters <= MAX_M,
      `${lm.name} is ${nearest.walkMeters}m from the nearest stop (${nearest.stop.name})`,
    );
  }
});

ok('named destinations resolve to a well-connected stop', () => {
  for (const q of ['HULA', 'Hospital Lucus Augusti (HULA)', 'Campus USC', 'As Termas', 'Fonte dos Ranchos']) {
    const r = resolveLocationQuery(q);
    assert(r !== null, `${q} did not resolve at all`);
    assert(r!.nearestStop.lines.length > 0, `${q} resolved to an unserved stop`);
  }
});

ok('every quick destination points at a real, distinct place', () => {
  // Each chip carries a short label and the full name the resolver needs. "Rda. Muralla"
  // carried Praza Maior's query, so two differently-labelled buttons went to the same
  // square — invisible while an unresolvable query silently became BUS_STOPS[0].
  const landed = new Map<string, string>();
  for (const { label, query } of QUICK_DESTINATIONS) {
    const resolved = resolveLocationQuery(query);
    assert(resolved !== null, `"${label}" (${query}) does not resolve`);
    assert(
      resolved!.nearestStop.lines.length > 0,
      `"${label}" resolves to a stop no line serves`,
    );
    const already = landed.get(resolved!.name);
    assert(!already, `"${label}" and "${already}" both land on ${resolved!.name}`);
    landed.set(resolved!.name, label);
  }
});

ok('a place the app does not know resolves to nothing, not to a random stop', () => {
  // It used to fall back to BUS_STOPS[0] while keeping the typed text as the name, so a
  // query the app never understood came back as a confident itinerary from somewhere
  // else entirely.
  for (const q of ['<script>', 'zzzzqqqq', 'Puerta del Sol', '!!!!']) {
    assert(resolveLocationQuery(q) === null, `"${q}" resolved to something`);
  }
  assert(
    planTrips('zzzzqqqq', 'HULA', { now: new Date(2026, 7, 20, 9, 30) }).length === 0,
    'planned a trip from a place that does not exist',
  );
});

ok('a real corridor plans end to end', () => {
  // Line 5ES is published as "Fonte dos Ranchos => ... => HULA", so this must resolve.
  // Pinned: without a time these read the wall clock, so they passed by day and
  // failed after the last bus. A test that depends on when it runs is not a test.
  const plan = planSmartTrip('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', {
    now: new Date(2026, 7, 20, 9, 30),
  });
  assert(plan, 'no plan for Fonte dos Ranchos -> HULA, a corridor a single line covers');
  assert(plan!.durationMinutes > 0 && plan!.durationMinutes < 240, `implausible duration: ${plan!.durationMinutes} min`);
});

ok('a stop resolves by id, by code and by name', () => {
  const s = BUS_STOPS[0];
  assert(findStop(s.id)?.id === s.id, 'by id');
  assert(findStop(s.code)?.id === s.id, 'by code');
  assert(findStop(s.name)?.id === s.id, 'by name');
});

ok('walking estimates account for the street detour', () => {
  const w = estimateWalk(1000);
  assert(w.meters > 1000, 'walk should be longer than the straight line');
  assert(w.minutes >= 15 && w.minutes <= 20, `implausible walking time: ${w.minutes} min`);
});

ok('planning two connected stops returns a usable itinerary', () => {
  const busiest = [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length)[0];
  const line = BUS_LINES.find((l) => l.id === busiest.lines[0])!;
  const dir = line.directions.find((d) => d.stops.indexOf(busiest.id) < d.stops.length - 3)!;
  const from = busiest.id;
  const to = dir.stops[dir.stops.indexOf(busiest.id) + 3];

  const plan = planSmartTrip(from, to, { now: new Date(2026, 7, 20, 9, 30) });
  assert(plan, 'no plan returned for two stops on the same line');
  assert(plan!.segments.length > 0, 'empty plan');
  assert(plan!.durationMinutes > 0, 'zero-length trip');
  assert(
    plan!.segments.every((s) => s.durationMinutes >= 0),
    'negative segment duration',
  );
});

ok('an empty board still says when the next bus is', () => {
  // "No departures right now" on its own leaves someone at the stop at 03:00 with no
  // idea whether to wait ten minutes or go home. Every served stop must be able to name
  // its next departure, however far off — including across a Sunday into Monday.
  const busiest = [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length)[0];
  for (const now of [new Date(2026, 7, 21, 3, 15), new Date(2026, 7, 20, 23, 59), new Date(2026, 7, 23, 6, 0)]) {
    const { arrivals } = getArrivalsForStop(busiest.id, now);
    const next = nextServiceAtStop(busiest.id, now);
    assert(next, 'no next departure offered');
    assert(next!.minutesAway > 0, 'the next departure is in the past');
    if (arrivals.length === 0) assert(next!.minutesAway > 1, 'an empty board should not have a bus arriving now');
  }
});

ok('a line badge can be read', () => {
  // The badge is white text on the line's own colour at 10 px, and the number on it is
  // the one thing a passenger must read at a glance. Five lines used to fail WCAG AA for
  // small text — line 2 sat at 2.94:1 — which is unreadable in daylight at a stop.
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  for (const line of BUS_LINES) {
    assert(/^#[0-9a-f]{6}$/i.test(line.color), `line ${line.number} has no usable colour`);
    const contrast = 1.05 / (luminance(line.color) + 0.05);
    assert(
      contrast >= 4.5,
      `line ${line.number}: white on ${line.color} is ${contrast.toFixed(2)}:1, under the 4.5 small text needs`,
    );
  }
});

console.log('\ntimetable fidelity');

ok('published timing points are reproduced exactly', () => {
  let verified = 0;
  for (const line of BUS_LINES) {
    const pattern = line.services?.find((p) => p.days.includes('laborable'));
    if (!pattern) continue;
    const printed = new Set(pattern.rows.flatMap((r) => r.times));

    line.directions.forEach((_, di) => {
      for (const run of buildRuns(line, di, BUS_STOPS, 'laborable')) {
        for (const index of run.publishedStopIndices) {
          const time = formatMinutes(run.minutesByStopIndex[index] % 1440);
          assert(
            printed.has(time),
            `line ${line.number} claims ${time} is published, but the table never prints it`,
          );
          verified++;
        }
      }
    });
  }
  assert(verified > 100, `only ${verified} published stop-times checked`);
});

ok('a run passes its stops in order', () => {
  for (const line of BUS_LINES) {
    line.directions.forEach((_, di) => {
      for (const run of buildRuns(line, di, BUS_STOPS, 'laborable')) {
        for (let i = 1; i < run.minutesByStopIndex.length; i++) {
          assert(
            run.minutesByStopIndex[i] >= run.minutesByStopIndex[i - 1],
            `line ${line.number} goes back in time between stops ${i - 1} and ${i}`,
          );
        }
      }
    });
  }
});

console.log('\nitineraries hold together');

/** Segment times in minutes, unwrapped across midnight. A plan only ever moves forward. */
const timeline = (plan: { segments: { departureTime?: string; arrivalTime?: string }[] }): number[] => {
  const raw = plan.segments.flatMap((s) => [
    parseTimeToMinutes(s.departureTime!),
    parseTimeToMinutes(s.arrivalTime!),
  ]);
  let day = 0;
  return raw.map((t, i) => {
    if (i > 0 && t + day < raw[i - 1] + day) day += 1440;
    return t + day;
  });
};

/** A fixed spread of city trips, planned at one moment. */
const sampleTrips = (now: Date) => {
  const urban = BUS_STOPS.filter((s) => s.zone !== 'Rural');
  const out: ReturnType<typeof planTrips> = [];
  for (let i = 0; i < 120; i++) {
    const a = urban[(i * 37) % urban.length];
    const b = urban[(i * 91 + 13) % urban.length];
    if (a.id !== b.id) out.push(...planTrips(a.name, b.name, { now }));
  }
  return out;
};

/** Rush hour, afternoon, after the last bus, and a Sunday. */
const WHEN = [
  new Date(2026, 7, 20, 8, 15),
  new Date(2026, 7, 20, 16, 52),
  new Date(2026, 7, 20, 23, 40),
  new Date(2026, 7, 23, 12, 0),
];

ok('no itinerary asks you to board a bus that already left', () => {
  for (const now of WHEN) {
    for (const plan of sampleTrips(now)) {
      const times = timeline(plan);
      for (let i = 1; i < times.length; i++) {
        assert(
          times[i] >= times[i - 1],
          `plan runs backwards: ${plan.segments.map((s) => `${s.type} ${s.departureTime}-${s.arrivalTime}`).join(' | ')}`,
        );
      }
    }
  }
});

ok('a transfer leaves time to actually change bus', () => {
  for (const now of WHEN) {
    for (const plan of sampleTrips(now)) {
      const times = timeline(plan);
      const rides = plan.segments.map((s, i) => (s.type === 'bus' ? i : -1)).filter((i) => i >= 0);
      for (let k = 1; k < rides.length; k++) {
        const gap = times[rides[k] * 2] - times[rides[k - 1] * 2 + 1];
        assert(gap >= 2, `only ${gap} min to change bus`);
      }
    }
  }
});

ok('no itinerary rides the same line twice', () => {
  // Getting off a 5.1 to wait for another 5.1 was offered, and makes no sense.
  for (const now of WHEN) {
    for (const plan of sampleTrips(now)) {
      const ids = plan.segments.filter((s) => s.type === 'bus').map((s) => s.line!.id);
      assert(new Set(ids).size === ids.length, `rides ${ids.join(' > ')}`);
    }
  }
});

ok('an hours-long walk is never the headline suggestion when a bus exists', () => {
  // Ranking on duration alone made a 168-minute walk to Calde beat a bus 285 minutes
  // out, because the rural branch runs twice a day. No map app answers "walk for nearly
  // three hours". The walk stays in the list; it stops leading it.
  //
  // The ceiling is 75 minutes, not 45: an hour on foot that beats a five-hour wait is
  // the honest answer, and hiding it below four bus cards was how the quickest way to
  // get there became the one option nobody saw.
  const now = new Date(2026, 7, 20, 9, 30);
  const served = BUS_STOPS.filter((s) => s.lines.length > 0);
  let checked = 0;
  // Widened from 500 pairs: allowing a change between two poles a short walk apart
  // connected most of what used to fall back to walking, so the old sample turned up
  // only three cases to judge.
  for (let i = 0; i < 2000; i++) {
    const a = served[(i * 67) % served.length];
    const b = served[(i * 131 + 17) % served.length];
    if (a.id === b.id) continue;
    if (getDistanceMeters(a.lat, a.lng, b.lat, b.lng) < 1500) continue;
    const plans = planTrips(a.name, b.name, { now });
    const top = plans[0];
    if (!top || top.segments.some((seg) => seg.type === 'bus')) continue;
    if (top.durationMinutes <= 75) continue;
    checked++;
    const bus = plans.find((p) => p.segments.some((seg) => seg.type === 'bus'));
    assert(
      !bus,
      `${a.name} → ${b.name}: leads with a ${top.durationMinutes} min walk while a bus plan exists (${bus?.durationMinutes} min)`,
    );
  }
  assert(checked > 5, `only ${checked} long-walk plans found to judge`);
});

ok('the options offered are visibly different from each other', () => {
  const now = new Date(2026, 7, 20, 16, 52);
  const urban = BUS_STOPS.filter((s) => s.zone !== 'Rural');
  for (let i = 0; i < 60; i++) {
    const a = urban[(i * 37) % urban.length];
    const b = urban[(i * 91 + 13) % urban.length];
    if (a.id === b.id) continue;
    const labels = planTrips(a.name, b.name, { now }).map(
      (p) => p.segments.filter((s) => s.type === 'bus').map((s) => s.line!.number).join('>') || 'walk',
    );
    assert(new Set(labels).size === labels.length, `duplicate option "${labels.join(', ')}"`);
  }
});

console.log('\ntranslations');

ok('the three dictionaries have exactly the same shape', () => {
  // The type already enforces this at compile time. The test catches what the type
  // cannot: a key present everywhere but left empty, or a function in one language where
  // another has a plain string.
  const walk = (node: unknown, path: string, out: Map<string, string>) => {
    if (typeof node === 'function') out.set(path, 'function');
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, out));
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
    } else out.set(path, typeof node);
    return out;
  };

  const shapes = LANGS.map((lang) => ({ lang, shape: walk(translations(lang), '', new Map()) }));
  const reference = shapes[0];

  for (const { lang, shape } of shapes.slice(1)) {
    for (const [path, kind] of reference.shape) {
      assert(shape.has(path), `${lang} is missing "${path}"`);
      assert(
        shape.get(path) === kind,
        `${lang}."${path}" is a ${shape.get(path)} where ${reference.lang} has a ${kind}`,
      );
    }
    for (const path of shape.keys()) {
      assert(reference.shape.has(path), `${lang} has an extra key "${path}"`);
    }
  }
});

ok('no translated string is blank', () => {
  for (const lang of LANGS) {
    const blanks: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (!node.trim()) blanks.push(path);
      } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(translations(lang), '');
    assert(blanks.length === 0, `${lang} has empty strings at: ${blanks.join(', ')}`);
  }
});

ok('every language can plan a trip and gets prose in that language', () => {
  // The engine writes sentences, so a language it does not know hands back Galician, or
  // interpolates `undefined` into the instruction. Checking only that the text is
  // non-empty would pass on an engine that ignores `lang` entirely, so the languages are
  // compared against each other: the same trip has to read differently in each.
  const now = new Date(2026, 7, 20, 9, 30);
  const byLang = new Map<string, string>();

  for (const lang of LANGS) {
    const plans = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now, lang });
    assert(plans.length > 0, `${lang}: no plan at all`);
    for (const segment of plans[0].segments) {
      assert(segment.instruction.trim().length > 0, `${lang}: a segment has no instruction`);
      assert(
        !segment.instruction.includes('undefined'),
        `${lang}: "undefined" leaked into "${segment.instruction}"`,
      );
    }
    byLang.set(lang, plans[0].segments.map((seg) => seg.instruction).join(' | '));
  }

  const distinct = new Set(byLang.values());
  assert(
    distinct.size === LANGS.length,
    `the itinerary text is identical across languages — the engine is ignoring lang: ` +
      [...byLang].map(([lang, text]) => `${lang}: ${text.slice(0, 70)}`).join('  //  '),
  );
});

ok('no translated key is left with nothing reading it', () => {
  // A dictionary rots the other way round from most code: the UI moves on and the
  // strings stay, so somebody translates dead text into three languages. Fourteen keys
  // had already outlived their screens.
  //
  // Two access shapes count as a use: `t.<ns>.<key>` in components, and a destructured
  // `translations(lang).<ns>` followed by `t.<key>` in the engine and serviceLabels.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dictionary = readFileSync(join(root, 'src/i18n/gl.ts'), 'utf8');

  const keys: { ns: string; key: string }[] = [];
  let ns = '';
  for (const line of dictionary.split('\n')) {
    const openNamespace = line.match(/^ {2}([a-zA-Z]+): \{/);
    if (openNamespace) {
      ns = openNamespace[1];
      continue;
    }
    const entry = line.match(/^ {4}([a-zA-Z]+):/);
    if (entry && ns) keys.push({ ns, key: entry[1] });
  }
  assert(keys.length > 100, `only found ${keys.length} keys — the parser is not reading the dictionary`);

  const sources = listSourceFiles(join(root, 'src'))
    .filter((file) => !file.replace(/\\/g, '/').includes('/i18n/'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const dead = keys.filter(
    ({ ns: namespace, key }) =>
      !sources.includes(`t.${namespace}.${key}`) &&
      !sources.includes(`.${namespace}.${key}`) &&
      !new RegExp(`\\bt\\.${key}\\b`).test(sources),
  );

  assert(
    dead.length === 0,
    `${dead.length} translated ${dead.length === 1 ? 'key has' : 'keys have'} nothing reading them: ` +
      dead.map((d) => `${d.ns}.${d.key}`).join(', '),
  );
});

console.log('\nservice notices');

await okAsync('an unreachable operator page is never reported as "all normal"', async () => {
  // The sync catches its own network errors, so a failure comes back as a result like
  // any other. It used to come back as `operational_normal` with "the network is running
  // completely normally" — so one unreachable minute during the hourly snapshot job
  // replaced real service notices with a claim nobody had checked.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
  try {
    const result = await syncOfficialAlerts(true);
    assert(
      result.status === 'unreachable',
      `a failed fetch reported "${result.status}" instead of "unreachable"`,
    );
    assert(result.alerts.length === 0, 'a failed fetch invented notices');
  } finally {
    globalThis.fetch = realFetch;
  }
});

ok('no view renders Galician or Spanish text of its own', () => {
  // The chip that says HORARIO OFICIAL sat in the markup as a literal rather than
  // coming from the dictionary, so an English reader was told the time came from the
  // "HORARIO OFICIAL" — the one label the whole app's credibility rests on. Greps over
  // the dictionary could not see it, because the string was never in the dictionary.
  //
  // Place names are exempt: stop, line and zone names stay in Galician on purpose, and
  // they arrive as {expressions}, not as text typed into the markup.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const marked = /(Liñas?|Líneas?|Paradas|Saída|Chegada|Frecuencia|Avisos|Tarifas|Buscar|Amosar|Ocultar|Espera|Percorrido|Traxecto|Trayecto|Marquesiña|Marquesina|Escanear|Aparencia|Apariencia|localización|Camiñar|Conexión|HORARIO OFICIAL|ESTIMADO)/;

  const offenders: string[] = [];
  for (const file of listSourceFiles(join(root, 'src'))) {
    // The dictionaries are supposed to be full of Galician and Spanish.
    if (!/\.tsx?$/.test(file) || file.split(sep).includes('i18n')) continue;
    const source = readFileSync(file, 'utf8');
    source.split(/\r?\n/).forEach((line, i) => {
      // A trailing comment is never rendered; only what is left of the code matters.
      const text = line.replace(/\/\/.*$/, '').trim();
      if (!text || text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return;
      // Template literals count too: the map builds its tooltips and popups as HTML
      // strings, and two labels hid there for exactly that reason.
      // JSX text: a line that is words, not an expression, attribute or import.
      const inTemplate = /`[^`]*[A-Za-zÁÉÍÓÚÑ]/.test(text);
      // Skipping every line with an '=' let one through: the planner showed the GPS
      // placeholder as Galician prose inside a value={...} attribute. So quoted strings
      // are also checked on their own. Class names and ids never match a Galician word,
      // so widening this costs no false positives.
      const isJsxText = !/^[<{}/]|=|import |const |type |interface /.test(text);
      const quoted = (text.match(/'[^']*'|"[^"]*"/g) ?? []).join(' ');
      if (!marked.test(isJsxText || inTemplate ? text : quoted)) return;
      offenders.push(`${file.split(/[\\/]/).pop()}:${i + 1}  ${text.slice(0, 54)}`);
    });
  }

  assert(
    offenders.length === 0,
    `text typed straight into the markup instead of coming from the dictionary:\n  ` +
      offenders.join('\n  '),
  );
});

console.log('\nuntested corners');

ok('a service window that crosses midnight is not read as finished', () => {
  // isLineInService decides whether the "no service" banner shows. A night line
  // running 22:30 to 06:30 has a window whose end is numerically before its start,
  // and the naive comparison calls that "closed all day".
  const night = { firstDeparture: '22:30', lastDeparture: '06:30', services: [{ days: ['laborable'] }] } as any;
  const tuesday = (h: number, m: number) => new Date(2026, 7, 18, h, m);

  assert(isLineInService(night, tuesday(23, 0)), 'a night line is closed at 23:00');
  assert(isLineInService(night, tuesday(2, 0)), 'a night line is closed at 02:00');
  assert(!isLineInService(night, tuesday(12, 0)), 'a night line is open at midday');

  const day = { firstDeparture: '07:15', lastDeparture: '22:00', services: [{ days: ['laborable'] }] } as any;
  assert(isLineInService(day, tuesday(12, 0)), 'a day line is closed at midday');
  assert(!isLineInService(day, tuesday(3, 0)), 'a day line is open at 03:00');
});

ok('nearby stops come back nearest first, with a walk rather than a straight line', () => {
  // The field is walkMeters, not distanceMeters: it is the straight line inflated by
  // the calibrated detour factor, and the screen prints it with a ~.
  const cathedral = { lat: 43.0084, lng: -7.5583 };
  const nearby = getNearbyStops(cathedral.lat, cathedral.lng);

  assert(nearby.length === BUS_STOPS.length, 'getNearbyStops dropped stops');
  for (let i = 1; i < nearby.length; i++) {
    assert(
      nearby[i].walkMeters >= nearby[i - 1].walkMeters,
      `stop ${i} is closer than the one before it`,
    );
  }

  const straight = getDistanceMeters(cathedral.lat, cathedral.lng, nearby[0].lat, nearby[0].lng);
  assert(
    nearby[0].walkMeters >= straight,
    `a walk of ${nearby[0].walkMeters} m is shorter than the ${Math.round(straight)} m straight line`,
  );
});

ok('the walked hops of a plan are real walks, and the last one reaches the destination', () => {
  // walkHopsOf feeds the pedestrian router. There is at most one hop per bus leg plus
  // one at the end, but fewer is normal and correct: when the origin resolves to the
  // boarding stop itself, or a change happens at the same pole, that hop has zero length
  // and asking a router to walk it would be nonsense.
  const now = new Date(2026, 7, 20, 9, 30);
  const plan = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to take hops from');

  const origin = resolveLocationQuery('Fonte dos Ranchos');
  const destination = resolveLocationQuery('Hospital Lucus Augusti (HULA)');
  assert(origin && destination, 'the endpoints of the test trip do not resolve');
  const hops = walkHopsOf(plan, origin!, destination!);

  const rides = plan.segments.filter((seg) => seg.type === 'bus').length;
  assert(hops.length <= rides + 1, `${rides} bus legs cannot need ${hops.length} walked hops`);
  for (const [from, to] of hops) {
    assert(from[0] !== to[0] || from[1] !== to[1], 'a hop that starts where it ends');
  }
  const last = hops[hops.length - 1];
  assert(
    !last || (last[1][0] === destination!.lat && last[1][1] === destination!.lng),
    'the last walked hop does not end at the destination',
  );
});

ok('the published-stop count the board quotes matches the data', () => {
  // The board explains "the operator publishes times at N of the M stops". Those two
  // numbers used to be prose; they are counted now, and this is what keeps them true.
  const { published, total } = timingPointStopCount();
  assert(total === BUS_STOPS.length, `quoted ${total} stops, the dataset has ${BUS_STOPS.length}`);
  assert(published > 0 && published < total, `${published} published of ${total} is not a believable split`);
});

ok('no colour is written straight into a class name', () => {
  // The theme lives in tokens so dark mode and the per-line tints follow one source.
  // A one-off sweep took 707 fixed-palette classes to zero and nothing stopped them
  // coming back: three placeholder-slate-400 crept in, invisible to a sweep that only
  // knew about bg- and text-. This is the ratchet that sweep never had.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const FAMILY = /bg|text|border|ring|fill|stroke|from|via|to|divide|outline|shadow|placeholder/;
  const HUE = /slate|gray|zinc|neutral|stone|blue|sky|indigo|amber|yellow|orange|green|emerald|teal|red|rose|pink|purple|violet/;
  const PALETTE = new RegExp(
    String.raw`\b(?:${FAMILY.source})(?::[a-z-]+)?-(?:${HUE.source})-\d{2,3}\b`,
    'g',
  );

  const offenders: string[] = [];
  for (const file of listSourceFiles(join(root, 'src'))) {
    if (!/\.tsx?$/.test(file)) continue;
    for (const hit of readFileSync(file, 'utf8').match(PALETTE) ?? []) {
      offenders.push(`${file.split(/[\/]/).pop()}  ${hit}`);
    }
  }

  assert(
    offenders.length === 0,
    `${offenders.length} fixed palette classes, which will not follow the theme: ` +
      [...new Set(offenders)].join(', '),
  );
});

ok('a saved snapshot stops speaking for the present once it is old', () => {
  // The server path already refuses to round "could not read the page" down to
  // "everything is fine". The client had its own way in: on static hosting there is
  // no server, so the notices always come from the committed snapshot, and a stale
  // one kept asserting "the network is running normally" in the present tense.
  const now = new Date(2026, 7, 25, 12, 0);
  const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();

  assert(!isSnapshotStale(null, now), 'a live answer is not a snapshot');
  assert(!isSnapshotStale(iso(1), now), 'an hour-old snapshot should still count');
  assert(!isSnapshotStale(iso(5), now), 'five hours is inside the refresh window');
  assert(isSnapshotStale(iso(7), now), 'seven hours should read as stale');
  assert(isSnapshotStale(iso(24 * 5), now), 'a five-day-old snapshot is not evidence about now');
  assert(isSnapshotStale('not a date', now), 'an unreadable date is not a fresh one');
});

ok('the QR count on the map is the number of poles that have one', () => {
  // The map header read "429 paradas con QR" — every stop in the network — while the
  // operator publishes a token for 271 of them. poleCode already refuses to invent one,
  // so the app showed no code on the other 158 while still counting them.
  const withToken = BUS_STOPS.filter((s) => poleCode(s)).length;
  assert(withToken > 0, "no stop has a QR token at all");
  assert(
    withToken < BUS_STOPS.length,
    "every stop has a token, so this test no longer proves anything",
  );
  for (const s of BUS_STOPS) {
    const code = poleCode(s);
    assert(code === null || code === s.officialToken, `${s.name}: code is not the token`);
  }
});

ok('a name the operator still prints is still findable after merging', () => {
  // One pole is listed twice by the operator, once with a live-panel token and once
  // without, sometimes under a different label. Merging them into one stop is right —
  // they are one pole — but it cost "Opuesto Piscina Pedreiras" its entry until the
  // other label was kept as an alias.
  const withAliases = BUS_STOPS.filter((s) => (s.aliases ?? []).length > 0);
  assert(withAliases.length > 0, "no stop carries an alias, so this proves nothing");
  for (const stop of withAliases) {
    for (const alias of stop.aliases!) {
      assert(alias !== stop.name, `${stop.name} lists its own name as an alias`);
      const found = resolveLocationQuery(alias);
      assert(found?.nearestStop.id === stop.id, `"${alias}" no longer resolves to ${stop.name}`);
    }
  }
});

ok('no two stops share a point', () => {
  // Nine poles shipped as eighteen stops: identical name, identical published
  // coordinates, two operator ids. Every stop list, zone filter and nearest-stop
  // search counted them twice.
  const seen = new Map<string, string>();
  for (const s of BUS_STOPS) {
    const key = `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    const other = seen.get(key);
    assert(!other, `${s.name} and ${other} are published at the same point`);
    seen.set(key, s.name);
  }
});

ok('a route drawn from a car route says so', () => {
  // 45 of the 48 directions follow the itinerary surveyed in OpenStreetMap; three are
  // built from the route a car would take between the stops, which detours where a bus
  // does not. Drawing those without a word is the map claiming to know something it
  // does not, so the line page carries a note whenever the direction is not surveyed.
  // If a rebuild silently turns more routes into car routes, this is where it shows up.
  const bySource = new Map<string, string[]>();
  for (const line of BUS_LINES) {
    for (const d of line.directions) {
      const src = d.geometrySource ?? 'missing';
      bySource.set(src, [...(bySource.get(src) ?? []), `${line.number} ${d.name}`]);
    }
  }
  assert(!bySource.has('missing'), 'a direction is drawn with no record of where the shape came from');
  const approximate = [...(bySource.get('osrm') ?? []), ...(bySource.get('straight') ?? [])];
  assert(
    approximate.length <= 3,
    `${approximate.length} directions are drawn from something other than a survey: ${approximate.join(', ')}`,
  );
});

ok('a trip never rides a bus to reach a stop it could have walked to', () => {
  // Fonte dos Ranchos to HULA used to lead with "line 9, one stop, one minute" after
  // three minutes waiting -- a ride whose only purpose was reaching Rda. Muralla, a
  // seven-minute walk away. It happened because the ten nearest stops were all on one
  // corridor, so the stop that offers nine more lines was never a candidate.
  //
  // Two things are pinned. That the one-bus trip exists at all, and that when two
  // plans take the same time the simpler one leads. A fixed Wednesday midday, because
  // both the hour and the day of the week change which services run.
  const NOON = { now: new Date(2026, 7, 19, 12, 34, 0) };
  const plans = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', NOON);
  assert(plans.length > 0, 'no plan at all from Fonte dos Ranchos to HULA at midday');

  const legs = (p: (typeof plans)[number]) => p.segments.filter((s) => s.type === 'bus');
  const head = plans[0];
  assert(
    legs(head).length <= 1,
    `the headline changes bus ${legs(head).length - 1} time(s): ${legs(head).map((s) => `${s.line?.number} for ${s.stopsCount} stop(s)`).join(' then ')}`,
  );

  // No plan anywhere may ask you to ride a single stop. Across the network the best
  // such ride saved three minutes against walking, which a late bus erases.
  const sample = BUS_STOPS.filter((_, i) => i % 47 === 0).slice(0, 8);
  for (const from of sample) {
    for (const to of sample) {
      if (from.id === to.id) continue;
      for (const p of planTrips(from.name, to.name, NOON)) {
        const oneStop = legs(p).find((s) => (s.stopsCount ?? 9) <= 1);
        if (oneStop) {
          assert(
            false,
            `${from.name} -> ${to.name} offers line ${oneStop.line?.number} for a single stop`,
          );
        }
      }
    }
  }

  // Nothing that ties on time may lead a plan that gets there with fewer buses.
  for (const from of sample) {
    for (const to of sample) {
      if (from.id === to.id) continue;
      const options = planTrips(from.name, to.name, NOON);
      const best = options[0];
      if (!best) continue;
      // Both sides must actually ride something. A walking plan that ties with a bus
      // deliberately loses -- see WALK_MUST_BEAT_BUS_BY_MIN -- so it is not a counter-
      // example to "do not change bus when you need not".
      const simpler = options.find(
        (p) =>
          p.durationMinutes === best.durationMinutes &&
          legs(p).length > 0 &&
          legs(p).length < legs(best).length,
      );
      // Built inside the branch: an assert message is an argument, so it is evaluated
      // whether or not the assertion fails, and `simpler` is usually undefined.
      if (simpler) {
        assert(
          false,
          `${from.name} -> ${to.name}: leads with ${legs(best).length} buses in ${best.durationMinutes} min, ` +
            `when ${legs(simpler).length} would do it in the same time`,
        );
      }
    }
  }
});

ok('the content security policy still refuses what it was written to refuse', () => {
  // A CSP erodes one exception at a time, and each one looks reasonable on the day.
  // Scripts are the ones that matter: the build has no inline script, no worker and no
  // wasm, and the QR scanner uses the browser's own BarcodeDetector, so 'self' is
  // enough and anything looser means something got added without noticing.
  const script = CSP_HEADER.match(/script-src ([^;]+)/)?.[1] ?? '';
  assert(script.trim() === "'self'", `script-src is "${script.trim()}", not just 'self'`);
  assert(!/unsafe-eval/.test(CSP_HEADER), 'unsafe-eval crept into the policy');
  assert(/object-src 'none'/.test(CSP_HEADER), "object-src is no longer 'none'");
  assert(/frame-ancestors 'none'/.test(CSP_HEADER), 'the header lost frame-ancestors');
  // The meta form silently ignores frame-ancestors and logs an error for every visitor.
  assert(!/frame-ancestors/.test(CSP_META), 'frame-ancestors is back in the meta policy');

  // Every remote origin the policy allows should be one the app actually talks to.
  const allowed = [...CSP_HEADER.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]);
  const expected = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://*.basemaps.cartocdn.com',
    'https://routing.openstreetmap.de',
  ];
  for (const origin of allowed) {
    assert(expected.includes(origin), `${origin} is allowed by the policy but nothing uses it`);
  }
});

ok('dark is the default, and only a choice is remembered', () => {
  // The app is read standing at a pole, most often after dark. Two files have to agree
  // on this: the hook, and public/theme-init.js which runs before the first paint.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hook = readFileSync(join(root, 'src/hooks/useTheme.ts'), 'utf8');
  const init = readFileSync(join(root, 'public/theme-init.js'), 'utf8');
  const html = readFileSync(join(root, 'index.html'), 'utf8');

  assert(/return 'dark';/.test(hook), 'useTheme no longer falls back to dark');
  assert(
    /if \(next === 'dark'\) localStorage.removeItem/.test(hook),
    'the default is being written to storage, so clearing site data would not return to it',
  );
  assert(/class="dark"/.test(html), 'index.html no longer ships the dark class');
  assert(/theme-init\.js/.test(html), 'the pre-paint theme script is not loaded');

  // Both files read the same key, and nothing catches it if one of them changes.
  const key = hook.match(/const KEY = '([^']+)'/)?.[1];
  assert(key, 'useTheme has no storage key');
  assert(init.includes(`'${key}'`), `theme-init.js does not read ${key}`);
});

console.log(`\n${checks} checks passed\n`);
