/**
 * One runnable check per bug that was real once: `npm test`. A regression fails here
 * rather than in the browser, and each check names the bug it guards against.
 */
import assert from 'assert';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { BUS_STOPS, BUS_LINES } from '../src/data/transitData';
import { operatorTimesForStop, operatorTimesResponse, parseOperatorTimes } from '../src/services/operatorTimes';
import { daysLabel, frequencyLabel } from '../src/utils/serviceLabels';
import { CSP_HEADER, CSP_META, THEME_INIT_HASH } from '../src/security/csp';
import { THEME_INIT_SOURCE, THEME_STORAGE_KEY } from '../src/security/themeInit';
import { createHash } from 'node:crypto';
import { REPO_URL } from '../src/project';
import { ROOT_HEAD, SITE_PATHS, canonicalUrl, pageHead, pageHtml, robotsTxt, siteUrl, sitemapXml, structuredData } from '../src/seo';
import { extractAlertsFromHtml, extractConcelloNotices } from '../src/services/alertSyncService';
import { clockDriftFromTimetable } from '../src/utils/clock';
import { MAX_QUERY_LENGTH, calculateRelevanceScore, matchesQuery, normalizeText, withinEditDistance } from '../src/utils/searchUtils';
import { LANGS, translations } from '../src/i18n';
import type { RoutePlanResult } from '../src/types';
import { tripProgress, rememberPassed, AT_STOP_RADIUS_M, MISSED_AFTER_MIN, BOARDING_SOON_MIN, boardingIsNow, startTrip, advanceTrip, tripPhase, currentLeg, legTimes, shouldAskIfMissed, confirmBoarded, missedBus, packTrip, unpackTrip } from '../src/utils/tripProgress';
import { ALARM_RADIUS_M } from '../src/services/stopAlarm';
import { poleCode, FARES } from '../src/data/transitData';
import { isSnapshotStale } from '../src/utils/snapshotAge';
import { plainText } from '../src/utils/html';
import { PATHS } from '../src/routes';
import { fetchWalkingPath, walkHopsOf } from '../src/services/walkingPath';
import { routeOnFoot } from '../src/utils/walkRouter';
import { metresBetween } from '../src/utils/geo';
import { syncOfficialAlerts } from '../src/services/alertSyncService';
import { HOLIDAY_YEARS, buildRuns, dayKind, handoverMinutes, isHoliday, isWithinServiceWindow, lineRunsOn, parseTimeToMinutes, formatMinutes, anchorIndex, isLineInService, scheduledDuration } from '../src/utils/schedule';
import { MAX_BODY_BYTES, readCapped } from '../src/services/readCapped';
import festivos from '../src/data/festivos.json';
import { planTrips, TRANSFER_BUFFER_ESTIMATED_MIN, WALK_MUST_BEAT_BUS_BY_MIN } from '../src/utils/planner';
import { estimateWalk, getNearbyStops, NEARBY_STOP_LIMIT_METRES, getNearestStopToCoords, findStop, resolveLocationQuery, QUICK_DESTINATIONS, LUGO_LANDMARKS } from '../src/utils/places';
import { getArrivalsForStop, getNextLineDeparture, nextServiceAtStop, timingPointStopCount } from '../src/utils/arrivals';
import { getScheduledBuses } from '../src/utils/vehicles';
import { getDistanceMeters } from '../src/utils/geo';
import { hydrateGeometry } from './hydrateGeometry';

hydrateGeometry();

/** The repository root, and a file under it, for the checks that read the source rather than run it. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const relative = (full: string) => full.slice(root.length + 1);

/** Every file under a directory whose name matches, for the same checks. */
function listSourceFiles(dir: string, match = /\.tsx?$/): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full, match));
    else if (match.test(entry.name)) out.push(full);
  }
  return out;
}
const sourcesUnder = (...dirs: string[]) => dirs.flatMap((dir) => listSourceFiles(join(root, dir)));


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
  // The generated JSON is imported with a cast, so a field the generator stops emitting
  // reaches the app as undefined and throws far from the cause. Check the shape once, here.
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
      assert(dir.pathCoordinates.length > dir.stops.length * 3, `${line.id}/${dir.id} has only ${dir.pathCoordinates.length} points for ${dir.stops.length} stops`);
      assert(dir.stopPathIndex.length === dir.stops.length, `${line.id}/${dir.id} stopPathIndex length mismatch`);
    }
  }
});

ok('a stop never sits further along the route than the next one', () => {
  // Snapping each stop to its nearest vertex anywhere on the polyline broke where a route
  // uses a street twice: the stop matched the other pass and the bus was drawn backwards.
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      if (!dir.stopPathIndex?.length) continue;
      for (let i = 1; i < dir.stopPathIndex.length; i++) {
        assert(dir.stopPathIndex[i] >= dir.stopPathIndex[i - 1], `${line.id}/${dir.id}: stop ${i} sits at vertex ${dir.stopPathIndex[i]}, behind stop ${i - 1} at ${dir.stopPathIndex[i - 1]}`);
      }
      assert(Math.max(...dir.stopPathIndex) <= dir.pathCoordinates.length - 1, `${line.id}/${dir.id} indexes a vertex the polyline does not have`);
    }
  }
});

ok('a drawn bus moves at a steady pace, not vertex by vertex', () => {
  // Surveyed vertices are spaced by shape (8.9 m median, 358 m longest); a bus advanced
  // per vertex crawled round roundabouts and flew down straights. Progress is in metres.
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
      const nearest = Math.min(...dir.pathCoordinates.map(([lat, lng]) => getDistanceMeters(lat, lng, bus.currentLat, bus.currentLng)));
      assert(nearest < 60, `line ${bus.lineNumber} is ${Math.round(nearest)} m off its route at ${hour}:25`);
    }
  }
});

ok('measured leg distances are at least the straight-line distance', () => {
  // A road cannot be shorter than the straight line, but published stop coordinates sit a
  // median of 7 m off the route, so the bound is the straight line less each stop's offset.
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
        assert(m >= floor, `${line.id}/${dir.id} leg ${i}: road ${m}m well under straight ${straight}m`);
      });
    }
  }
});

ok('a leg that drives far further than the crow flies is the route, not a bad snap', () => {
  // Legs driving four times the straight line are either a real detour (a terminus loop, a
  // one-way system) or a stop snapped to the wrong vertex. Both survivors are detours, and
  // the count is pinned so each has to keep proving it by sitting on the drawn line.
  const SNAP_M = 30;
  const far: string[] = [];
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      if (!dir.stopPathIndex?.length) continue;
      dir.legMeters?.forEach((road, i) => {
        const a = BUS_STOPS.find((s) => s.id === dir.stops[i]);
        const b = BUS_STOPS.find((s) => s.id === dir.stops[i + 1]);
        if (!a || !b) return;
        const straight = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
        if (straight <= 5 || road / straight <= 4) return;

        far.push(`${line.number}/${dir.id} ${a.name} -> ${b.name} (${road} m vs ${Math.round(straight)} m)`);
        // The detour has to be the drawn line's own doing. If either stop is far from the
        // vertex it was matched to, the length is measuring a mis-snap instead.
        for (const [stop, at] of [
          [a, dir.stopPathIndex[i]],
          [b, dir.stopPathIndex[i + 1]],
        ] as [typeof a, number][]) {
          const vertex = dir.pathCoordinates?.[at];
          assert(vertex, `${line.number}/${dir.id}: ${stop.name} has no vertex on the drawn line`);
          const off = getDistanceMeters(vertex![0], vertex![1], stop.lat, stop.lng);
          assert(off <= SNAP_M, `${line.number}/${dir.id}: ${stop.name} is ${Math.round(off)} m off the line, so its ${road} m leg is a mis-snap and not a detour`);
        }
      });
    }
  }
  assert(far.length === 2, `${far.length} legs drive over four times the straight line, not 2:\n    ${far.join('\n    ')}`);
});

ok('a line ends each direction where the other one starts', () => {
  // The return begins from the pole the outbound left it at. This caught a repair that
  // moved 5.1's first return stop 651 m; the allowance is for a pole on each side of the street.
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
      assert(gap < 500, `line ${line.number} finishes at "${end.name}" but the other direction starts ${Math.round(gap)} m away at "${start.name}"`);
    }
  }
});

ok('every stop sits on the route drawn for its line', () => {
  // The counterpart of the short-leg excuse above: a stop's distance from the line must stay
  // small, or the excuse swallows everything. A stop half a kilometre off is the wrong route.
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

ok('a coordinate is the operator’s unless its pin duplicates the next stop’s', () => {
  // Two consecutive stops six metres apart is a mis-entered pin, not a position: the generator
  // takes the same-named surveyed pole for exactly that case and marks it `positionSource`.
  const moved = BUS_STOPS.filter((s) => s.positionSource === 'osm');
  assert(moved.length === 1, `${moved.length} stops carry an OSM position; one is known (s1065), any other needs looking at`);
  const segade = moved[0];
  assert(segade.id === 's1065' && /Monte Segade/.test(segade.name), `the repositioned stop is ${segade.id} ${segade.name}`);
  const calde = BUS_LINES.find((l) => l.id === '11-Calde')!;
  for (const dir of calde.directions) {
    const i = dir.stops.indexOf(segade.id);
    const before = BUS_STOPS.find((s) => s.id === dir.stops[i - 1])!;
    const after = BUS_STOPS.find((s) => s.id === dir.stops[i + 1])!;
    const gapBefore = getDistanceMeters(before.lat, before.lng, segade.lat, segade.lng);
    const gapAfter = getDistanceMeters(segade.lat, segade.lng, after.lat, after.lng);
    assert(gapBefore > 300 && gapAfter > 300, `${dir.id}: Monte Segade is ${Math.round(gapBefore)} m from ${before.name} and ${Math.round(gapAfter)} m from ${after.name}`);
  }
  // And the rule does not fire on the two pairs the operator publishes close together on
  // purpose -- both sides of Avda. Américas, both ends of Rúa Industria: those stay put.
  const close: string[] = [];
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      for (let i = 1; i < dir.stops.length; i++) {
        const a = BUS_STOPS.find((s) => s.id === dir.stops[i - 1])!;
        const b = BUS_STOPS.find((s) => s.id === dir.stops[i])!;
        const pair = `${a.id}>${b.id}`;
        if (getDistanceMeters(a.lat, a.lng, b.lat, b.lng) < 30 && !close.includes(pair)) close.push(pair);
      }
    }
  }
  assert(close.join(' ') === 's37>s38 s605>s606', `consecutive stops under 30 m apart: ${close.join(' ') || 'none'}; a new one is a new duplicated pin`);
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
  assert(getScheduledBuses(deepNight).length === running.length, 'buses generated for lines that are not running at 04:00');
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

/** The four 11s share a number; the id tells them apart. */
const fleetOf = (now: Date, number: string, lineId = number) =>
  getScheduledBuses(now).filter((b) => b.lineNumber === number && b.lineId === lineId);

ok('a bus turning around is drawn once, not as its outbound and its return', () => {
  // Swept every minute of the three service days: one vehicle drawn twice, 139 m apart, for
  // 58 minutes a day, and an outbound drawn eight minutes past its last timing point.
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 7, 45, 30), '7').length, 1, 'line 7 at 07:45:30');
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 8, 22, 0), '11', '11-Igrexa de Bóveda').length, 1, 'line 11 Bóveda at 08:22');
  // And it is the return that stays, because that is where the bus is now.
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 7, 45, 30), '7')[0].direction, 'volta');
});

ok('the handover never takes the second bus off a line that runs two', () => {
  // On the 2 and the 6 the round trip is longer than the headway, so a departure of the other
  // direction inside a run is the other vehicle, not this bus turning. The rail is the last
  // printed timing point.
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 9, 15, 0), '2').length, 2, 'line 2 at 09:15');
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 17, 15, 0), '6').length, 2, 'line 6 at 17:15');
  // The same rail keeps the last run of the day whole: without it the 6's 21:05 return
  // was cut at 21:10 against the 21:10 outbound, which is the other bus leaving.
  const lastReturn = fleetOf(new Date(2026, 7, 19, 21, 25, 0), '6').filter((b) => b.direction === 'volta');
  assert.strictEqual(lastReturn.length, 1, 'the 6 has its last return on the road at 21:25');
});

ok('a handover never loses a bus, cuts a printed stretch, or lands outside its run', () => {
  // The contract of handoverMinutes over every run: the marker stops after departure and no
  // later than arrival, never before the last timing point, and no line ever goes dark.
  for (const kind of ['laborable', 'sabado', 'domingo'] as const) {
    for (const line of BUS_LINES) {
      if (!lineRunsOn(line, kind)) continue;
      const handover = handoverMinutes(line, BUS_STOPS, kind);
      const legs = line.directions.flatMap((_, dir) =>
        buildRuns(line, dir, BUS_STOPS, kind).map((run, i) => {
          const t = run.minutesByStopIndex;
          const start = t[0];
          const end = t[t.length - 1];
          const until = handover.get(`${dir}|${i}`) ?? end;
          if (until !== end) {
            assert(until > start && until < end, `${line.id} ${dir}|${i} ${kind}: handover ${until} outside (${start}, ${end})`);
            assert(until >= t[run.lastTimingPointIndex], `${line.id} ${dir}|${i} ${kind}: handover before the last timing point`);
          }
          return { start, end, until };
        }),
      );
      for (let m = 0; m < 1440; m++) {
        const onRoad = legs.some((l) => (m >= l.start && m < l.end) || (m + 1440 >= l.start && m + 1440 < l.end));
        const drawn = legs.some((l) => (m >= l.start && m < l.until) || (m + 1440 >= l.start && m + 1440 < l.until));
        assert(!onRoad || drawn, `${line.id} ${kind}: no marker at ${formatMinutes(m)} though a run is underway`);
      }
    }
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
  assert(best.segments.every((s) => s.type === 'walk'), `expected the walk to win over ${best.durationMinutes} min of bus`);
});

ok('a better-connected stop a short walk away is considered', () => {
  // Boarding candidates reach 1.2 km, so a plan may start at a stop that is not the
  // closest one. Anything else forces you to wait for whatever passes your doorstep.
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  const options = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now: midday });
  const withBus = options.filter((p) => p.segments.some((s) => s.type === 'bus'));
  assert(withBus.length > 1, 'expected several bus itineraries');
  const boardingStops = new Set(withBus.map((p) => p.segments.find((s) => s.type === 'bus')?.fromStop?.id));
  assert(boardingStops.size > 1, 'every itinerary boards at the same stop');
});

console.log('\nhonesty of displayed times');

ok('every arrival states where its time came from', () => {
  const midday = new Date(2026, 7, 19, 13, 30, 0);
  for (const stop of BUS_STOPS.slice(0, 60)) {
    for (const arrival of getArrivalsForStop(stop.id, midday).arrivals) {
      assert(arrival.precision === 'published' || arrival.precision === 'estimated', `${stop.id}/${arrival.lineId} has no stated precision`);
    }
  }
});

ok('every published claim is backed by the row that names that stop', () => {
  // Printed, AND printed in the row of a timing point that resolves to this stop: the headway
  // fallback starts at a printed time, so "some time somewhere in the table" cannot fail.
  // Resolved with the engine's own anchorIndex, so this cannot drift from what ships.
  for (const line of BUS_LINES) {
    for (const kind of ['laborable', 'sabado', 'domingo'] as const) {
      const pattern = line.services.find((p) => p.days.includes(kind));
      line.directions.forEach((direction, i) => {
        const names = direction.stops.map((id) => BUS_STOPS.find((s) => s.id === id)?.name ?? id);
        for (const run of buildRuns(line, i, BUS_STOPS, kind)) {
          for (const index of run.publishedStopIndices) {
            const at = formatMinutes(run.minutesByStopIndex[index]);
            const backing = (pattern?.rows ?? []).some((row) => anchorIndex(row.timingPoint, names) === index && row.times.includes(at));
            assert(backing, `${line.number}/${direction.id}/${kind}: "${names[index]}" claims official ${at}, but no printed row for that stop shows it`);
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
        assert(direction.stops[direction.stops.length - 1] !== stop.id, `${stop.id}: ${arrival.lineNumber} to ${arrival.destination} ends here`);
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
      const dirIndex = Math.max(0, line.directions.findIndex((d) => d.destination === arrival.destination));
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
  const plan = planTrips('Fonte dos Ranchos', 'HULA', { now: new Date(2026, 7, 19, 13, 30, 0) })[0] ?? null;
  assert(plan, 'no plan returned');
  for (const segment of plan!.segments) {
    if (segment.type !== 'bus') continue;
    assert(segment.precision === 'published' || segment.precision === 'estimated', 'bus segment has no stated precision');
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
  assert(midday.arrivals.every((a) => a.etaMinutes >= 0), 'negative ETA');
  const night = getArrivalsForStop(busiest.id, new Date(2026, 7, 19, 4, 0, 0));
  assert(night.arrivals.length === 0, `${night.arrivals.length} arrivals invented at 04:00`);
});

ok('every landmark sits near a real stop', () => {
  // A landmark that drifts away from the network resolves to the wrong stop and the
  // planner then reports "no route". HULA was 818 m out and did exactly that.
  const MAX_M = 600;
  for (const lm of LUGO_LANDMARKS) {
    const nearest = getNearestStopToCoords(lm.lat, lm.lng);
    assert(nearest.walkMeters <= MAX_M, `${lm.name} is ${nearest.walkMeters}m from the nearest stop (${nearest.stop.name})`);
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
  // "Rda. Muralla" once carried Praza Maior's query, so two labelled buttons went to the same
  // square, invisible while an unresolvable query silently became BUS_STOPS[0].
  const landed = new Map<string, string>();
  for (const { label, query } of QUICK_DESTINATIONS) {
    const resolved = resolveLocationQuery(query);
    assert(resolved !== null, `"${label}" (${query}) does not resolve`);
    assert(resolved!.nearestStop.lines.length > 0, `"${label}" resolves to a stop no line serves`);
    const already = landed.get(resolved!.name);
    assert(!already, `"${label}" and "${already}" both land on ${resolved!.name}`);
    landed.set(resolved!.name, label);
  }
});

ok('no two landmarks are written at the same point', () => {
  // Two landmarks once carried the same point, so two places a reader can ask for were one.
  // `pnpm check:landmarks` measures them against OSM; this only asks that no two coincide.
  const seen = new Map<string, string>();
  for (const landmark of LUGO_LANDMARKS) {
    const point = `${landmark.lat},${landmark.lng}`;
    const already = seen.get(point);
    assert(!already, `"${landmark.name}" and "${already}" are both at ${point}`);
    seen.set(point, landmark.name);
  }
});

ok('a place the app does not know resolves to nothing, not to a random stop', () => {
  // It used to fall back to BUS_STOPS[0] while keeping the typed text as the name: a query
  // the app never understood came back as a confident itinerary from somewhere else.
  for (const q of ['<script>', 'zzzzqqqq', 'Puerta del Sol', '!!!!']) {
    assert(resolveLocationQuery(q) === null, `"${q}" resolved to something`);
  }
  assert(planTrips('zzzzqqqq', 'HULA', { now: new Date(2026, 7, 20, 9, 30) }).length === 0, 'planned a trip from a place that does not exist');
});

ok('a real corridor plans end to end', () => {
  // Line 5ES is published as "Fonte dos Ranchos => ... => HULA". Pinned to a time: read
  // off the wall clock these passed by day and failed after the last bus.
  const plan = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', {
    now: new Date(2026, 7, 20, 9, 30),
  })[0] ?? null;
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

  const plan = planTrips(from, to, { now: new Date(2026, 7, 20, 9, 30) })[0] ?? null;
  assert(plan, 'no plan returned for two stops on the same line');
  assert(plan!.segments.length > 0, 'empty plan');
  assert(plan!.durationMinutes > 0, 'zero-length trip');
  assert(plan!.segments.every((s) => s.durationMinutes >= 0), 'negative segment duration');
});

ok('an empty board still says when the next bus is', () => {
  // "No departures right now" leaves someone at the stop at 03:00 with no idea whether to
  // wait or go home. Every served stop can name its next departure, across a Sunday into Monday.
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
  // White text on the line colour at 10 px is the one thing a passenger reads at a glance;
  // five lines used to fail WCAG AA for small text.
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
    assert(contrast >= 4.5, `line ${line.number}: white on ${line.color} is ${contrast.toFixed(2)}:1, under the 4.5 small text needs`);
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
          assert(printed.has(time), `line ${line.number} claims ${time} is published, but the table never prints it`);
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
          assert(run.minutesByStopIndex[i] >= run.minutesByStopIndex[i - 1], `line ${line.number} goes back in time between stops ${i - 1} and ${i}`);
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
        assert(times[i] >= times[i - 1], `plan runs backwards: ${plan.segments.map((s) => `${s.type} ${s.departureTime}-${s.arrivalTime}`).join(' | ')}`);
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
  // Ranking on duration alone made a 168-minute walk beat a bus 285 minutes out on a twice-
  // a-day branch. The walk stays in the list and stops leading it; the ceiling is 75 min,
  // because an hour on foot that beats a five-hour wait is still the honest answer.
  const now = new Date(2026, 7, 20, 9, 30);
  const served = BUS_STOPS.filter((s) => s.lines.length > 0);
  let checked = 0;
  // Widened from 500 pairs: transfers between two poles a short walk apart connected most
  // of what used to fall back to walking, so the old sample turned up only three cases.
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
    assert(!bus, `${a.name} → ${b.name}: leads with a ${top.durationMinutes} min walk while a bus plan exists (${bus?.durationMinutes} min)`);
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
    const labels = planTrips(a.name, b.name, { now }).map((p) => p.segments.filter((s) => s.type === 'bus').map((s) => s.line!.number).join('>') || 'walk');
    assert(new Set(labels).size === labels.length, `duplicate option "${labels.join(', ')}"`);
  }
});

console.log('\ntranslations');

ok('the three dictionaries have exactly the same shape', () => {
  // The type already enforces the shape; this catches what it cannot: a key present
  // everywhere but empty, or a function in one language where another has a string.
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
      assert(shape.get(path) === kind, `${lang}."${path}" is a ${shape.get(path)} where ${reference.lang} has a ${kind}`);
    }
    for (const path of shape.keys()) {
      assert(reference.shape.has(path), `${lang} has an extra key "${path}"`);
    }
  }
});

ok('the price a trip shows is the one anybody pays', () => {
  // The planner showed 0,45 € (the Tarxeta Cidadá price) as the cost of the trip, with the
  // 0,64 € a visitor pays struck through beside it. The default is what is true for whoever
  // is reading; the better fare is offered, never assumed.
  assert(FARES.singleTicket > FARES.citizenCard, 'the ordinary fare is no longer the dearer one, so this check is about the wrong number');

  const view = read('src/components/RoutePlannerView.tsx');

  // The summary line -- the one figure you see without opening anything -- has to be the
  // ordinary fare. Take the first fare rendered in the file: it is the summary's.
  const firstFare = view.search(/fare\.(singleTicket|citizenCard)Euros/);
  assert(firstFare > 0, 'the planner no longer shows a fare at all');
  assert(/^fare\.singleTicketEuros/.test(view.slice(firstFare)), 'the first fare the planner shows is the discounted one; it should be the ordinary ticket');

  // And no fare is ever struck through.
  assert(!/line-through/.test(view), 'a fare is crossed out again, which reads as a price that no longer applies');
});

ok('the Galician card is called what its own issuer calls it', () => {
  // One card named two ways (TMG here, TPG there, in three languages), and the expansion
  // disagreed with its own acronym. The issuer writes "Transporte Metropolitano de Galicia".
  const files = ['src/i18n/gl.ts', 'src/i18n/es.ts', 'src/i18n/en.ts', 'src/data/transitData.ts', 'README.md'];
  for (const file of files) {
    const source = read(file);
    assert(!/\bTPG\b/.test(source), `${file} still calls the card TPG; the issuer calls it TMG`);
    assert(!/transporte p[úu]blico de Galicia|public transport card \(TMG\)/i.test(source), `${file} expands TMG as "public transport"; the M is for Metropolitano`);
  }

  // And the fare card itself still names it, in every language.
  for (const lang of LANGS) {
    const title = translations(lang).fares.cards.tmg.title;
    assert(/TMG/.test(title), `${lang}: the metropolitan fare card no longer says TMG`);
  }
});

ok('every map gets its chrome from the one place that has it', () => {
  // Three maps built their own furniture, so the "Leaflet |" prefix was dropped in one and
  // printed by the other two. It lives in createBasemap now; a fourth map cannot be born
  // with the old line, and nobody puts scroll-wheel zoom back on a small map in a page.
  const mapDir = join(root, 'src/components/Map');

  const basemap = readFileSync(join(mapDir, 'basemap.ts'), 'utf8');
  assert(/attributionControl\?\.setPrefix\(false\)/.test(basemap), 'createBasemap no longer drops the "Leaflet" prefix, so every map prints it again');

  for (const file of readdirSync(mapDir).filter((f) => f.endsWith('.tsx'))) {
    const source = readFileSync(join(mapDir, file), 'utf8');
    if (!/\bL\.map\(/.test(source)) continue;

    assert(/createBasemap\(/.test(source), `${file} builds a map without createBasemap, so it gets neither the basemap nor its attribution`);
    assert(!/setPrefix\(/.test(source), `${file} sets the attribution prefix itself; that belongs in basemap.ts for all of them`);
    // And its name and control titles in the reader's language. The route map was born
    // after the other two got theirs, and said "Zoom in" under a Galician itinerary.
    assert(/useMapChrome\(/.test(source), `${file} builds a map without useMapChrome, so it is an unnamed tab stop with English zoom buttons`);
  }

  // The two maps that live inside something the reader scrolls have to let them scroll.
  for (const file of ['RouteMap.tsx', 'NearbyMiniMap.tsx']) {
    const source = readFileSync(join(mapDir, file), 'utf8');
    assert(/scrollWheelZoom:\s*false/.test(source), `${file} zooms on the scroll wheel, and it sits inside a page that scrolls`);
  }

  // The route map is built inside a column that is display:none on a phone, and Leaflet's
  // invalidateSize keeps the zoom worked out for the old box: three of twenty-nine pieces on screen.
  const routeMap = readFileSync(join(mapDir, 'RouteMap.tsx'), 'utf8');
  assert(/getBounds\(\)\.contains\(/.test(routeMap), 'RouteMap no longer checks that the trip is still on the map after a resize');

  // `fitBounds` rounds down to a whole zoom unless told otherwise: 46% of the box, then 67%
  // after an unrelated tap. The basemap is vector and draws at any zoom, so it owns the setting.
  assert(/map\.options\.zoomSnap = 0/.test(basemap), 'the basemap no longer turns off whole-level zoom snapping, so fitBounds wastes up to half of every map');
  for (const file of readdirSync(mapDir).filter((f) => f.endsWith('.tsx'))) {
    const source = readFileSync(join(mapDir, file), 'utf8');
    assert(!/zoomSnap/.test(source), `${file} sets zoomSnap itself; it comes from the basemap, like the attribution prefix`);
  }
});

ok('a lost WebGL context ends in a raster map, not a blank one', () => {
  // Seen once in a production console; forced, the basemap goes blank while the routes and
  // stops on Leaflet's own canvas stay, with no word to the reader. The basemap listens for
  // the loss and the return, waits a grace while the page is visible, then swaps itself for
  // the raster fallback and remembers for the session. All in a browser: this reads the source.
  const basemap = read('src/components/Map/basemap.ts');
  assert(/webglcontextlost/.test(basemap) && /webglcontextrestored/.test(basemap), 'the basemap no longer watches for the context going and coming back');
  const grace = Number(basemap.match(/CONTEXT_GRACE_MS = ([\d_]+)/)?.[1].replace(/_/g, ''));
  assert(grace >= 2000 && grace <= 15000, `the grace is ${grace} ms: under 2 s it gives up on a context the browser was about to restore, over 15 s the blank is a screen`);

  const swap = basemap.slice(basemap.indexOf('const armGrace'), basemap.indexOf('CONTEXT_GRACE_MS);'));
  assert(swap.length > 0, 'the grace timer is gone from the basemap');
  for (const [what, pattern] of [
    ['counts only while the page is visible', /visibilityState !== 'visible'/],
    ['remembers for the session', /webgl2 = false/],
    ['removes the dead layer', /removeLayer\(layer\)/],
    ['puts the raster fallback in its place', /createBasemap\(shown\)\.addTo\(map\)/],
  ] as const) {
    assert(pattern.test(swap), `the fallback no longer ${what}`);
  }
  // A map born raster never goes through the vector path, so it needs the same dropped
  // prefix, or it prints the two-line "Leaflet | © OpenStreetMap contributors" credit.
  const raster = basemap.slice(basemap.indexOf('if (!hasWebGL2())'), basemap.indexOf('return raster;'));
  assert(/setPrefix\(false\)/.test(raster), 'the raster fallback prints the "Leaflet" prefix that the vector path drops');
});

ok('the out-of-service banner still fits on two lines', () => {
  // The banner was a 162 px panel on a 375 px phone; it is two truncating lines now, and a
  // longer translation is cut off rather than wrapped. Measured at 375 px the column takes
  // 54 characters; the chevron costs two, and the bold line is measured with a time in it.
  const SMALL_LINE = 52; // 54 minus the " ›" appended in App.tsx
  const BOLD_LINE = 42;

  for (const lang of LANGS) {
    const t = translations(lang);
    const closed = t.nightBanner.closed('07:00');
    assert(closed.length <= BOLD_LINE, `${lang}: "${closed}" is ${closed.length} characters and the banner's first line fits ${BOLD_LINE}`);
    assert(t.nightBanner.festivals.length <= SMALL_LINE, `${lang}: "${t.nightBanner.festivals}" is ${t.nightBanner.festivals.length} characters and the second line fits ${SMALL_LINE}`);
    // The festival sentence keeps "no service" from being a lie on a festival night: extra
    // buses only ever appear as a notice. Shortening it is fine; dropping it is not.
    assert(/festa|fiesta|festival/i.test(t.nightBanner.festivals), `${lang}: the banner no longer mentions the festival reinforcements`);
  }

  // And the row is the link: "see notices" survives as the accessible name of the whole
  // bar rather than as a 44 px row of its own.
  const app = read('src/App.tsx');
  assert(/nightBanner\.seeNotices/.test(app) && /sr-only[^>]*>\s*\{t\.nightBanner\.seeNotices\}/.test(app), 'the notices link is no longer the accessible name of the banner row');
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
  // An engine ignoring `lang` would hand back Galician, or interpolate `undefined`, and a
  // non-empty check would pass on it. The same trip has to read differently in each language.
  const now = new Date(2026, 7, 20, 9, 30);
  const byLang = new Map<string, string>();

  for (const lang of LANGS) {
    const plans = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now, lang });
    assert(plans.length > 0, `${lang}: no plan at all`);
    for (const segment of plans[0].segments) {
      assert(segment.instruction.trim().length > 0, `${lang}: a segment has no instruction`);
      assert(!segment.instruction.includes('undefined'), `${lang}: "undefined" leaked into "${segment.instruction}"`);
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

ok('PRIVACY.md lists every key this app writes to the device', () => {
  // PRIVACY.md names the keys and what each holds; a key added without a row is the document
  // quietly becoming false, and a saved trip is text somebody typed.
  const privacy = read('PRIVACY.md');

  const written = new Set<string>();
  // Every key is spelled `urbanos-lugo-…` or `urbanos_lugo_…`, so the spelling is what is
  // scanned for, not the call shape. sessionStorage keys match too.
  for (const full of sourcesUnder('src')) {
    for (const m of readFileSync(full, 'utf8').matchAll(/'(urbanos[-_]lugo[-_][a-z_-]+)'/g)) written.add(m[1]);
  }

  assert(written.size >= 4, `only found ${written.size} storage keys; the scan has stopped working`);
  for (const key of written) {
    assert(privacy.includes(`\`${key}\``), `${key} is written to the device and PRIVACY.md does not mention it`);
  }
});

ok('the trip companion counts stops against the list, and never backwards', () => {
  // The one piece of the ride mode with no equivalent elsewhere, and the one that can be
  // wrong without looking wrong: a GPS fix counted against the plan's own stop list.
  const now = new Date(2026, 8, 8, 9, 0, 0);
  const plan = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to follow');
  const leg = plan.segments.find((seg) => seg.type === 'bus');
  assert(leg?.fromStop && leg.toStop, 'the plan has no bus leg to ride');

  const direction = leg.line?.directions.find((d) => d.id === leg.directionId) ?? leg.line?.directions[0];
  const ids = direction?.stops ?? [];
  const ride = ids.slice(ids.indexOf(leg.fromStop!.id), ids.indexOf(leg.toStop!.id) + 1);
  assert(ride.length >= 4, `the ride is only ${ride.length} stops; this check needs a few`);
  const at = (id: string) => {
    const stop = BUS_STOPS.find((s) => s.id === id)!;
    return { lat: stop.lat, lng: stop.lng };
  };

  // At the boarding pole: nothing behind you, the whole ride ahead.
  const start = tripProgress(plan, at(ride[0]));
  assert(start.stops.length === ride.length, `${start.stops.length} stops shown for a ride of ${ride.length}`);
  assert(start.stopsRemaining === ride.length - 1, `${start.stopsRemaining} left at the very first stop`);
  assert(!start.arrived, 'arrived before the bus moved');

  // Riding: the count falls, and the stops behind are marked.
  let seen = rememberPassed(start, new Set());
  const middle = Math.floor(ride.length / 2);
  const half = tripProgress(plan, at(ride[middle]), seen);
  assert(half.stopsRemaining < start.stopsRemaining, `the count did not move between stop 0 and stop ${middle}`);
  assert(half.stops[0].passed && half.stops[middle].passed, 'the stops behind are not marked');
  assert(!half.stops[half.stops.length - 1].passed, 'the alighting stop is marked before arriving');

  // A fix between stops must not walk the count backwards: the phone does not report at
  // every pole, so what was already reached is carried, or the list un-ticks itself.
  seen = rememberPassed(half, seen);
  const nowhere = tripProgress(plan, { lat: 43.05, lng: -7.65 }, seen);
  assert(nowhere.stopsRemaining === half.stopsRemaining, `the count moved from ${half.stopsRemaining} to ${nowhere.stopsRemaining} on a fix between stops`);

  // At the alighting pole: nothing left, and it says so.
  const end = tripProgress(plan, at(ride[ride.length - 1]), seen);
  assert(end.arrived, 'standing at the alighting stop and the mode has not noticed');
  assert(end.stopsRemaining === 0, `${end.stopsRemaining} stops left while standing at the last one`);
  assert(end.metresToAlighting !== null && end.metresToAlighting < AT_STOP_RADIUS_M, 'the distance is wrong at the pole');

  // The radius is wider than eight of the published gaps, and that is known rather than
  // tuned away; what must not happen is the count growing quietly after a re-import.
  let tight = 0;
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      for (let i = 1; i < direction.stops.length; i++) {
        const a = BUS_STOPS.find((s) => s.id === direction.stops[i - 1]);
        const b = BUS_STOPS.find((s) => s.id === direction.stops[i]);
        if (a && b && getDistanceMeters(a.lat, a.lng, b.lat, b.lng) < AT_STOP_RADIUS_M) tight++;
      }
    }
  }
  assert(tight <= 8, `${tight} consecutive pairs are closer than the ${AT_STOP_RADIUS_M} m radius, up from 8`);

  // Six directions double back along their own avenue, so two stops far apart in the list
  // sit within the radius of each other. Taking the furthest in range ticked nine stops at
  // once; at every such pair the earlier pole must be the one counted.
  let doubledBack = 0;
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const poles = direction.stops.map((id) => BUS_STOPS.find((s) => s.id === id)!).filter(Boolean);
      for (let i = 0; i < poles.length; i++) {
        for (let j = i + 2; j < poles.length; j++) {
          if (getDistanceMeters(poles[i].lat, poles[i].lng, poles[j].lat, poles[j].lng) > AT_STOP_RADIUS_M) continue;
          doubledBack++;
          // A ride that boards before the near pair and gets off after it.
          const from = poles[Math.max(0, i - 1)];
          const to = poles[poles.length - 1];
          const synthetic = {
            segments: [{ type: 'bus', line, directionId: direction.id, fromStop: from, toStop: to }],
          } as unknown as RoutePlanResult;
          const behind = new Set(poles.slice(0, i).map((p) => p.id));
          const here = tripProgress(synthetic, { lat: poles[i].lat, lng: poles[i].lng }, behind);
          const later = here.stops.find((s) => s.id === poles[j].id);
          assert(
            later && !later.passed,
            `${line.number} ${direction.id}: standing at stop ${i} (${poles[i].name}) marks stop ${j} (${poles[j].name}) passed, ${getDistanceMeters(poles[i].lat, poles[i].lng, poles[j].lat, poles[j].lng).toFixed(0)} m away`,
          );
          assert(here.stops.find((s) => s.id === poles[i].id)?.passed, `${line.number} ${direction.id}: stop ${i} itself is not marked`);
        }
      }
    }
  }
  assert(doubledBack >= 6, `only ${doubledBack} doubled-back pairs found; the check is not checking`);
});

ok('the trip companion moves through its phases on fixes alone, rings once a leg, and carries a transfer', () => {
  // The mode is a cursor over plan.segments driven by fixes: nobody is on the bus until seen
  // past the boarding pole, the alert rings once a leg, and a transfer walk does not hand
  // the cursor back to the bus just left.
  const now = new Date(2026, 8, 8, 9, 0, 0);
  const plan = planTrips('Intercentros Campus Universitario USC', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to follow');
  const legs = plan.segments.flatMap((seg, i) => (seg.type === 'bus' ? [i] : []));
  assert(legs.length === 2, `this check needs a transfer and the plan has ${legs.length} bus legs`);
  const [first, second] = legs.map((i) => plan.segments[i]);
  assert(first.toStop && second.fromStop && first.toStop.id !== second.fromStop.id, 'this check needs a transfer that walks between two poles');
  const at = (stop: { lat: number; lng: number }) => ({ lat: stop.lat, lng: stop.lng });
  const stopsOf = (leg: number) => {
    const seg = plan.segments[leg];
    const dir = seg.line!.directions.find((d) => d.id === seg.directionId)!;
    return dir.stops.slice(dir.stops.indexOf(seg.fromStop!.id), dir.stops.indexOf(seg.toStop!.id) + 1)
      .map((id) => BUS_STOPS.find((s) => s.id === id)!);
  };
  const ride1 = stopsOf(legs[0]);
  const ride2 = stopsOf(legs[1]);

  let state = startTrip(plan, null, null);
  assert(tripPhase(state, null) === 'waiting', 'a trip just started is not waiting');
  assert(currentLeg(state, null) === legs[0], 'the first leg on screen is not the first bus');

  // Standing at the boarding pole is still waiting: the pole is the first stop.
  let progress = tripProgress(plan, at(ride1[0]), new Set(state.seen));
  let step = advanceTrip(state, progress);
  state = step.state;
  assert(!step.ring, 'rang at the boarding pole');
  assert(tripPhase(state, progress) === 'waiting', 'boarding pole counted as riding');

  // Past the second stop: riding, no alert yet.
  progress = tripProgress(plan, at(ride1[1]), new Set(state.seen));
  step = advanceTrip(state, progress);
  state = step.state;
  assert(!step.ring, 'rang two stops into the ride');
  assert(tripPhase(state, progress) === 'riding', `phase is ${tripPhase(state, progress)} past the second stop`);
  assert(state.boardedLeg === legs[0], 'riding, but the leg was not recorded as boarded');

  // At the alighting pole: the alert, once. A second fix at the same pole is silent.
  progress = tripProgress(plan, at(ride1[ride1.length - 1]), new Set(state.seen));
  step = advanceTrip(state, progress);
  state = step.state;
  assert(step.ring, 'no alert on reaching the alighting pole');
  assert(state.alertedLeg === legs[0], 'the alert was not recorded against its leg');
  step = advanceTrip(state, tripProgress(plan, at(ride1[ride1.length - 1]), new Set(state.seen)));
  assert(!step.ring, 'the alert rang twice for one leg');
  state = step.state;

  // The cursor is on the second bus now, and stays there on the walk to its pole.
  progress = tripProgress(plan, at(second.fromStop!), new Set(state.seen));
  assert(progress.segmentIndex === legs[1], `after alighting the cursor is on segment ${progress.segmentIndex}, not the second bus`);
  assert(tripPhase(state, progress) === 'waiting', 'arrived at the transfer pole and not waiting');
  step = advanceTrip(state, progress);
  assert(!step.ring, 'rang for the second bus while waiting for it');
  state = step.state;

  // Ride the second bus to the end: the last ride done is the walk to the door.
  for (const stop of ride2.slice(1)) {
    progress = tripProgress(plan, at(stop), new Set(state.seen));
    state = advanceTrip(state, progress).state;
  }
  assert(state.alertedLeg === legs[1], 'the second leg never rang');
  assert(tripPhase(state, progress) === 'walking', `phase is ${tripPhase(state, progress)} at the last pole`);
});

ok('the trip companion asks about a missed bus and answers with the timetable, or with the truth that there is none', () => {
  // A missed bus is asked, not guessed, three minutes past the printed departure; "no" reads
  // the next run of that line from that pole, and says so when there is none left today.
  const now = new Date(2026, 8, 8, 9, 0, 0);
  const plan = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to follow');
  const leg = plan.segments.findIndex((seg) => seg.type === 'bus');
  const state = startTrip(plan, null, null);
  const departure = legTimes(state, leg).departureMinutes;
  const clock = (minutes: number) => new Date(2026, 8, 8, Math.floor(minutes / 60), Math.round(minutes % 60), 0);

  assert(!shouldAskIfMissed(state, null, clock(departure)), 'asked at the printed departure itself');
  assert(!shouldAskIfMissed(state, null, clock(departure + MISSED_AFTER_MIN - 1)), 'asked inside the margin');
  assert(shouldAskIfMissed(state, null, clock(departure + MISSED_AFTER_MIN)), 'not asked once the margin has passed');

  // "Yes": riding, and the question is gone.
  const onIt = confirmBoarded(state, null);
  assert(tripPhase(onIt, null) === 'riding', 'said yes and still waiting');
  assert(!shouldAskIfMissed(onIt, null, clock(departure + 30)), 'still asking after a yes');

  // "No": the next run of the same line from the same pole, later than the one missed.
  const later = missedBus(state, null, clock(departure + MISSED_AFTER_MIN), 'gl');
  const next = legTimes(later, leg);
  assert(later.replacement && later.replacement.leg === leg, 'no replacement recorded');
  assert(!next.none, 'the timetable had a later run and the mode said there was none');
  assert(next.departureMinutes > departure, `the next run (${next.departureMinutes}) is not after the missed one (${departure})`);
  assert(['published', 'estimated'].includes(next.precision), 'the replacement departure carries no provenance');
  assert(!shouldAskIfMissed(later, null, clock(next.departureMinutes)), 'asking again before the new departure');
  assert(shouldAskIfMissed(later, null, clock(next.departureMinutes + MISSED_AFTER_MIN)), 'the new departure can never be missed');

  // Late enough that the line is done for the day: the answer is that it was the last.
  const lastDeparture = parseTimeToMinutes(plan.segments[leg].line!.lastDeparture);
  const gone = missedBus(state, null, clock(lastDeparture + 30), 'gl');
  assert(gone.replacement?.none, 'nothing left today and the mode offered a bus');
  assert(!shouldAskIfMissed(gone, null, clock(lastDeparture + 90)), 'asking about a bus it already said does not exist');
});

ok('"Vou nesta" rises to the top in the ten minutes before the bus, and a fix can only keep it down', () => {
  // The button is always there; ten minutes before the first bus it leads the answer, and
  // the planner's one-shot fix can only say "not at the pole", never "at the pole".
  const now = new Date(2026, 8, 8, 9, 0, 0);
  const plan = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to follow');
  const first = plan.segments.find((seg) => seg.type === 'bus')!;
  const departure = parseTimeToMinutes(first.departureTime!);
  const clock = (minutes: number) => new Date(2026, 8, 8, Math.floor(minutes / 60), Math.round(minutes % 60), 0);

  assert(!boardingIsNow(plan, clock(departure - BOARDING_SOON_MIN - 1)), 'prominent eleven minutes out');
  assert(boardingIsNow(plan, clock(departure - BOARDING_SOON_MIN)), 'not prominent ten minutes out');
  assert(boardingIsNow(plan, clock(departure)), 'not prominent at the printed minute');
  assert(!boardingIsNow(plan, clock(departure + 1)), 'prominent after the bus has gone');

  const pole = first.fromStop!;
  assert(boardingIsNow(plan, clock(departure - 2), { lat: pole.lat, lng: pole.lng }), 'at the pole, in time, and not prominent');
  assert(!boardingIsNow(plan, clock(departure - 2), { lat: pole.lat + 0.01, lng: pole.lng }), 'a kilometre away and prominent');
  assert(boardingIsNow(plan, clock(departure - 2), null), 'no fix, in time, and not prominent');
});

ok('a trip survives a reload with its lines put back by id, and refuses one it cannot rebuild', () => {
  // The trip lives in sessionStorage so a locked phone does not end it; lines travel as ids
  // and a copy naming a line the dataset no longer has is dropped, not half-rebuilt.
  const now = new Date(2026, 8, 8, 9, 0, 0);
  const plan = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to follow');
  const state = { ...startTrip(plan, { name: 'A', lat: 43, lng: -7.5 }, null), seen: ['s1'], boardedLeg: 1 };

  const text = packTrip(state);
  assert(!/"directions"/.test(text), 'the copy carries whole lines, not ids');
  const back = unpackTrip(text);
  assert(back, 'the copy could not be read back');
  assert(back.plan.segments.every((seg, i) => (seg.line?.id ?? null) === (plan.segments[i].line?.id ?? null)), 'lines did not come back by id');
  assert(back.plan.arrivalTime === plan.arrivalTime && back.seen[0] === 's1' && back.boardedLeg === 1, 'state lost on the way back');
  assert(back.origin?.name === 'A', 'the origin was lost');

  assert(unpackTrip('not json') === null, 'garbage came back as a trip');
  assert(unpackTrip(null) === null, 'nothing came back as a trip');
  assert(unpackTrip(text.replace(/"lineId":"[^"]+"/, '"lineId":"gone"')) === null, 'a line the dataset lacks was rebuilt');
});

ok('one alert radius, shared by the board and the trip companion', () => {
  // The board's alarm and the ride's alert are one alarm: one radius, one ring, one prompt.
  const radii: string[] = [];
  for (const full of sourcesUnder('src')) {
    for (const m of readFileSync(full, 'utf8').matchAll(/export const (\w*RADIUS_M) = (\d+)/g)) radii.push(`${m[1]}=${m[2]}`);
  }
  assert(radii.includes(`ALARM_RADIUS_M=${ALARM_RADIUS_M}`), 'the alarm radius moved out of stopAlarm.ts');
  assert(radii.filter((r) => r.startsWith('ALARM_RADIUS_M')).length === 1, `${radii.join(', ')}: the alert radius is declared more than once`);
  const companion = read('src/components/TripCompanionView.tsx');
  const hook = read('src/hooks/useTripCompanion.ts');
  assert(!/watchPosition\(/.test(companion + hook), 'the companion opened its own GPS watch instead of the shared one');
  assert(/subscribePosition\(/.test(hook) && /ringAlarm\(\)/.test(hook), 'the companion does not ring the board\'s alarm');
});

ok('the answer column spaces its blocks in one place', () => {
  // The gaps down the Ruta column ran 20, 0, 20, 20, 24 px because each block carried its
  // own margin; Líneas ran 10, 12, 16, 16, 20. The column owns the rhythm now, and a block
  // bringing its own margin back would look right alone and put the column out again.
  for (const file of ['RoutePlannerView.tsx', 'LinesView.tsx']) {
    const view = read(`src/components/${file}`);
    assert(/className="space-y-4 bg-bg/.test(view), `${file}: no card declares the rhythm its blocks depend on`);
    // mb-1, mb-2 and mb-1.5 sit inside a block -- a heading above its own content -- and
    // are left alone. These were only ever used between blocks.
    for (const stray of ['mb-4', 'mb-5', 'mt-6', 'mt-5', 'mt-4', 'mb-2.5']) {
      const found = new RegExp(`className="[^"]*\\b${stray.replace('.', '\\.')}\\b`).exec(view);
      assert(!found, `${file}: ${stray} is back — "${found?.[0]}" — the column spaces its blocks`);
    }
  }
});

ok('nobody is sent to stand at a pole, and the soonest arrival leads', () => {
  // Every plan used to start at `now`: asking at 09:00 for a 09:28 bus gave 21 minutes of
  // standing and five identical 50-minute journeys. With the departure free to slide, ranking
  // on duration then led with a 22-minute ride at 14:08; what is compared is when you get there.
  const PAIRS: [string, string][] = [
    ['Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)'],
    ['Praza Maior', 'Campus Universitario'],
    ['Polígono do Ceao', 'Rda. Muralla 56 (Sindicatos)'],
  ];
  for (const hour of [7, 9, 11, 14, 17, 20]) {
    const nowMinutes = hour * 60;
    for (const [from, to] of PAIRS) {
      const plans = planTrips(from, to, { now: new Date(2026, 8, 8, hour, 0, 0) });
      for (const plan of plans) {
        const departed = (parseTimeToMinutes(plan.departureTime) - nowMinutes + 1440) % 1440;
        assert(departed === plan.slackMinutes, `${from} -> ${to} at ${hour}: leaves ${plan.departureTime}, ${departed} min after the question, but claims ${plan.slackMinutes}`);

        // Standing before the first bus is capped at the margin that exists because these buses run
        // early; waits between buses are not: once in the system you cannot set off later.
        const firstBus = plan.segments.findIndex((seg) => seg.type === 'bus');
        if (firstBus > 0 && plan.segments[firstBus - 1].type === 'wait') {
          assert(
            plan.segments[firstBus - 1].durationMinutes <= TRANSFER_BUFFER_ESTIMATED_MIN,
            `${from} -> ${to} at ${hour}: ${plan.segments[firstBus - 1].durationMinutes} min standing at the pole before the first bus`,
          );
        }
      }

      // The top option gets there first, and only a walk that beats it by the documented margin
      // may arrive before it: bus times are interpolated, so three minutes is not a real lead.
      const reach = (p: (typeof plans)[number]) => p.slackMinutes + p.durationMinutes;
      const leader = plans[0];
      for (const plan of plans) {
        if (reach(plan) >= reach(leader)) continue;
        const isWalk = !plan.segments.some((seg) => seg.type === 'bus');
        assert(
          isWalk && reach(leader) - reach(plan) < WALK_MUST_BEAT_BUS_BY_MIN,
          `${from} -> ${to} at ${hour}: the list leads with ${leader.departureTime} -> ${leader.arrivalTime}, ` +
            `but ${plan.departureTime} -> ${plan.arrivalTime} gets there ${reach(leader) - reach(plan)} min sooner`,
        );
      }
    }
  }
});

ok('the itinerary prose does not repeat the figures its own row already shows', () => {
  // Each step's header already shows the clock, the duration and the distance; the sentence
  // used to repeat all three, and a figure printed twice can disagree with itself. No stop
  // name contains a clock and none is followed by a metre word, so the rules are safe.
  const now = new Date(2026, 7, 20, 9, 30);
  for (const lang of LANGS) {
    for (const plan of planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now, lang })) {
      for (const seg of plan.segments) {
        // The bus step draws its own fields and never renders `instruction`.
        if (seg.type === 'bus') continue;
        const clock = seg.instruction.match(/\d{1,2}:\d{2}/);
        assert(!clock, `${lang}: "${clock?.[0]}" is in the header already — "${seg.instruction}"`);
        if (seg.walkMeters) {
          const metres = new RegExp(`\\b${seg.walkMeters}\\s*(m\\b|metros|metres)`);
          assert(!metres.test(seg.instruction), `${lang}: ${seg.walkMeters} m is in the header already — "${seg.instruction}"`);
        }
      }
    }
  }
});

ok('no translated key is left with nothing reading it', () => {
  // A dictionary rots the other way round: the UI moves on and fourteen keys outlived their
  // screens. Two access shapes count: `t.<ns>.<key>`, and `translations(lang).<ns>` then `t.<key>`.
  const dictionary = read('src/i18n/gl.ts');

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

  const sources = sourcesUnder('src')
    .filter((file) => !file.replace(/\\/g, '/').includes('/i18n/'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  // A word boundary at the end: `includes` let `yourPositionAccurate` shield a dead
  // `yourPosition`. Both parts are `[a-zA-Z]+`, so no regex metacharacter gets in.
  const used = (haystack: string, namespace: string, key: string) =>
    new RegExp(`\\.${namespace}\\.${key}\\b`).test(haystack) ||
    new RegExp(`\\bt\\.${key}\\b`).test(haystack);

  assert(!used('t.map.yourPositionAccurate(3)', 'map', 'yourPosition'), 'a key that only appears as another key’s prefix is still counting as used');

  const dead = keys.filter(({ ns: namespace, key }) => !used(sources, namespace, key));

  assert(dead.length === 0, `${dead.length} translated ${dead.length === 1 ? 'key has' : 'keys have'} nothing reading them: ` + dead.map((d) => `${d.ns}.${d.key}`).join(', '));
});

console.log('\nservice notices');

await okAsync('an unreachable operator page is never reported as "all normal"', async () => {
  // A failed fetch came back as `operational_normal`, so one unreachable minute during the
  // hourly job replaced real notices with a claim nobody had checked.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
  try {
    const result = await syncOfficialAlerts(true);
    assert(result.status === 'unreachable', `a failed fetch reported "${result.status}" instead of "unreachable"`);
    assert(result.alerts.length === 0, 'a failed fetch invented notices');
  } finally {
    globalThis.fetch = realFetch;
  }
});

await okAsync('a failed read of the operator is not held for half an hour', async () => {
  // A failure was cached like an answer: one timeout told every reader for thirty minutes
  // that the page could not be read. A failure lasts the outbound cooldown; an answer, the half hour.
  const realFetch = globalThis.fetch;
  const down = (() => Promise.reject(new Error('offline'))) as typeof fetch;
  const up = (async () => new Response('<html><body></body></html>', { status: 200 })) as typeof fetch;
  // An hour past whatever the previous check left in the module's cache, so it is expired
  // whichever way it went.
  const t0 = Date.now() + 60 * 60_000;
  try {
    globalThis.fetch = down;
    assert((await syncOfficialAlerts(false, t0)).status === 'unreachable', 'the operator was down and the sync did not say so');
    globalThis.fetch = up;
    assert((await syncOfficialAlerts(false, t0 + 30_000)).status === 'unreachable', 'a failure was retried inside the outbound cooldown');
    assert((await syncOfficialAlerts(false, t0 + 61_000)).status !== 'unreachable', 'a minute-old failure was still being served');
    globalThis.fetch = down;
    assert((await syncOfficialAlerts(false, t0 + 122_000)).status !== 'unreachable', 'a minute-old answer was thrown away for a failure');
  } finally {
    globalThis.fetch = realFetch;
  }
});

ok('no view renders Galician or Spanish text of its own', () => {
  // HORARIO OFICIAL sat in the markup as a literal, so an English reader saw it too, and no
  // grep over the dictionary could see it. Place names are exempt: they arrive as expressions.
  const marked = /(Liñas?|Líneas?|Paradas|Saída|Chegada|Frecuencia|Avisos|Tarifas|Buscar|Amosar|Ocultar|Espera|Percorrido|Traxecto|Trayecto|Marquesiña|Marquesina|Escanear|Aparencia|Apariencia|localización|Camiñar|Conexión|HORARIO OFICIAL|ESTIMADO)/;

  const offenders: string[] = [];
  for (const file of sourcesUnder('src')) {
    // The dictionaries are supposed to be full of Galician and Spanish.
    if (!/\.tsx?$/.test(file) || file.split(sep).includes('i18n')) continue;
    // So is seo.ts: the structured data is build-time metadata in one language, not an
    // interface string that follows the reader's choice.
    if (file.endsWith(`${sep}seo.ts`)) continue;
    const source = readFileSync(file, 'utf8');
    source.split(/\r?\n/).forEach((line, i) => {
      // A trailing comment is never rendered; only what is left of the code matters.
      const text = line.replace(/\/\/.*$/, '').trim();
      if (!text || text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return;
      // Template literals count too: the map builds tooltips as HTML strings and two labels hid
      // there. A JSX text line is words, not an expression, attribute or import.
      const inTemplate = /`[^`]*[A-Za-zÁÉÍÓÚÑ]/.test(text);
      // Skipping every line with an '=' let a Galician placeholder through inside value={...},
      // so quoted strings are checked on their own; class names never match a Galician word.
      const isJsxText = !/^[<{}/]|=|import |const |type |interface /.test(text);
      const quoted = (text.match(/'[^']*'|"[^"]*"/g) ?? []).join(' ');
      if (!marked.test(isJsxText || inTemplate ? text : quoted)) return;
      offenders.push(`${file.split(/[\\/]/).pop()}:${i + 1}  ${text.slice(0, 54)}`);
    });
  }

  assert(offenders.length === 0, `text typed straight into the markup instead of coming from the dictionary:\n  ` + offenders.join('\n  '));
});

console.log('\nuntested corners');

ok('a service window that crosses midnight is not read as finished', () => {
  // A night line running 22:30 to 06:30 has a window ending before it starts, and the naive
  // comparison called it closed all day, which is what the "no service" banner reads.
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
    assert(nearby[i].walkMeters >= nearby[i - 1].walkMeters, `stop ${i} is closer than the one before it`);
  }

  const straight = getDistanceMeters(cathedral.lat, cathedral.lng, nearby[0].lat, nearby[0].lng);
  assert(nearby[0].walkMeters >= straight, `a walk of ${nearby[0].walkMeters} m is shorter than the ${Math.round(straight)} m straight line`);
});

ok('the walked hops of a plan are real walks, and the last one reaches the destination', () => {
  // walkHopsOf feeds the router: at most one hop per bus leg plus the last, and fewer is
  // right when the origin is the boarding stop or a change happens at the same pole.
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
  assert(!last || (last[1][0] === destination!.lat && last[1][1] === destination!.lng), 'the last walked hop does not end at the destination');
});

await okAsync('a walking route asks nobody for anything', async () => {
  // This used to guard a rate limit for a third-party router that received the reader's own
  // GPS fix. The app routes on the device now; the regression guarded is somebody reaching
  // for fetch again, and the file defended is PRIVACY.md.
  const realFetch = globalThis.fetch;
  const reached: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    reached.push(String(input));
    throw new Error('the walking router made a network request');
  }) as typeof fetch;

  try {
    const muralla = BUS_STOPS.find((s) => s.name.startsWith('Rda. Muralla 56'))!;
    const ponte = BUS_STOPS.find((s) => s.name.startsWith('A Ponte (cruce'))!;
    const walk = await fetchWalkingPath([muralla.lat, muralla.lng], [ponte.lat, ponte.lng]);
    assert(walk, 'no walking route between two stops in the middle of Lugo');
    assert(walk!.meters > 0 && walk!.minutes > 0, 'a route of no distance and no time');
    assert(!reached.length, `the walking router called out to ${reached.join(', ')}`);

    // An aborted hop throws rather than resolving to null. The effect that calls this
    // aborts on every plan change, and a null would be read as "there is no route here".
    const aborted = new AbortController();
    aborted.abort();
    let threw = '';
    await fetchWalkingPath([muralla.lat, muralla.lng], [ponte.lat, ponte.lng], aborted.signal).catch((e) => {
      threw = (e as Error).name;
    });
    assert(threw === 'AbortError', `an aborted hop settled as "${threw || 'a value'}" instead of throwing`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

ok('the published-stop count the board quotes matches the data', () => {
  // The board explains "the operator publishes times at N of the M stops". Those two
  // numbers used to be prose; they are counted now, and this is what keeps them true.
  const { published, total } = timingPointStopCount();
  assert(total === BUS_STOPS.length, `quoted ${total} stops, the dataset has ${BUS_STOPS.length}`);
  assert(published > 0 && published < total, `${published} published of ${total} is not a believable split`);
});

ok('no colour is written straight into a class name', () => {
  // The theme lives in tokens; a sweep took 707 fixed-palette classes to zero and three
  // crept back, invisible to a sweep that only knew bg- and text-. This is the ratchet.
  const FAMILY = /bg|text|border|ring|fill|stroke|from|via|to|divide|outline|shadow|placeholder/;
  const HUE = /slate|gray|zinc|neutral|stone|blue|sky|indigo|amber|yellow|orange|green|emerald|teal|red|rose|pink|purple|violet/;
  const PALETTE = new RegExp(String.raw`\b(?:${FAMILY.source})(?::[a-z-]+)?-(?:${HUE.source})-\d{2,3}\b`, 'g');

  const offenders: string[] = [];
  for (const file of sourcesUnder('src')) {
    if (!/\.tsx?$/.test(file)) continue;
    for (const hit of readFileSync(file, 'utf8').match(PALETTE) ?? []) {
      offenders.push(`${file.split(/[\/]/).pop()}  ${hit}`);
    }
  }

  assert(offenders.length === 0, `${offenders.length} fixed palette classes, which will not follow the theme: ` + [...new Set(offenders)].join(', '));
});

ok('a saved snapshot stops speaking for the present once it is old', () => {
  // On static hosting the notices always come from the committed snapshot, and a stale one
  // kept asserting "running normally" in the present tense.
  const now = new Date(2026, 7, 25, 12, 0);
  const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();

  assert(!isSnapshotStale(null, now), 'a live answer is not a snapshot');
  assert(!isSnapshotStale(iso(1), now), 'an hour-old snapshot should still count');
  assert(!isSnapshotStale(iso(5), now), 'five hours is inside the refresh window');
  assert(isSnapshotStale(iso(7), now), 'seven hours should read as stale');
  assert(isSnapshotStale(iso(24 * 5), now), 'a five-day-old snapshot is not evidence about now');
  assert(isSnapshotStale('not a date', now), 'an unreadable date is not a fresh one');
});

ok('the notices snapshot is a file beside the page, not part of the bundle', () => {
  // The scheduled deploy refreshes the snapshot before every build; imported, its timestamp
  // renamed the entry chunk and the five that import from it, half a megabyte gzipped, five
  // to seven times a day under pages that were open. As a file under public/ it keeps its
  // name, a refresh moves 1.4 KB, and the service worker precaches it for the Avisos screen offline.
  const snapshot = JSON.parse(read('public/alerts.json'));
  assert(Array.isArray(snapshot.alerts) && typeof snapshot.fetchedAt === 'string', 'public/alerts.json is not a dated snapshot');
  for (const file of sourcesUnder('src')) {
    assert(!/from\s+['"][^'"]*alerts\.json['"]/.test(readFileSync(file, 'utf8')), `${relative(file)} imports the notices snapshot, which puts its timestamp back into the bundle`);
  }
  assert(/fetch\(`\$\{import\.meta\.env\.BASE_URL\}alerts\.json`\)/.test(read('src/hooks/useServiceAlerts.ts')), 'the hook no longer fetches the snapshot from beside the page');
  assert(/at\('public\/alerts\.json'\)/.test(read('tools/fetchAlerts.ts')), 'fetchAlerts writes the snapshot somewhere the page cannot fetch it from');
  assert(/globPatterns: \['\*\*\/\*\.\{[^}]*json[^}]*\}'\]/.test(read('vite.config.ts')), 'the service worker no longer precaches json, so the snapshot is gone offline');
});

await okAsync('the capped read returns every byte under the cap, whatever the chunking', async () => {
  // This lived in checkParsersUnchanged.ts, which fetched two live pages twice on every push
  // to prove it. A round trip is a poor way to test a decoder, and it could not test the one
  // thing that goes wrong in a streaming read: a multi-byte character split across chunks,
  // which turns "Muiño" into "Mui\ufffd\ufffdo" without {stream: true}.
  const text = ('Praza Maior — Muiño do Rato, 0,64 € 🚌 ' + 'ñ'.repeat(50) + '\n').repeat(400);
  const bytes = new TextEncoder().encode(text);
  const chunked = (size: number) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.subarray(i, i + size));
          controller.close();
        },
      }),
    );
  for (const size of [1, 7, 1024]) assert((await readCapped(chunked(size))) === text, `a body read in ${size}-byte chunks came back changed`);

  // The ceiling: cut, and cut to the cap rather than to some multiple of the chunk.
  const big = 'y'.repeat(MAX_BODY_BYTES * 3);
  const one = await readCapped(new Response(big));
  assert(one.length < big.length, 'a body three times the cap came back whole');
  assert(one.length === MAX_BODY_BYTES, `the read stopped at ${one.length} bytes, not the cap of ${MAX_BODY_BYTES}`);
  const many = await readCapped(
    new Response(
      new ReadableStream({
        start(controller) {
          const chunk = new TextEncoder().encode('y'.repeat(65536));
          for (let i = 0; i < 24; i++) controller.enqueue(chunk);
          controller.close();
        },
      }),
    ),
  );
  assert(many.length === MAX_BODY_BYTES, `chunked, the read stopped at ${many.length} bytes, not the cap`);
});

ok('the QR count on the map is the number of poles that have one', () => {
  // The map header counted every stop as having a QR code while the operator publishes a
  // token for 271; the count and the claim have to be the same size.
  const withToken = BUS_STOPS.filter((s) => poleCode(s)).length;
  assert(withToken > 0, "no stop has a QR token at all");
  assert(withToken < BUS_STOPS.length, "every stop has a token, so this test no longer proves anything");
  for (const s of BUS_STOPS) {
    const code = poleCode(s);
    assert(code === null || code === s.officialToken, `${s.name}: code is not the token`);
  }
});

ok('a pole with no coordinates is recovered only when its token says which pole it is', () => {
  // Twelve listings arrive with no coordinates; dropping all twelve cost a fourteen-line pole.
  // One is recovered because its live-panel token names a located pole; the others cannot be
  // placed from this source. Pinned so a thirteenth is noticed.
  const raw = JSON.parse(read('data/official-raw.json'));
  const listings = raw.stops as { ps: number; token?: string; coords?: unknown }[];
  assert(listings.length === 1198, `the operator now lists ${listings.length} poles, not 1198`);

  const placed = new Map(BUS_STOPS.filter((s) => s.officialToken).map((s) => [s.officialToken!, s]));
  const unplaced = listings.filter((s) => !Array.isArray(s.coords));
  assert(unplaced.length === 12, `${unplaced.length} listings have no coordinates, not 12`);

  const recovered = unplaced.filter((s) => s.token && placed.has(s.token));
  assert(recovered.length === 1, `${recovered.length} of them are recoverable by token, not 1`);

  // And the one that is recoverable is actually on the stop it belongs to, by its own
  // operator number — the whole point of recovering it.
  for (const listing of recovered) {
    const stop = placed.get(listing.token!)!;
    assert(stop.officialIds?.includes(listing.ps), `${stop.name} does not carry the recovered operator number ${listing.ps}`);
  }

  // The eleven that stay out must stay out: none of them may have reached a stop.
  const numbers = new Set(BUS_STOPS.flatMap((s) => s.officialIds ?? []));
  for (const listing of unplaced) {
    if (recovered.includes(listing)) continue;
    assert(!numbers.has(listing.ps), `${listing.ps} was placed with neither coordinates nor a known token`);
  }
});

ok('a name the operator still prints is still findable after merging', () => {
  // A pole listed twice by the operator, once with a token and once under another label, is
  // one stop; merging cost the other label its entry until it was kept as an alias.
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
  // Nine poles shipped as eighteen stops: same name, same coordinates, two operator ids.
  const seen = new Map<string, string>();
  for (const s of BUS_STOPS) {
    const key = `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    const other = seen.get(key);
    assert(!other, `${s.name} and ${other} are published at the same point`);
    seen.set(key, s.name);
  }
});

ok('a route drawn from a car route says so', () => {
  // Three directions are built from a car's route between stops, which detours where a bus
  // does not; the line page says so. A rebuild silently turning more into car routes shows here.
  const bySource = new Map<string, string[]>();
  for (const line of BUS_LINES) {
    for (const d of line.directions) {
      const src = d.geometrySource ?? 'missing';
      bySource.set(src, [...(bySource.get(src) ?? []), `${line.number} ${d.name}`]);
    }
  }
  assert(!bySource.has('missing'), 'a direction is drawn with no record of where the shape came from');
  const approximate = [...(bySource.get('osrm') ?? []), ...(bySource.get('straight') ?? [])];
  assert(approximate.length <= 3, `${approximate.length} directions are drawn from something other than a survey: ${approximate.join(', ')}`);
});

ok('a trip never rides a bus to reach a stop it could have walked to', () => {
  // Fonte dos Ranchos to HULA led with a one-stop ride whose only purpose was reaching a stop
  // a seven-minute walk away, because the ten nearest candidates were all on one corridor.
  // Pinned: the one-bus trip exists, and of two equal plans the simpler leads. Fixed midday.
  const NOON = { now: new Date(2026, 7, 19, 12, 34, 0) };
  const plans = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', NOON);
  assert(plans.length > 0, 'no plan at all from Fonte dos Ranchos to HULA at midday');

  const legs = (p: (typeof plans)[number]) => p.segments.filter((s) => s.type === 'bus');
  const head = plans[0];
  assert(legs(head).length <= 1, `the headline changes bus ${legs(head).length - 1} time(s): ${legs(head).map((s) => `${s.line?.number} for ${s.stopsCount} stop(s)`).join(' then ')}`);

  // No plan anywhere may ask you to ride a single stop. Across the network the best
  // such ride saved three minutes against walking, which a late bus erases.
  const sample = BUS_STOPS.filter((_, i) => i % 47 === 0).slice(0, 8);
  for (const from of sample) {
    for (const to of sample) {
      if (from.id === to.id) continue;
      for (const p of planTrips(from.name, to.name, NOON)) {
        const oneStop = legs(p).find((s) => (s.stopsCount ?? 9) <= 1);
        if (oneStop) {
          assert(false, `${from.name} -> ${to.name} offers line ${oneStop.line?.number} for a single stop`);
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
      // Both sides must ride something: a walk that ties with a bus deliberately loses, so it is
      // not a counter-example to "do not change bus when you need not".
      const simpler = options.find(
        (p) =>
          p.durationMinutes === best.durationMinutes &&
          legs(p).length > 0 &&
          legs(p).length < legs(best).length,
      );
      // Built inside the branch: an assert message is an argument, so it is evaluated
      // whether or not the assertion fails, and `simpler` is usually undefined.
      if (simpler) {
        assert(false, `${from.name} -> ${to.name}: leads with ${legs(best).length} buses in ${best.durationMinutes} min, ` + `when ${legs(simpler).length} would do it in the same time`);
      }
    }
  }
});

ok('the content security policy still refuses what it was written to refuse', () => {
  // A CSP erodes one exception at a time. script-src is 'self' plus exactly one SHA-256, the
  // inlined theme script; a hash admits one byte sequence and what it is vulnerable to is
  // drift, so the digest is recomputed from the script actually inlined in the built page.
  const script = CSP_HEADER.match(/script-src ([^;]+)/)?.[1] ?? '';
  const hashes = [...script.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
  assert(hashes.length === 1, `script-src carries ${hashes.length} hashes, not exactly 1: "${script.trim()}"`);
  assert(script.trim() === `'self' '${hashes[0]}'`, `script-src is "${script.trim()}", not 'self' plus exactly one hash`);
  assert(hashes[0] === THEME_INIT_HASH, 'the policy hash is not the one computed from the theme script');
  // A hash and `'unsafe-inline'` are opposite things, and a browser that sees both ignores
  // the second; saying so by name makes the failure read as what it is.
  assert(!/unsafe-inline/.test(script), "script-src has taken 'unsafe-inline', which is not what a hash is for");
  assert(THEME_INIT_HASH === `sha256-${createHash('sha256').update(THEME_INIT_SOURCE, 'utf8').digest('base64')}`, 'THEME_INIT_HASH is not the digest of THEME_INIT_SOURCE');

  // And against the page that ships, when there is one to look at. CI runs the suite
  // before the build, so a missing dist is skipped rather than failed.
  const built = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');
  if (existsSync(built)) {
    const html = readFileSync(built, 'utf8');
    // Case-insensitive not because the build would ever write <SCRIPT>, but because a
    // tag match that is not is what CodeQL flags, and it costs a flag to be right.
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    assert(inline.length === 1, `the built page has ${inline.length} inline scripts, not exactly 1`);
    const digest = `sha256-${createHash('sha256').update(inline[0], 'utf8').digest('base64')}`;
    assert(digest === hashes[0], `the built page inlines a script whose digest is ${digest}, which the policy does not allow`);
    assert(html.includes(`'${hashes[0]}'`), 'the meta policy in the built page does not carry the hash of its own inline script');
  }

  // The map renderer runs a worker bundled as a same-origin module; handed a cross-origin URL
  // it wraps it in a blob, and the fix is to make the bundler emit it again, not `blob:` here.
  const worker = CSP_HEADER.match(/worker-src ([^;]+)/)?.[1] ?? '';
  assert(worker.trim() === "'self'", `worker-src is "${worker.trim()}", not just 'self'`);
  assert(!/unsafe-eval/.test(CSP_HEADER), 'unsafe-eval crept into the policy');
  assert(/object-src 'none'/.test(CSP_HEADER), "object-src is no longer 'none'");
  assert(/frame-ancestors 'none'/.test(CSP_HEADER), 'the header lost frame-ancestors');
  // The meta form silently ignores frame-ancestors and logs an error for every visitor.
  assert(!/frame-ancestors/.test(CSP_META), 'frame-ancestors is back in the meta policy');

  // Every remote origin the policy allows should be one the app actually talks to.
  const allowed = [...CSP_HEADER.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]);
  const expected = [
    'https://tiles.openfreemap.org',
    'https://tile.openstreetmap.org',
  ];
  for (const origin of allowed) {
    assert(expected.includes(origin), `${origin} is allowed by the policy but nothing uses it`);
  }
});

ok('dark is the default, and only a choice is remembered', () => {
  // Read standing at a pole after dark: the hook and the pre-paint script have to agree on
  // dark by default, and the script is inlined because as a file it cost a round trip.
  const hook = read('src/hooks/useTheme.ts');
  const html = read('index.html');

  assert(/\? stored : 'dark'/.test(hook), 'useTheme no longer falls back to dark');
  assert(/next === 'dark' \? null : next/.test(hook), 'the default is being written to storage, so clearing site data would not return to it');
  assert(/class="dark"/.test(html), 'index.html no longer ships the dark class');

  // Both read the same key: the hook imports the one themeInit.ts names, and nothing
  // catches it if either stops.
  assert(/THEME_STORAGE_KEY/.test(hook) && !/urbanos-lugo-theme/.test(hook), 'useTheme spells its own storage key instead of importing the one the pre-paint script reads');
  assert(THEME_INIT_SOURCE.includes(`'${THEME_STORAGE_KEY}'`), `the pre-paint theme script does not read ${THEME_STORAGE_KEY}`);

  // The script has to survive into the page it is meant to run in, and it only gets there
  // if the build's replacement still finds its tag.
  const built = join(root, 'dist', 'index.html');
  if (!existsSync(built)) return;
  const page = readFileSync(built, 'utf8');
  assert(page.includes(THEME_INIT_SOURCE), 'the built page does not carry the pre-paint theme script');
  assert(!/src="[^"]*theme-init\.js"/.test(page), 'the built page still fetches the theme script as a file');
});

ok('the repository URL is written in one place', () => {
  // Two things break quietly on a rename: the "wrong place" link and the User-Agent buslugo
  // sees. Prose may spell the URL out; shipped code may not.
  const offenders = sourcesUnder('src')
    .filter((full) => !full.endsWith(join('src', 'project.ts')) && /github\.com\/braisbrg/.test(readFileSync(full, 'utf8')))
    .map(relative);
  assert(offenders.length === 0, `hardcodes the repository URL instead of importing REPO_URL: ${offenders.join(', ')}`);
  assert(REPO_URL.startsWith('https://github.com/'), 'REPO_URL is not a GitHub URL');
});

ok('the install-script setting uses the name the pinned pnpm reads', () => {
  // Wrong twice, and both times it failed at install: pnpm 9 read the setting from
  // package.json, 10 from pnpm-workspace.yaml as `onlyBuiltDependencies`, 11 as `allowBuilds`,
  // and an older name simply stops the install. The name has to match the pinned major.
  const pkg = JSON.parse(read('package.json'));

  const pinned = String(pkg.packageManager ?? '');
  assert(/^pnpm@\d/.test(pinned), `packageManager is "${pinned}", not a pinned pnpm`);
  const major = Number(pinned.slice('pnpm@'.length).split('.')[0]);

  const workspaceFile = join(root, 'pnpm-workspace.yaml');
  const workspace = existsSync(workspaceFile) ? readFileSync(workspaceFile, 'utf8') : '';

  /** Every package named, with what was decided about it. */
  const decided = new Map<string, string>();
  if (major >= 11) {
    const block = workspace.match(/^allowBuilds:\n((?:[ \t]+\S+:.*\n)+)/m);
    assert(block, 'pnpm 11 reads `allowBuilds` from pnpm-workspace.yaml and it is not there, so the ' + 'install stops on any dependency that has a build script');
    for (const m of block![1].matchAll(/^[ \t]+(\S+):[ \t]*(\S+)/gm)) decided.set(m[1], m[2]);
  } else if (major === 10) {
    const block = workspace.match(/^onlyBuiltDependencies:\n((?:\s*-\s*\S+\n)+)/m);
    assert(block, 'pnpm 10 reads `onlyBuiltDependencies` from pnpm-workspace.yaml and it is not there');
    for (const m of block![1].matchAll(/-\s*(\S+)/g)) decided.set(m[1], 'true');
  } else {
    const list = pkg.pnpm?.onlyBuiltDependencies;
    assert(Array.isArray(list), 'pnpm 9 reads onlyBuiltDependencies from package.json and it is missing');
    for (const name of list) decided.set(name, 'true');
  }

  // Every package with a build script must be named. esbuild is the only one, and the answer
  // is `false`: since 0.25 its binary arrives as an optional dependency.
  assert(decided.has('esbuild'), 'esbuild has an install script and no decision recorded for it');
  for (const [name, value] of decided) {
    assert(value === 'true' || value === 'false', `${name} is set to "${value}"; pnpm writes that placeholder itself and then fails the install`);
  }
  assert(decided.size <= 3, `${decided.size} packages named here; that list should stay short enough to read`);

  // And the settings live in exactly one place: leaving the old copy behind is how the
  // two disagree, and the one pnpm no longer reads is the one that looks reassuring.
  if (major >= 10) {
    assert(pkg.pnpm === undefined, 'package.json still has a "pnpm" field, which this pnpm ignores — move it or drop it');
  }
});

ok('the policy is not sent in development, where it serves a blank page', () => {
  // The CSP from the dev server blocked Vite's inline preamble and HMR socket: `pnpm dev`
  // rendered nothing. The header still goes out for `pnpm start`.
  const server = read('server.ts');

  const line = server.split('\n').find((l) => l.includes("setHeader('Content-Security-Policy'"));
  assert(line, 'the server no longer sends a Content-Security-Policy at all');
  assert(/if \(!isDev\)/.test(line!), `the CSP header is sent unconditionally, which breaks \`pnpm dev\`: ${line!.trim()}`);

  // The page carries its own copy for GitHub Pages, and that one must not reach dev
  // either -- it is injected when building, never written into the source HTML.
  const html = read('index.html');
  assert(!/Content-Security-Policy/.test(html), 'index.html has a CSP meta tag again; it applies to `vite dev` and blocks HMR');
  const vite = read('vite.config.ts');
  assert(/apply: 'build'/.test(vite), 'the CSP injector no longer limits itself to builds');
});

ok('no comment quotes a stop count the dataset no longer has', () => {
  // Merging nine duplicated poles moved the total from 429 to 417 and left five comments
  // asserting the old one. Only counts about stops in src/ are checked; "used to" is history.
  const total = BUS_STOPS.length;
  const wrong: string[] = [];
  for (const full of sourcesUnder('src')) {
    // Split on either ending: a stray carriage return broke "used to" across the join below.
    const lines = readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // The marker that makes a quotation history can sit a line or two above the number, with
      // "used to" split across the wrap and a comment asterisk between the words.
      const sentence = lines
        .slice(Math.max(0, i - 2), i + 1)
        .map((l) => l.replace(/^\s*(\/\/|\*|\/\*\*?)\s?/, ''))
        .join(' ');
      if (/used to|antes|adoitaba|read "/.test(sentence)) return;
      for (const m of [...line.matchAll(/\b(\d{3})\s+(stops|paradas|dots|poles|postes)\b/g), ...line.matchAll(/\bof the (\d{3})\b/g)]) {
        if (Number(m[1]) !== total) wrong.push(`${relative(full)}:${i + 1} says "${m[0]}", the dataset has ${total}`);
      }
    });
  }
  assert(wrong.length === 0, wrong.join('; '));
});

ok('a device on the wrong timezone is told, and one on the right one is not', () => {
  // Every hour on the board is the device's and every hour in the timetable is Lugo's; a
  // device an hour out shifts the whole board with nothing on screen admitting it.
  const summer = new Date(2026, 6, 15, 12, 0, 0); // July: Lugo is on CEST
  const winter = new Date(2026, 0, 15, 12, 0, 0); // January: CET
  const original = process.env.TZ;

  const driftIn = (zone: string, at: Date) => {
    process.env.TZ = zone;
    return clockDriftFromTimetable(new Date(at.getTime()));
  };

  try {
    // Half-hour zones and the southern hemisphere are where a naive hours-only
    // comparison falls over, so both are here.
    const cases: [string, Date, number][] = [
      ['Europe/Madrid', summer, 0],
      ['Europe/Madrid', winter, 0],
      ['Europe/London', summer, -60],
      ['UTC', summer, -120],
      ['Asia/Kolkata', summer, 210],
      ['Australia/Sydney', summer, 480],
    ];
    for (const [zone, at, expected] of cases) {
      const got = driftIn(zone, at);
      assert(got === expected, `${zone} in ${at.getMonth() + 1}/2026: drift ${got} min, expected ${expected}`);
    }
  } finally {
    process.env.TZ = original;
  }
});

ok('a code that names no stop resolves to nothing, not to somebody else', () => {
  // findStop fell back to a ranked search, so "../", ".", "-1" and "NaN" each produced a
  // real board for the wrong pole. Every caller resolves an identifier; none is searching.
  const nonsense = ['../', '..', '/', '.', '', '   ', 'ZZZZ', '0', '-1', 'NaN', 'null', '%', '999999'];
  for (const q of nonsense) {
    const hit = findStop(q);
    assert(!hit, `"${q}" resolves to ${hit?.name}`);
  }

  // A fragment of a real name is still a search, not an identifier.
  const first = BUS_STOPS[0];
  assert(!findStop(first.name.slice(0, 5)), `a partial name resolves: "${first.name.slice(0, 5)}"`);

  // And nothing real may have been lost: every id, code, operator number and name.
  for (const stop of BUS_STOPS) {
    assert(findStop(stop.id)?.id === stop.id, `id ${stop.id} no longer resolves`);
    if (stop.code) assert(findStop(stop.code)?.id === stop.id, `code ${stop.code} no longer resolves`);
    // Three names belong to two poles each, so a name resolves to one of them; a reader who
    // needs a specific pole has its code.
    assert(findStop(stop.name)?.name === stop.name, `name "${stop.name}" no longer resolves`);
    for (const official of stop.officialIds ?? []) {
      assert(findStop(String(official)), `operator number ${official} no longer resolves`);
    }
  }
});

ok('a query with nothing left in it matches nothing', () => {
  // Normalising strips punctuation, so "." and "../" reached the matchers as the empty string,
  // which prefix-matches every name at 800 points. The guard fires only on an empty query;
  // everything a person types is scored as before, which the second half checks.
  const empties = ['.', '..', '../', '/', '_', '()', '   ', '...', ','];
  for (const q of empties) {
    assert(normalizeText(q) === '', `"${q}" does not normalise to empty; wrong test case`);
  }
  for (const q of empties) {
    const scored = BUS_STOPS.filter((s) => calculateRelevanceScore(s.name, s.code, s.id, q, s.zone) > 0);
    assert(scored.length === 0, `"${q}" scores against ${scored.length} stops, e.g. ${scored[0]?.name}`);
    const matched = BUS_STOPS.filter((s) => matchesQuery(s.name, q));
    assert(matched.length === 0, `"${q}" word-matches ${matched.length} stops, e.g. ${matched[0]?.name}`);
  }

  // Real searches, unchanged. Accents in both directions and the abbreviation the
  // operator prints ("Rda.") against the word a person types ("Ronda").
  const finds = (q: string) =>
    BUS_STOPS.filter((s) => calculateRelevanceScore(s.name, s.code, s.id, q, s.zone) > 0).length;
  for (const q of ['mur', 'muralla', 'Gándaras', 'gandaras', 'Ronda Muralla', 'termas', 'pedrei']) {
    assert(finds(q) > 0, `"${q}" no longer finds anything`);
  }
});

ok('no source file mixes its line endings', () => {
  // This repository used to check out CRLF on Windows, and one bare "\n" among hundreds of
  // CRLFs is invisible in an editor and a whole-file diff later; it also broke a check here.
  const mixed: string[] = [];
  for (const full of [...listSourceFiles(join(root, 'src'), /\.(ts|tsx|css|html)$/), ...listSourceFiles(join(root, 'tools'), /\.(ts|tsx|css|html)$/)]) {
    const text = readFileSync(full, 'utf8');
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
    if (crlf > 0 && lf > 0) mixed.push(`${relative(full)} (${crlf} CRLF, ${lf} LF)`);
  }
  assert(mixed.length === 0, `mixed line endings in ${mixed.join(', ')}`);
});

ok('the search-engine tags are omitted rather than guessed', () => {
  // A canonical or a sitemap with the wrong origin sends crawlers to pages that do not exist,
  // so a build without SITE_URL emits none, and anything but a plain https origin is no URL.
  for (const bad of [undefined, '', 'not a url', 'ftp://example.com', 'http://example.com', 'javascript:alert(1)']) {
    assert(siteUrl(bad) === null, `"${bad}" was accepted as a site URL`);
  }
  assert(siteUrl('http://localhost:3001') === 'http://localhost:3001/', 'localhost is refused, so a local build cannot be checked');
  assert(siteUrl('https://braisbrg.github.io/urbanos-lugo') === 'https://braisbrg.github.io/urbanos-lugo/', 'the trailing slash is not added, so every generated URL would be joined wrong');
});

ok('the structured data does not pass this off as the operator', () => {
  // A crawler reading the structured data must not come away thinking the operator or the
  // council publishes this; the machine-readable copy is the one nobody looks at.
  const site = 'https://example.org/';
  const data = JSON.parse(structuredData(site));

  assert(data['@type'] === 'WebApplication', `@type is ${data['@type']}`);
  assert(data.url === site, 'the url field does not match the site');
  assert(/non oficial/i.test(String(data.disambiguatingDescription)), 'the structured data no longer says the project is unofficial');
  assert(data.isAccessibleForFree === true, 'it is free and should say so');

  // robots.txt has to point at a sitemap that is actually emitted beside it.
  const robots = robotsTxt(site);
  assert(robots.includes(`Sitemap: ${site}sitemap.xml`), `robots.txt does not name the sitemap: ${robots}`);
  assert(/^User-agent: \*/m.test(robots), 'robots.txt has no user-agent line');

  // With the trailing slash: each tab is a directory on Pages, and the bare path is a
  // 301 to it -- six of the seven sitemap entries redirected.
  const map = sitemapXml(site, ['', 'linhas']);
  assert(map.includes(`<loc>${site}</loc>`), 'the sitemap is missing the site root');
  assert(map.includes(`<loc>${site}linhas/</loc>`), 'a path passed to the sitemap did not come out with its slash');
  assert(!map.includes('//linhas'), 'joining the site URL to a path doubled the slash');
  // One screen, one address: the root and /paradas/ draw the same stops screen, and Search
  // Console read two canonicals as "Duplicate, Google chose a different canonical", rightly.
  assert(canonicalUrl(site, 'paradas') === site, `the stops tab's canonical is ${canonicalUrl(site, 'paradas')}, not the root`);
  assert(canonicalUrl(site, 'linhas') === `${site}linhas/`, 'a tab that is its own screen lost its canonical');
  const full = sitemapXml(site);
  assert(!full.includes(`${site}paradas/`), 'the sitemap still lists /paradas/, which is the root under another name');
  assert((full.match(/<loc>/g) ?? []).length === 6, `the sitemap has ${(full.match(/<loc>/g) ?? []).length} entries, expected 6`);
});

ok('every tab page has its own title, description and canonical', () => {
  // Six copies of index.html carried the root's title, description and canonical: one page
  // listed seven times. Each copy is re-headed from `pageHead`, whose replacement finds the
  // root's tags, so index.html has to say exactly what ROOT_HEAD says.
  const html = read('index.html');
  const site = 'https://example.org/';
  assert(html.includes(`<title>${ROOT_HEAD.title}</title>`), 'index.html <title> is not ROOT_HEAD.title');
  assert(html.includes(`<meta property="og:title" content="${ROOT_HEAD.title}"`), 'og:title is not ROOT_HEAD.title');
  assert(html.includes(`content="${ROOT_HEAD.description}"`), 'the meta description is not ROOT_HEAD.description');
  // The app's own title for the home screen, in Galician, is the same line: a tab strip
  // should read the same before and after the bundle arrives.
  assert(translations('gl').map.documentTitle === ROOT_HEAD.title, 'gl documentTitle drifted from ROOT_HEAD.title');
  // A crawler that does not run the app sees no heading unless one is in the document; it
  // is extracted and compared, not spliced into a RegExp, because the title carries a "|".
  const staticH1 = html.match(/<div id="root"><h1[^>]*>([^<]*)<\/h1><\/div>/)?.[1];
  assert(staticH1 === ROOT_HEAD.title, `the static <h1> inside #root says ${JSON.stringify(staticH1)}, not ROOT_HEAD.title`);
  // Search Console re-checks its verification tag now and then; a head rewrite that
  // dropped it would end the verification without anything on screen changing.
  assert(/<meta name="google-site-verification" content="[\w-]{20,}"/.test(html), 'index.html lost the Search Console verification tag');

  const seen = new Set<string>();
  for (const route of SITE_PATHS) {
    const head = pageHead(route);
    // "bus" is the word people search; "non oficial" is the word they are owed. 155 is
    // where a result cuts the description, and 60 the title.
    assert(/\bbus\b/i.test(head.title), `"${head.title}" does not say bus`);
    assert(head.title.length <= 60, `"${head.title}" is ${head.title.length} characters; 60 is where a result cuts it`);
    assert(/^Non oficial\./.test(head.description), `the description for "${route}" does not open with "Non oficial."`);
    assert(head.description.length <= 155, `the description for "${route}" is ${head.description.length} characters; 155 is the cut`);
    assert(!/tempo real|en vivo|GPS en directo/i.test(head.title + head.description), `the head for "${route}" promises live data`);
    assert(!seen.has(head.title), `two pages share the title "${head.title}"`);
    seen.add(head.title);

    // Injected the way the build does it, on a page carrying the root canonical.
    const withCanonical = html.replace('<meta name="theme-color"', `<link rel="canonical" href="${site}" />\n    <meta name="theme-color"`);
    const page = pageHtml(withCanonical, route, site);
    assert(page.includes(`<title>${head.title}</title>`), `the ${route || 'root'} page did not get its title`);
    assert(page.includes(`<meta name="description" content="${head.description}"`), `the ${route || 'root'} page did not get its description`);
    assert(page.includes(`<meta property="og:title" content="${head.title}"`), `the ${route || 'root'} page did not get its og:title`);
    assert(page.includes(`>${head.title}</h1>`), `the ${route || 'root'} page did not get its own <h1>`);
    // Its own address, except the stops tab, which is the root's screen and says so.
    assert(page.includes(`<link rel="canonical" href="${canonicalUrl(site, route)}" />`), `the ${route || 'root'} page canonical is not ${canonicalUrl(site, route)}`);
    assert((page.match(/rel="canonical"/g) ?? []).length === 1, `the ${route || 'root'} page has more than one canonical`);
  }

  // The preview image is injected with the canonical, absolute, and is a file that ships.
  const vite = read('vite.config.ts');
  assert(/og:image" content="\$\{site\}icon-512\.png"/.test(vite), 'the build no longer injects an absolute og:image');
  assert(existsSync(join(root, 'public/icon-512.png')), 'public/icon-512.png is gone, so og:image points at nothing');

  // The tabs are links, so a crawler can walk from any copy to the other six, and the
  // address they carry is the one the build writes, slash included.
  for (const file of ['src/components/BottomNav.tsx', 'src/components/SideNav.tsx', 'src/components/MenuDrawer.tsx']) {
    const source = read(file);
    assert(/<a\s[^>]*\{\.\.\.tabLink\(/.test(source), `${file} no longer renders the tabs as links`);
  }
  const hook = read('src/hooks/useTabRoute.ts');
  assert(/PATHS\[tab\]\}\/\$\{window\.location\.search\}/.test(hook), 'urlForTab lost the trailing slash, so every shared link 301s again');
});

ok('every tab has a path, and the sitemap lists exactly those', () => {
  // The tab routes exist for the back gesture; the sitemap and the Pages fallback have to
  // stay in step with the hook, or a path 404s or a working one is missing.
  const hook = read('src/hooks/useTabRoute.ts');

  // The slugs were written out twice and compared by parsing the hook's source; they are one
  // record in src/routes.ts now, so what is left is that the hook reads it and covers every tab.
  const slugs = Object.values(PATHS);
  assert(slugs.length === 6, `${slugs.length} tabs have a path, expected 6: ${slugs.join(', ')}`);
  assert(new Set(slugs).size === slugs.length, `two tabs share a path: ${slugs.join(', ')}`);
  assert(/from '\.\.\/routes'/.test(hook), 'useTabRoute no longer reads the shared route record, so the sitemap can drift from it');
  for (const slug of slugs) {
    assert(SITE_PATHS.includes(slug), `"${slug}" is a tab route but is not in the sitemap`);
  }

  // React runs a state updater twice in development, so a pushState inside one pushed the
  // history entry twice and a back press appeared to do nothing.
  const go = hook.slice(hook.indexOf('const go ='));
  const updater = go.slice(go.indexOf('setTab('));
  assert(!/pushState/.test(updater), 'history.pushState is back inside the state updater, which double-pushes in development');

  // Without 404.html a mistyped link lands on GitHub's own page; without a page per tab every
  // path in sitemap.xml answers 404 and link previews are skipped.
  const vite = read('vite.config.ts');
  assert(/404\.html/.test(vite), 'the SPA fallback copy is gone, so tab paths break on GitHub Pages');
  assert(/SITE_PATHS/.test(vite), 'the build no longer writes a page per route, so every path in the sitemap answers 404');
});

ok('the hand-written notices are dated, not declared current', () => {
  // Three notices about the city are written into the repository; they used to claim
  // "vixente" and "activo", which a file cannot know. A review date cannot go out of date.
  const view = read('src/components/AlertsView.tsx');

  const stamp = view.match(/NOTICES_REVIEWED_ON = '(\d{4}-\d{2}-\d{2})'/);
  assert(stamp, 'the hand-written notices no longer carry a review date');
  const reviewed = new Date(stamp![1]);
  assert(!Number.isNaN(reviewed.getTime()), `"${stamp![1]}" is not a date`);
  assert(reviewed.getTime() <= Date.now(), 'the notices claim to have been reviewed in the future');

  // And nothing puts a claim back where the component spreads the dictionary in.
  for (const lang of ['gl', 'es', 'en']) {
    const dict = read(`src/i18n/${lang}.ts`);
    const block = dict.slice(dict.indexOf('notices: ['), dict.indexOf('],', dict.indexOf('notices: [')));
    assert(!/\bdate:/.test(block), `${lang}.ts gives the hand-written notices a date of their own again; the review date is the only one that is true`);
  }
});

ok("a notice in the operator’s navigation bar is still a notice", () => {
  // buslugo.com publishes incidents as a bell in its navigation with a msg_list dropdown; this
  // is the real markup from a day it carried a notice while the app said all was normal.
  // A notice we cannot parse is a missing warning; silence reported as normal is a wrong one.
  const navMarkup = `
    <li role="presentation" class="dropdown">
      <a href="javascript:;" class="dropdown-toggle info-number" data-toggle="dropdown">
        <i class="fa fa-bell-o"></i><span class="badge bg-red">1</span>
      </a>
      <ul class="dropdown-menu list-unstyled msg_list">
        <li id="menu-item-913" class="menu-item menu-item-type-custom">
          <a href="#"><i class="fa fa-exclamation-triangle"></i> Retenciones en zona Estación Tren</a>
        </li>
      </ul>
    </li>`;

  const found = extractAlertsFromHtml(navMarkup);
  assert(found.length === 1, `the bell dropdown yielded ${found.length} notices, expected 1`);
  assert(/Retenciones/.test(found[0].title), `the notice came back as "${found[0].title}" rather than what the page said`);
  assert(found[0].severity === 'warning', 'traffic being held up is a warning, not a note');

  // A page with no notices at all must stay empty rather than inventing one.
  assert(extractAlertsFromHtml('<html><body><p>Nada que declarar</p></body></html>').length === 0, 'a page with no notice list produced a notice anyway');
  // Nor is the bell's own "nothing to report" item: on 19 September 2026 it was shown as
  // a notice, counted on the badge and reported as an active incident.
  const quietMarkup = navMarkup.replace('<i class="fa fa-exclamation-triangle"></i> Retenciones en zona Estación Tren', 'No existen avisos en este momento');
  assert(extractAlertsFromHtml(quietMarkup).length === 0, 'the "no notices" item in the bell dropdown was reported as a notice');
});

ok("the city's traffic feed is read for closures and diversions, and for nothing else", () => {
  // Sixty days of three council feeds were audited: only the traffic tag carried anything a
  // passenger could use, and it would have stayed on screen for two months. So: that tag,
  // a headline announcing a closure, diversion or restriction, and a week.
  const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toUTCString();
  const lastMonth = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toUTCString();
  const ancient = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toUTCString();
  const feed = (items: string) => `<rss><channel>${items}</channel></rss>`;
  const item = (title: string, when: string, description = 'corpo da nova') =>
    `<item><title>${title}</title><description>${description}</description>` +
    `<pubDate>${when}</pubDate><link>https://concellodelugo.gal/x</link></item>`;

  const wanted = extractConcelloNotices(feed(item('El Ayuntamiento informa de los cortes de tráfico para este sábado con motivo de la carrera', recent)));
  assert(wanted.length === 1, `a headline announcing closures yielded ${wanted.length} notices, expected 1`);
  assert(wanted[0].source === 'concello', 'a city notice has to say it came from the city');

  // Free festival buses were the one operational item the bus tag carried in a year; that tag
  // is not read and a traffic headline has to announce a change to the street.
  const festival = extractConcelloNotices(feed(item('AUTOBUSES GRATUÍTOS PARA O ARDE LUCUS', recent)));
  assert(festival.length === 0, `a headline with no closure in it yielded ${festival.length} notices`);

  // Matching the body as well as the headline let two of these through when it was first
  // written: a police communiqué and a speech, both of which mention the streets.
  const aside = extractConcelloNotices(feed(item('Comunicado de prensa da Policía Local', recent, 'houbo cortes de tráfico e obras na rúa')));
  assert(aside.length === 0, `a headline that is not about getting around yielded ${aside.length} notices`);

  // A road-safety agreement with the traffic authority reached the screen because "tráfico"
  // was in the vocabulary; only an event word means something changed for getting around.
  const institution = extractConcelloNotices(feed(item('El Ayuntamiento y la Jefatura Provincial de Tráfico de Lugo firmarán un acuerdo para impulsar los cursos de educación vial', recent)));
  assert(institution.length === 0, `an agreement about road-safety courses yielded ${institution.length} notices`);

  // "Apertura" was in the vocabulary for a demand that a street be reopened: a position, not
  // a change on the street.
  const reopening = extractConcelloNotices(feed(item('El Ayuntamiento exige a Adif la apertura inmediata al tráfico de la calle Conde Fontao', recent)));
  assert(reopening.length === 0, `a demand about a street yielded ${reopening.length} notices`);

  // A closure is news for about a week. The race closures published on a Thursday were
  // still on screen the Tuesday after the race, with fifty-odd days left to run.
  const stale = extractConcelloNotices(feed(item('Cortes de tráfico por la carrera del sábado', lastMonth)));
  assert(stale.length === 0, 'a closure from three weeks ago is history, not news');
  const older = extractConcelloNotices(feed(item('Cortes de tráfico por la carrera del sábado', ancient)));
  assert(older.length === 0, 'a press release from months ago is history, not news');

  // The body arrives entity-encoded, so stripping tags does nothing and the reader saw
  // `&lt;div class=...&gt;` in a line that pushed the card off the screen.
  const encoded = extractConcelloNotices(feed(item('Corte de tráfico na rúa Nova', recent, '&lt;div class=&quot;field&quot;&gt;&lt;p&gt;A rúa estará cortada&lt;/p&gt;&lt;/div&gt;')));
  assert(encoded.length === 1, 'the encoded item did not come through at all');
  assert(!/[<>]|&[a-z]+;/i.test(encoded[0].description), `markup survived into the description: "${encoded[0].description}"`);
  assert(encoded[0].description === 'A rúa estará cortada', `expected the prose alone, got "${encoded[0].description}"`);
});

ok('the Bolaño notice still describes the lines it names', () => {
  // The one hand-written notice with a checkable claim: that four lines have their head at
  // Bolaño Ribadeneira. Reroute any of them and the notice becomes a lie nothing else notices.
  for (const id of ['7', '8', '9', '12']) {
    const line = BUS_LINES.find((l) => l.id === id);
    assert(line, `line ${id} is named in the Bolaño notice but is not in the data`);
    assert(/^Bolaño Ribadeneira/.test(line!.name), `the notice says line ${id} starts at Bolaño Ribadeneira; the operator calls it "${line!.name}"`);
  }
  assert(BUS_STOPS.some((s) => s.name === 'Bolaño Ribadeneira 1'), 'the stop the notice names is gone from the dataset');
});

ok('a bus whose time has passed stays on the board, marked', () => {
  // Measured against the operator's tracker: a bus five minutes late dropped off after sixty
  // seconds and the board advertised the next one, ninety minutes out, while it was three
  // minutes away. A fixed weekday morning, because the weekly job runs before the first bus.
  const probe = new Date(2026, 7, 19, 9, 0, 0); // a Wednesday, as the rest of this suite uses

  const subject = BUS_STOPS.map((s) => ({ stop: s, board: getArrivalsForStop(s.id, probe).arrivals }))
    .find((s) => s.board.length > 0);
  assert(subject, 'no stop anywhere has a departure at nine on a weekday');
  const stop = subject!.stop;

  const [first] = subject!.board;
  const [hh, mm] = first.etaTime.split(':').map(Number);
  // At the minute on its own row it is "now", not late: an interpolated time on the half
  // minute, printed as the next whole minute and judged from the half, was a minute
  // overdue at the very minute its row announced.
  const onTheMinute = new Date(probe);
  onTheMinute.setHours(hh, mm, 0, 0);
  const due = getArrivalsForStop(stop.id, onTheMinute).arrivals.find((a) => a.etaTime === first.etaTime);
  assert(due, `the ${first.lineNumber} due at ${first.etaTime} is not on the board at ${first.etaTime}`);
  assert(due!.overdueMinutes === undefined && due!.etaMinutes === 0, `at its own minute the row says eta ${due!.etaMinutes}, overdue ${due!.overdueMinutes}`);
  const fourLate = new Date(probe);
  fourLate.setHours(hh, mm + 4, 0, 0);

  const after = getArrivalsForStop(stop.id, fourLate).arrivals;
  const kept = after.find((a) => a.etaTime === first.etaTime);
  assert(kept, `the ${first.lineNumber} due at ${first.etaTime} was dropped four minutes later`);
  assert(kept!.overdueMinutes === 4, `it is on the board but says overdueMinutes ${kept!.overdueMinutes}, expected 4`);

  // And it is not still being called "arriving": that is the most confident label on the
  // screen and this is the least certain row on it.
  assert(kept!.etaMinutes === 0, 'an overdue departure should sit at zero minutes');

  // Past the window it does go, rather than lingering all day.
  const wayLate = new Date(probe);
  wayLate.setHours(hh, mm + 20, 0, 0);
  const gone = getArrivalsForStop(stop.id, wayLate).arrivals.find((a) => a.etaTime === first.etaTime);
  assert(!gone, `the ${first.lineNumber} due at ${first.etaTime} was still listed twenty minutes on`);
});

ok('a line that does not run today is next offered on a day it does run', () => {
  // The planner's weekend pass found it: asked on a Saturday, a weekday-only line was offered
  // at "tomorrow 07:19", a Sunday, when it does not run either.
  const weekdayOnly = BUS_LINES.find((l) => l.services.every((p) => p.days.length === 1 && p.days[0] === 'laborable'));
  assert(weekdayOnly, 'no weekday-only line to ask about');
  const line = weekdayOnly!;
  const direction = line.directions[0];
  const answer = getNextLineDeparture('gl', line, direction.id, direction.stops[0], 7 * 60 + 20, new Date(2026, 7, 22, 7, 20, 0));
  assert(!answer.isServiceActive, `the ${line.id} on a Saturday is marked active`);
  const daysAhead = Math.floor(answer.departureMinutes / (24 * 60));
  assert(daysAhead === 2, `the ${line.id} asked on a Saturday is offered ${daysAhead} day(s) ahead, expected 2 (Monday)`);
  // And on a Friday evening, after its last run, tomorrow is Saturday: two days as well.
  const late = getNextLineDeparture('gl', line, direction.id, direction.stops[0], 23 * 60, new Date(2026, 7, 21, 23, 0, 0));
  assert(Math.floor(late.departureMinutes / (24 * 60)) >= 1, `the ${line.id} on a Friday night is offered today`);
});

ok('a public holiday runs the Sunday timetable, and the file that says which days expires loudly', () => {
  // "Domingos e festivos" is what the operator prints, and to this app a holiday Monday was
  // a Monday: the weekday grid, labelled HORARIO OFICIAL, for buses running the Sunday one.
  const monday12Oct = new Date(2026, 9, 12, 10, 0);
  assert(monday12Oct.getDay() === 1, 'the probe date is not a Monday');
  assert(dayKind(monday12Oct) === 'domingo', `12 October 2026 reads as ${dayKind(monday12Oct)}, not as a Sunday`);
  assert(dayKind(new Date(2026, 9, 13, 10, 0)) === 'laborable', 'the day after the holiday is not a weekday again');
  assert(isHoliday(new Date(2026, 1, 17)), 'Martes de Entroido, a local holiday, is not a holiday');
  assert(!isHoliday(new Date(2026, 4, 17)), '17 May 2026 is a Sunday the decree did not substitute, and must not be listed twice over');

  const weekdayOnly = BUS_LINES.find((l) => l.services.every((p) => p.days.length === 1 && p.days[0] === 'laborable'))!;
  const sundays = BUS_LINES.find((l) => l.services.some((p) => p.days.includes('domingo')))!;
  assert(!lineRunsOn(weekdayOnly, dayKind(monday12Oct)), `the ${weekdayOnly.id} runs on a holiday Monday`);
  assert(lineRunsOn(sundays, dayKind(monday12Oct)), `the ${sundays.id}, which runs on Sundays, does not run on a holiday Monday`);
  // The next-day fallback looks past the holiday: asked on the Sunday before, a weekday-only
  // line is next offered on the Tuesday.
  const dir = weekdayOnly.directions[0];
  const next = getNextLineDeparture('gl', weekdayOnly, dir.id, dir.stops[0], 10 * 60, new Date(2026, 9, 11, 10, 0));
  assert(Math.floor(next.departureMinutes / (24 * 60)) === 2, `asked on the Sunday before a holiday Monday, the ${weekdayOnly.id} is offered ${Math.floor(next.departureMinutes / (24 * 60))} day(s) ahead, expected 2`);
  assert(/festivo|holiday/i.test(getNextLineDeparture('gl', weekdayOnly, dir.id, dir.stops[0], 10 * 60, monday12Oct).serviceNotice ?? ''), 'the notice on a holiday does not say it is one');

  // The file itself: every day well-formed and inside its year, in order, no repeats, each
  // year with a DOG source; and the current year has to be there, or a holiday this year is
  // a weekday again without anyone noticing. Failing on 1 January is the point.
  for (const [year, entry] of Object.entries(festivos)) {
    assert(entry.source.length > 0 && entry.source.every((s) => /DOG/.test(s)), `${year} has no DOG source`);
    let last = '';
    for (const day of entry.days) {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(day) && day.startsWith(year + '-'), `${day} is not a date inside ${year}`);
      assert(!Number.isNaN(Date.parse(day)), `${day} is not a real date`);
      assert(day > last, `${day} is out of order or repeated`);
      last = day;
    }
    assert(entry.days.length >= 12 && entry.days.length <= 16, `${year} lists ${entry.days.length} holidays; Galicia plus two local ones is 14`);
  }
  const thisYear = String(new Date().getFullYear());
  assert(HOLIDAY_YEARS.includes(thisYear), `src/data/festivos.json has no entry for ${thisYear}: add the year's holidays from the DOG (see the 2026 entry for the sources)`);
});

ok('a line\u2019s trip time comes from the timetable, not from a road model', () => {
  // The card summed `legSeconds` (free-flow driving) under a heading a reader took for the
  // journey: a bus that stops 39 times cannot beat a car that never stops.
  for (const line of BUS_LINES) {
    for (const [i, direction] of line.directions.entries()) {
      const scheduled = scheduledDuration(line, i, BUS_STOPS);
      assert(scheduled !== undefined, `${line.id} direction ${i} has a timetable this app cannot build a run from`);
      const freeFlow = direction.legSeconds.reduce((a, b) => a + b, 0) / 60;
      assert(
        scheduled! > freeFlow,
        `${line.id}/${i}: the trip time (${scheduled} min) is not longer than free-flow ` +
          `driving (${freeFlow.toFixed(0)} min), so it is a road model rather than the timetable`,
      );
    }
  }

  // And the card has to be the thing asking. The property above held perfectly well while
  // the view went on summing legSeconds on its own, which is exactly the state found.
  const view = read('src/components/LinesView.tsx');
  assert(/scheduledDuration\(/.test(view), 'the line card no longer asks the timetable how long the trip takes');
  assert(!/legSeconds\.reduce/.test(view), 'the line card is summing legSeconds again, which is driving time with no stops in it');
});

ok('the API is matched case-sensitively, so the rate limiter cannot be walked round', () => {
  // Express matched routes case-insensitively while every path comparison was lower case, so
  // /api/PLAN reached the planner past the rate limiter: 35 of 35 served, cut-off at 30.
  // One setting rather than a lowercase at each comparison, so this guards the setting.
  const server = read('server.ts');
  assert(/app\.set\(\s*'case sensitive routing'\s*,\s*true\s*\)/.test(server), 'case-sensitive routing is off again, so /api/PLAN reaches the planner unlimited');

  // And the setting only helps while the comparisons stay lower case; a mixed-case
  // literal would miss the very requests routing now lets through.
  const limiter = read('src/security/rateLimit.ts');
  for (const [, literal] of limiter.matchAll(/req\.path\.startsWith\('([^']+)'\)/g)) {
    assert(literal === literal.toLowerCase(), `the limiter compares req.path against "${literal}", which routing will never produce`);
  }
});

ok('the operator’s own stop page is read by class, not by position', () => {
  // Real markup from the operator's stop page, decorative <svg> paths collapsed. An <svg> sits
  // between the classed div and its <p>, the line arrives as "L4.2" and the time as "20 min".
  const block = (line: string, itinerary: string, time: string) => `
    <div class="sae-content-info">
      <div class="sae-content-info-line"> <svg/> <p>${line}</p> </div>
      <div class="sae-content-info-itinerary"> <svg/> <p>${itinerary}</p> </div>
      <div class="sae-content-info-time"> <svg/> <p>${time}</p> </div>
    </div>`;

  const page =
    block('L4.2', 'R. MURALLA-HULA (POR GANDARAS)', '20 min') +
    block('L1.2', 'CAMPUS-FINGOI-O CEAO-HULA', '31 min') +
    block('5DS', 'AVENIDA AMERICAS-MAGOI-FONTIÑAS-HULA', '50 min');

  const read = parseOperatorTimes(page);
  assert(read.length === 3, `expected 3 departures, got ${read.length}`);
  assert(read[0].line === '4.2', `the L prefix survived: "${read[0].line}"`);
  assert(read[0].towards === 'R. MURALLA-HULA (POR GANDARAS)', `itinerary: "${read[0].towards}"`);
  assert(read[0].minutes === 20, `minutes: ${read[0].minutes}`);

  // 5DS is a line number that is not a number, and the L-stripping must not touch it.
  assert(read[2].line === '5DS', `a lettered line was mangled: "${read[2].line}"`);

  // A page with no departures is not an error and not an empty guess: it is no departures.
  assert(parseOperatorTimes('<html><body>Sen saídas</body></html>').length === 0,
    'a page with no blocks produced departures out of nothing');

  // Malformed markup must not hang: the scan was 1.6 s for a megabyte of unclosed blocks,
  // which is why readCapped exists; a quarter of the ceiling stays well inside a second.
  const started = Date.now();
  parseOperatorTimes('<div class="sae-content-info">'.repeat(4000));
  const spent = Date.now() - started;
  assert(spent < 1000, `unclosed blocks took ${spent} ms, which is heading for a stall`);
});

ok('nothing scraped reaches a Leaflet tooltip unescaped', () => {
  // Leaflet takes HTML, not text: a name with a tag in it puts a real element in the DOM.
  // Two maps carried scraped names straight into innerHTML while three escaped them.
  const dir = join(root, 'src/components/Map');
  const offenders: string[] = [];

  for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
    const lines = readFileSync(join(dir, file), 'utf8').split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      if (!/(bindTooltip|bindPopup)\(|innerHTML\s*=/.test(line)) continue;
      // The call rarely fits on one line; three is enough for every one of them here.
      const call = lines.slice(i, i + 4).join(' ');
      // Names, zones and line numbers are the scraped fields. Numbers computed here are
      // not markup and need no escaping.
      const scraped = /\.(name|zone|number|color|address)\b/.exec(call);
      if (scraped && !/escapeHtml/.test(call)) {
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`);
      }
    }
  }

  assert(offenders.length === 0, `scraped text reaches a Leaflet tooltip without escapeHtml:\n    ${offenders.join('\n    ')}`);
});

ok('the build compresses its assets and the server hands them over', () => {
  // Self-hosting put 544 KB on the wire where 116 KB of brotli would do. The fix is two
  // halves useless apart: a build plugin that writes .br/.gz and a middleware that picks one.

  const vite = read('vite.config.ts');
  assert(/emitCompressedAssets/.test(vite), 'the build no longer writes compressed assets');
  assert(/brotliCompressSync/.test(vite) && /gzipSync/.test(vite), 'the build writes only one encoding; a client that takes the other pays full price');

  const server = read('server.ts');
  assert(/Content-Encoding/.test(server), 'the server no longer serves the compressed copy');
  assert(/'Vary', 'Accept-Encoding'/.test(server), 'Vary is gone, so a shared cache could hand a brotli body to a client that cannot read it');

  // And if there is a build to look at, the files really are there. Skipped rather than
  // failed when there is not, because the suite runs before the build in CI.
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) return;
  const entry = readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
  if (!entry) return;
  assert(existsSync(join(assets, entry + '.br')) && existsSync(join(assets, entry + '.gz')), `dist has ${entry} but no compressed copy beside it`);
});

ok('nothing on the critical path waits for a script over the network', () => {
  // The theme script blocks the parser wherever it sits; as a file it was a whole round trip
  // before the entry chunk was asked for, and preload tags made it worse. The property is
  // that the browser reaches the entry chunk without waiting for a network round trip.
  const built = join(root, 'dist', 'index.html');
  // Skipped rather than failed when there is no build, because CI runs the suite first.
  if (!existsSync(built)) return;
  const html = readFileSync(built, 'utf8');

  const module = html.match(/<script type="module"[^>]*\ssrc="([^"]+)"/);
  assert(module, 'the built page has no entry chunk');
  const before = html.slice(0, module!.index);

  // Any `<script src>` above the module is a request the parser stops for. `async` and
  // `defer` do not stop it, so they are allowed; nothing here uses them today.
  const blocking = [...before.matchAll(/<script\b([^>]*)\bsrc=/g)]
    .map((m) => m[1])
    .filter((attrs) => !/\b(async|defer|type="module")\b/.test(attrs));
  assert(blocking.length === 0, `${blocking.length} external script(s) block the parser before the entry chunk: ${blocking.join(' | ')}`);
});

ok('the mini map is deferred once, where it cannot be forgotten', () => {
  // `lazy()` alone defers the chunk until the component renders, and the board stays mounted
  // behind `hidden`, so the map was built inside display:none on every cold start. The
  // deferral lives in one wrapper, and only the wrapper may name the map.
  const wrapper = join('src', 'components', 'Map', 'LazyNearbyMiniMap.tsx');
  const itself = join('src', 'components', 'Map', 'NearbyMiniMap.tsx');

  const lazy = read(wrapper);
  assert(/IntersectionObserver/.test(lazy), 'the map no longer waits until it is on screen');
  assert(/h-\[240px\]/.test(lazy), 'the placeholder no longer holds the height the map takes');

  // A type-only import costs nothing at runtime; a value import is the whole map.
  const offenders = sourcesUnder('src')
    .map(relative)
    .filter((file) => file !== wrapper && file !== itself && /^\s*import\s+(?!type\b)[^;]*['"][^'"]*\/NearbyMiniMap['"]/m.test(read(file)));
  assert(offenders.length === 0, `imports the mini map directly instead of LazyNearbyMiniMap: ${offenders.join(', ')}`);
});

ok('src/data holds only what ships, and the build inputs stay out of it', () => {
  // Four files in src/data were build scaffolding the app never imported, 1.4 MB one
  // distracted import away from the bundle. They live in data/ now.

  const BUILD_ONLY = ['official-raw.json', 'osm-routes.json', 'routes.json', 'stop-amenities.json'];
  for (const name of BUILD_ONLY) {
    assert(!existsSync(join(root, 'src', 'data', name)), `${name} is back in src/data; it is a build input and the app never reads it`);
    assert(existsSync(join(root, 'data', name)), `data/${name} is missing, so the build cannot run`);
  }

  // And nothing under src/ may import one of them, whatever directory it sits in.
  const offenders: string[] = [];
  for (const file of sourcesUnder('src')) {
    const text = readFileSync(file, 'utf8');
    for (const name of BUILD_ONLY) if (text.includes(name)) offenders.push(`${relative(file)} names ${name}`);
  }
  assert(offenders.length === 0, `a build input reached the app:\n    ${offenders.join('\n    ')}`);

  // The other half of the same rule: everything left in src/data is either imported by the
  // app or is the loader that imports it.
  const shipped = readdirSync(join(root, 'src', 'data'));
  assert(shipped.length > 0, 'src/data is empty, which cannot be right');
});

ok('the address the app calls for /api is the one the policy admits', () => {
  // apiUrl.ts builds the request URL and csp.ts admits the origin; name the setting
  // differently in one and the build succeeds and fails silently in the browser.
  for (const file of ['src/services/apiUrl.ts', 'src/security/csp.ts']) {
    assert(read(file).includes('VITE_API_ORIGIN'), `${file} no longer reads VITE_API_ORIGIN, so the request and the policy can disagree`);
  }

  // csp.ts runs in Node, where import.meta.env does not exist. Comments are stripped first:
  // the first draft of this check failed on its own explanation.
  const csp = read('src/security/csp.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert(!csp.includes('import.meta.env'), 'csp.ts reads import.meta.env, which is undefined in Node');
});

ok('a hidden HTML comment does not come out as visible text', () => {
  // `replace(/<[^>]+>/g, '')` lived in five files, and a comment ends at its first `>`, so
  // everything a page author hid was read out as text. Reproduced before believed.
  assert.strictEqual(plainText('<!-- <p>x</p> --> visible'), 'visible');
  assert.strictEqual(plainText('<script>alert(1)</script>keep'), 'keep');
  assert.strictEqual(plainText('<style>a{}</style>keep'), 'keep');

  // An attribute may carry a quoted `>`, and the whole tag still goes.
  assert.strictEqual(plainText('<img src=x onerror="a>b">text'), 'text');

  // The replacement is a parameter because two callers want the words joined and the
  // rest want them spaced; both must still collapse and trim.
  assert.strictEqual(plainText('<b>a</b> <i>b</i>'), 'a b');
  assert.strictEqual(plainText('<b>a</b><i>b</i>', ''), 'ab');

  // And nothing that is already text is touched.
  assert.strictEqual(plainText('Rda. Muralla 56 (Sindicatos)'), 'Rda. Muralla 56 (Sindicatos)');
});

ok('"stops near me" answers nothing when you are not near any', () => {
  // getNearbyStops ranks every stop, which the planner wants; read as an answer to a person
  // it is nonsense from Madrid, where the first result is 423 km away.
  const madrid = getNearbyStops(40.4168, -3.7038).filter((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES);
  assert.strictEqual(madrid.length, 0, 'a phone in Madrid is being offered stops in Lugo');

  const coruna = getNearbyStops(43.3623, -8.4115).filter((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES);
  assert.strictEqual(coruna.length, 0, 'a phone in A Coruña is being offered stops in Lugo');

  // The limit has to leave the network intact: the widest gap between neighbours is about
  // 3.5 km, so standing at any stop still finds it.
  for (const stop of BUS_STOPS) {
    const here = getNearbyStops(stop.lat, stop.lng).filter((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES);
    assert(here.length > 0, `standing at ${stop.name} finds no stop within the limit`);
  }
});

await okAsync('fifty people at one pole are one request to the operator, not fifty', async () => {
  // The cache only helps once a read has come back: fifty requests on a cold cache were fifty
  // outbound connections and fifty 502s against somebody else's server. This is the promise
  // of one outbound request a minute however many people are looking.
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    // Long enough that every caller below is waiting on this one at the same time.
    await new Promise((r) => setTimeout(r, 40));
    return new Response('<div class="sae-content-info"><div class="sae-content-info-line"><p>13</p></div>' +
      '<div class="sae-content-info-time"><p>7</p></div></div></div>', { status: 200 });
  }) as typeof fetch;

  try {
    const code = `stress-${Date.now()}`; // never cached by anything else in this run
    const answers = await Promise.all(Array.from({ length: 50 }, () => operatorTimesForStop(code)));
    assert(calls === 1, `fifty concurrent readers made ${calls} requests to the operator, not 1`);
    assert(answers.every((a) => a === answers[0]), 'the concurrent readers did not all get the same answer');
    assert(answers[0]?.departures.length === 1, 'the coalesced answer lost its departures');

    // A failed read must not be remembered as a failure: the next caller has to be allowed
    // to try again, which is why the in-flight entry is dropped in `finally`.
    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error('the operator is down');
    }) as typeof fetch;
    const failing = `stress-fail-${Date.now()}`;
    assert((await operatorTimesForStop(failing)) === null, 'a failed read did not answer null');
    assert((await operatorTimesForStop(failing)) === null, 'a failed read did not answer null the second time');
    assert(calls === 2, `a failed read was cached instead of retried (${calls} attempts, expected 2)`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await okAsync('the two servers answer the pole question the same way, and only for poles they know', async () => {
  // Express and the Deno worker share one decision, so the same code cannot get a 404 from
  // one and a 502 from the other, and no request leaves for a code we cannot resolve.
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  // Read through a call: after assert(asked.length === 0) TypeScript narrows the length
  // to the literal 0 and rejects the later comparison with 1.
  const requests = () => asked.length;
  const withCode = BUS_STOPS.find((s) => poleCode(s));
  const withoutCode = BUS_STOPS.find((s) => !poleCode(s));
  assert(withCode && withoutCode, 'the dataset no longer has both kinds of stop');
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      throw new Error('the operator is down');
    }) as typeof fetch;

    const unknown = await operatorTimesResponse('no-such-stop');
    assert(unknown.status === 404 && requests() === 0, 'an unknown code was not refused before asking the operator');
    const noCode = await operatorTimesResponse(withoutCode!.id);
    assert(noCode.status === 404 && requests() === 0, 'a stop with no operator code was not refused before asking');
    const down = await operatorTimesResponse(withCode!.id);
    assert(down.status === 502 && requests() === 1, `an unreadable operator page did not answer 502 (${down.status}, ${requests()} requests)`);
    assert(asked[0].endsWith(encodeURIComponent(poleCode(withCode!)!)), `the operator was asked for ${asked[0]}, not for the pole code`);

    globalThis.fetch = (async () =>
      new Response(
        '<div class="sae-content-info"><div class="sae-content-info-line"><p>13</p></div>' +
          '<div class="sae-content-info-time"><p>7</p></div></div></div>',
        { status: 200 },
      )) as typeof fetch;
    const up = await operatorTimesResponse(withCode!.id);
    assert(up.status === 200, `a readable operator page did not answer 200 (${up.status})`);
    assert((up.body as { departures: unknown[] }).departures.length === 1, 'the 200 answer lost its departures');
  } finally {
    globalThis.fetch = realFetch;
  }
});

ok('the published timing points still anchor as many stops as they can', () => {
  // Two thirds of the passing times are modelled rather than printed, because the operator
  // prints one table per loop with two to five timing points: 48 directions, 38 with rows
  // on distinct stops, 18 surviving chaining. Pinned so a lost anchor shows as a failure.
  let directions = 0;
  let anchored = 0;
  let bracketed = 0;
  let extrapolated = 0;

  for (const line of BUS_LINES) {
    line.directions.forEach((direction, di) => {
      const runs = buildRuns(line, di, BUS_STOPS, 'laborable');
      if (!runs.length) return;
      directions++;
      const anchors = runs.reduce<number[]>((best, r) => (r.publishedStopIndices.length > best.length ? r.publishedStopIndices : best), []);
      if (anchors.length > 1) anchored++;
      const first = anchors[0] ?? 0;
      const last = anchors[anchors.length - 1] ?? 0;
      direction.stops.forEach((_, i) => {
        if (anchors.length > 1 && i >= first && i <= last) bracketed++;
        else extrapolated++;
      });
    });
  }

  assert(directions === 48, `${directions} directions have a weekday pattern, not 48`);
  assert(anchored === 18, `${anchored} directions are anchored at both ends, not 18 — run pnpm validate:times`);
  assert(bracketed === 386, `${bracketed} stops have their time pinned at both ends, not 386`);
  assert(extrapolated === 798, `${extrapolated} stops sit beyond the last published point, not 798`);
});

ok('a line runs on the days the operator says it runs, and on no others', () => {
  // Sixteen directions run no Sunday expeditions and an audit on a Sunday cannot tell that
  // from buildRuns dropping them; the operator's own sentence per line settles it.
  const raw = JSON.parse(read('data/official-raw.json'));
  const source = new Map<string, { days: string }>((raw.lines as { id: string; days: string }[]).map((l) => [l.id, l]));

  let weekdayOnly = 0;
  let everyDay = 0;
  for (const line of BUS_LINES) {
    const said = source.get(line.id)?.days;
    assert(said, `${line.number} is in the dataset but not in the scrape`);

    const built = new Set((line.services ?? []).flatMap((s) => s.days));
    const sundayRuns = line.directions.reduce((n, _, i) => n + buildRuns(line, i, BUS_STOPS, 'domingo').length, 0);
    const weekdayRuns = line.directions.reduce((n, _, i) => n + buildRuns(line, i, BUS_STOPS, 'laborable').length, 0);
    assert(weekdayRuns > 0, `${line.number} produces no weekday expedition at all`);

    if (/laborable/i.test(said!)) {
      weekdayOnly++;
      assert(!built.has('domingo'), `${line.number} is weekdays-only in the source but was built with a Sunday`);
      assert(sundayRuns === 0, `${line.number} is weekdays-only but produced ${sundayRuns} Sunday expedition(s)`);
    } else {
      everyDay++;
      assert(built.has('domingo'), `${line.number} says "${said}" but no Sunday service was built`);
      assert(sundayRuns > 0, `${line.number} says "${said}" but produced no Sunday expedition`);
    }
  }
  // Counted from the source, so a line changing its calendar shows up here as a number
  // rather than as a silently emptier Sunday.
  assert(weekdayOnly === 8, `${weekdayOnly} lines are weekdays-only in the scrape, not 8`);
  assert(everyDay === 16, `${everyDay} lines run every day in the scrape, not 16`);
});

ok('every stop the operator lists is on the route, or dropped for a stated reason', () => {
  // The audit reported directions whose halves differ with no way to tell a one-way itinerary
  // from lost stops. Rebuilt from the scrape, every listed stop is kept or dropped for one of
  // two countable reasons; it found a fourteen-line pole missing from line 13's return.
  const raw = JSON.parse(read('data/official-raw.json'));
  const source = new Map<string, { directions: { stops: number[] }[] }>((raw.lines as { id: string; directions: { stops: number[] }[] }[]).map((l) => [l.id, l]));

  const canonicalByPs = new Map<number, string>();
  for (const stop of BUS_STOPS) for (const ps of stop.officialIds ?? []) canonicalByPs.set(ps, stop.id);

  let repeatedPole = 0;
  let unplaceable = 0;
  for (const line of BUS_LINES) {
    const src = source.get(line.id);
    assert(src, `${line.number} is in the dataset but not in the scrape`);
    line.directions.forEach((direction, i) => {
      const listed = src!.directions[i]?.stops ?? [];
      assert(listed.length > 0, `${line.number}/${direction.id} has no itinerary in the scrape`);

      const kept: string[] = [];
      for (const ps of listed) {
        const canonical = canonicalByPs.get(ps);
        if (!canonical) {
          unplaceable++;
          continue;
        }
        if (kept.includes(canonical)) {
          repeatedPole++;
          continue;
        }
        kept.push(canonical);
      }

      // 5.1's return has its order repaired against the surveyed itinerary, so the built sequence
      // is a permutation of the scrape's; everywhere else the two agree exactly.
      const sameSet = kept.length === direction.stops.length && kept.every((id) => direction.stops.includes(id));
      assert(sameSet, `${line.number}/${direction.id}: the scrape gives ${kept.length} stops, the dataset has ${direction.stops.length}`);
    });
  }

  // Both numbers are the whole of the asymmetry. Anything else dropping a stop moves one
  // of them, and a stop that quietly stops being placeable moves the second.
  assert(repeatedPole === 3, `${repeatedPole} stops were dropped as a repeated pole, not 3`);
  assert(unplaceable === 11, `${unplaceable} stops could not be placed at all, not 11`);

  // The one the token recovered, named rather than counted: it is the busiest interchange
  // in the city and it went missing from a line that calls there.
  const thirteen = BUS_LINES.find((l) => l.number === '13')!;
  const sindicatos = BUS_STOPS.find((s) => s.officialToken === 'uilP')!;
  assert(thirteen.directions[1].stops.includes(sindicatos.id), 'line 13 no longer calls at Rda. Muralla 56 (Sindicatos) on the way back');
});

ok('the bounded edit distance agrees with the matrix it replaced', () => {
  // The fuzzy tier answers "within this many edits" and skips on a length gap or an
  // over-budget row; a bound one too tight quietly stops finding the typo it was written
  // for. The plain matrix, kept here only, is checked over every word of every stop name.
  const matrix = (a: string, b: string): number => {
    const grid: number[][] = [];
    for (let i = 0; i <= b.length; i++) grid[i] = [i];
    for (let j = 0; j <= a.length; j++) grid[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        grid[i][j] =
          b.charAt(i - 1) === a.charAt(j - 1)
            ? grid[i - 1][j - 1]
            : Math.min(grid[i - 1][j - 1] + 1, grid[i][j - 1] + 1, grid[i - 1][j] + 1);
      }
    }
    return grid[b.length][a.length];
  };

  const words = [...new Set(BUS_STOPS.flatMap((s) => normalizeText(s.name).split(' ')))].filter(Boolean);
  // Real words against real words, and against the typos somebody actually makes: a
  // letter dropped, a letter doubled, two letters swapped, and the empty string.
  const queries = [
    '',
    ...words.slice(0, 60).flatMap((w) => [
      w,
      w.slice(1),
      w[0] + w,
      w.length > 2 ? w[1] + w[0] + w.slice(2) : w,
    ]),
  ];

  let pairs = 0;
  for (const query of queries) {
    for (const word of words) {
      for (const max of [1, 2]) {
        pairs++;
        const bounded = withinEditDistance(word, query, max);
        const plain = matrix(word, query) <= max;
        assert(bounded === plain, `withinEditDistance("${word}", "${query}", ${max}) said ${bounded}, the matrix says ${plain}`);
      }
    }
  }
  assert(pairs > 100_000, `only ${pairs} pairs compared, which is not a corpus`);

  // And it still answers the bounded question rather than computing a distance: a ratio
  // against the matrix, not a stopwatch, over the short-word pairs the app actually asks about.
  const time = (run: () => void) => {
    const started = process.hrtime.bigint();
    run();
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  const typed = ['ronda da muralla', 'avenida das americas', 'a'.repeat(MAX_QUERY_LENGTH)];
  const sweep = (check: (a: string, b: string) => unknown) => () => {
    for (const query of typed) for (const word of words) check(word, query);
  };
  const bounded = sweep((w, q) => withinEditDistance(w, q, 2));
  const plain = sweep((w, q) => matrix(w, q) <= 2);
  bounded();
  plain(); // once each first, so neither side pays for the other's warm-up
  const fast = time(bounded);
  const slow = time(plain);
  assert(slow > fast * 10, `the bounded check is only ${(slow / fast).toFixed(1)}x the matrix (${fast.toFixed(1)} vs ${slow.toFixed(1)} ms); it is computing distances again`);
});

ok('a street can be found by any of the names people give it', () => {
  // "Avenida das Américas" found nothing: the abbreviation was expanded, the linking words
  // not. The street types come from counting the dataset, and two of them were missing.
  const best = (query: string) =>
    BUS_STOPS.map((s) => ({ s, score: calculateRelevanceScore(s.name, s.code, s.id, query, s.zone) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)[0];

  const cases: [query: string, mustMatch: RegExp][] = [
    ['Avenida das Américas', /Américas/],
    ['Avenida de las Américas', /Américas/],
    ['Avda. Américas', /Américas/],
    ['Estrada da Fonsagrada', /Fonsagrada/],
    ['Carretera Fonsagrada', /Fonsagrada/],
    ['Calzada das Gándaras', /Gándaras/],
    ['Calle Leiteiras', /Leiteiras/],
    ['Ronda da Muralla', /Muralla/],
    // "C/" is how a street is written in Spanish. The slash normalises to a space, so
    // this arrived as a bare "c" that expanded to nothing and matched nothing.
    ['C/ Leiteiras', /Leiteiras/],
    ['C/ Illas Canarias', /Illas Canarias/],
    ['c/ industria', /Industria/],
    // The operator's own shorthand for the same word, inside its own names.
    ['Rúa Vidro', /Vidro/],
    // The ordinal sign is in nineteen names and on nobody's keyboard.
    ['Rúa Armórica n 138', /Armórica/],
    ['Rúa Armórica Nº 138', /Armórica/],
    // Two spellings of one roundabout, both in the data.
    ['Rotonda Avecus', /Avecus/],
    // Galician and Spanish for the same word. The first three pairs are inconsistent
    // inside the data itself, so these check it against its own other spelling.
    ['Cementerio San Froilán', /Cemiterio|Cementerio/],
    ['Cemiterio San Froilán', /Cemiterio|Cementerio/],
    ['Fuente dos Ranchos', /Fonte dos Ranchos/],
    ['Iglesia de Bóveda', /Igrexa de Bóveda/],
    ['Puente', /Ponte/],  // "Ponte Romana" is a place, not a stop; the stop is A Ponte.
    ['Estrada Vieja de Santiago', /Vella de Santiago/],
  ];

  for (const [query, mustMatch] of cases) {
    const hit = best(query);
    assert(hit, `"${query}" finds no stop at all`);
    assert(mustMatch.test(hit.s.name), `"${query}" resolves to ${hit.s.name}`);
    // The filter and the score have to agree, or one hides what the other ranks.
    assert(matchesQuery(hit.s.name, query), `"${query}" scores ${hit.s.name} but filters it out`);
  }

  // Dropping the linking words must not make unrelated names collide.
  assert(/Fonte dos Ranchos/.test(best('Fonte dos Ranchos')?.s.name ?? ''), 'a name made mostly of linking words stopped resolving to itself');

  // A query of only dropped words used to leave the empty string, which every name contains:
  // "de" scored all 417 stops and handed back six at random.
  for (const nothing of ['de', 'da', 'de la', 'do', 'linea']) {
    const hit = best(nothing);
    assert(!hit || normalizeText(hit.s.name).includes(normalizeText(nothing)), `"${nothing}" resolves to ${hit?.s.name}, which does not contain it`);
  }

  // A neighbourhood is how people say where they are and the stop names do not carry it;
  // the zone scores below every match on the name itself.
  for (const [area, least] of [['Piringalla', 20], ['O Ceao', 30], ['Campus USC', 20]] as const) {
    const found = BUS_STOPS.filter((s) => calculateRelevanceScore(s.name, s.code, s.id, area, s.zone) > 0);
    assert(found.length >= least, `"${area}" finds ${found.length} stops, expected at least ${least}`);
  }
});

ok('a line answers to the words people put in front of its number', () => {
  // "linea 12", "liña 12", "L12" and "bus 12" all returned nothing: only the bare number
  // matched the exact-code test.
  for (const line of BUS_LINES) {
    for (const prefix of ['', 'linea ', 'liña ', 'línea ', 'line ', 'bus ', 'L']) {
      const query = `${prefix}${line.number}`;
      const hit = BUS_LINES.map((l) => ({ l, score: calculateRelevanceScore(l.name, l.number, l.id, query, l.description) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      assert(hit, `"${query}" finds no line at all`);
      // By number, not by id: four lines are called 11, and nothing in "linea 11" says
      // which of them the reader meant. The screen disambiguates them by destination.
      assert(hit.l.number === line.number, `"${query}" resolves to line ${hit.l.number}`);
    }
  }
});

ok('the pedestrian network is a graph and not a pile of lines', () => {
  // Two ways sharing a node id are joined; a router on a shattered graph does not fail, it
  // quietly answers "no route" for half the city.
  const raw = read('src/data/walk-network.json');
  const graph = JSON.parse(raw) as { scale: number; junctions: number[]; edges: number[] };

  assert(graph.scale === 100_000, `coordinates are stored at 1e-5; found scale ${graph.scale}`);
  assert(graph.junctions.length % 2 === 0, 'junctions are lat/lng pairs and the array is odd');
  const junctionCount = graph.junctions.length / 2;
  assert(junctionCount > 15_000, `only ${junctionCount} junctions; Lugo has more streets than that`);

  // Walk the flat edge runs: a, b, metres, steps, shape length, then that many deltas.
  const neighbours = new Map<number, number[]>();
  let i = 0;
  let edgeCount = 0;
  let metresTotal = 0;
  while (i < graph.edges.length) {
    const a = graph.edges[i];
    const b = graph.edges[i + 1];
    const metres = graph.edges[i + 2];
    const steps = graph.edges[i + 3];
    const shape = graph.edges[i + 4];

    assert(a >= 0 && a < junctionCount, `edge ${edgeCount} starts at junction ${a}, which does not exist`);
    assert(b >= 0 && b < junctionCount, `edge ${edgeCount} ends at junction ${b}, which does not exist`);
    assert(a !== b, `edge ${edgeCount} is a loop from junction ${a} to itself`);
    assert(steps === 0 || steps === 1, `edge ${edgeCount} has a steps flag of ${steps}`);
    // Nothing in a city is one edge of eight kilometres. A run that long means two
    // junctions were joined that should have had the street between them.
    assert(metres >= 0 && metres < 8000, `edge ${edgeCount} claims ${metres} m`);

    (neighbours.get(a) ?? neighbours.set(a, []).get(a)!).push(b);
    (neighbours.get(b) ?? neighbours.set(b, []).get(b)!).push(a);
    metresTotal += metres;
    edgeCount++;
    i += 5 + shape * 2;
  }
  assert(i === graph.edges.length, 'the edge array does not divide into whole edges');
  assert(edgeCount > 20_000, `only ${edgeCount} edges`);

  // 2.516 km of walkable way over a municipality of some 330 km2, parishes included.
  const km = Math.round(metresTotal / 1000);
  assert(km > 1500 && km < 4000, `${km} km of walkable way is not a plausible total for Lugo`);

  // Measured at 98.7% in one piece when written; well under that means the node ids stopped
  // joining and every route would be a straight line again.
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length) {
    const node = stack.pop()!;
    for (const other of neighbours.get(node) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      stack.push(other);
    }
  }
  const connected = (seen.size / junctionCount) * 100;
  assert(connected > 95, `the largest connected piece holds only ${connected.toFixed(1)}% of the junctions`);
});

await okAsync('the walking router returns a route you could actually walk', async () => {
  // The failure that matters is a confident wrong answer, so these check its shape.
  const muralla = BUS_STOPS.find((s) => s.name.startsWith('Rda. Muralla 56'))!;
  const ponte = BUS_STOPS.find((s) => s.name.startsWith('A Ponte (cruce'))!;
  const from: [number, number] = [muralla.lat, muralla.lng];
  const to: [number, number] = [ponte.lat, ponte.lng];

  const route = await routeOnFoot(from, to);
  assert(route, 'no route between two stops in the middle of Lugo');

  // A route shorter than the crow means a slice taken backwards or an edge counted from the
  // wrong end.
  const straight = metresBetween(from[0], from[1], to[0], to[1]);
  assert(route!.meters >= straight, `${route!.meters} m route over a ${Math.round(straight)} m straight line`);
  // And not absurdly longer. Measured over 410 stop pairs the median detour is x1.35,
  // which is the factor the offline estimate has always used.
  assert(route!.meters < straight * 4, `${route!.meters} m for ${Math.round(straight)} m straight is not a route, it is a tour`);

  // The drawn line has to be the route that was measured, or the map and the number
  // disagree about the same walk.
  let drawn = 0;
  for (let i = 1; i < route!.path.length; i++) {
    drawn += metresBetween(route!.path[i - 1][0], route!.path[i - 1][1], route!.path[i][0], route!.path[i][1]);
  }
  assert(Math.abs(drawn - route!.meters) < route!.meters * 0.02 + 5, `the polyline is ${Math.round(drawn)} m but the route claims ${route!.meters} m`);

  // It starts where you are and ends where you asked, not at the nearest corner.
  assert(route!.path[0][0] === from[0] && route!.path[0][1] === from[1], 'the route does not start at the origin');
  const last = route!.path[route!.path.length - 1];
  assert(last[0] === to[0] && last[1] === to[1], 'the route does not end at the destination');

  // Same question, same answer.
  const again = await routeOnFoot(from, to);
  assert(again!.meters === route!.meters && again!.minutes === route!.minutes, 'the router is not deterministic');

  // Both ends on one street: no junction is involved and the answer is the walk along it.
  const nudged: [number, number] = [from[0] + 0.0002, from[1]];
  const short = await routeOnFoot(from, nudged);
  assert(short, 'no route to a point twenty metres away');
  assert(short!.meters < 120, `${short!.meters} m to walk twenty metres up the same street`);

  // Checked over a spread of pairs: endpoints well back from the network (a lay-by on the
  // N-VI) had their approach left out of the total while the drawn line included it.
  let sampled = 0;
  for (let i = 0; i < BUS_STOPS.length; i += 37) {
    for (let j = 11; j < BUS_STOPS.length; j += 53) {
      const a = BUS_STOPS[i];
      const b = BUS_STOPS[j];
      if (a.id === b.id) continue;
      const leg = await routeOnFoot([a.lat, a.lng], [b.lat, b.lng]);
      if (!leg) continue;
      sampled++;

      let drew = 0;
      for (let p = 1; p < leg.path.length; p++) {
        drew += metresBetween(leg.path[p - 1][0], leg.path[p - 1][1], leg.path[p][0], leg.path[p][1]);
      }
      assert(Math.abs(drew - leg.meters) <= leg.meters * 0.02 + 8, `${a.name} -> ${b.name}: draws ${Math.round(drew)} m, reports ${leg.meters} m`);
      const asTheCrowFlies = metresBetween(a.lat, a.lng, b.lat, b.lng);
      assert(leg.meters >= asTheCrowFlies - 1, `${a.name} -> ${b.name}: ${leg.meters} m over a ${Math.round(asTheCrowFlies)} m straight line`);
      assert(leg.minutes >= 1, `${a.name} -> ${b.name}: a walk of ${leg.minutes} min`);
    }
  }
  assert(sampled > 50, `only ${sampled} pairs routed; the sweep is not sweeping`);
});

ok('the three front doors say the same true things', () => {
  // The Galician README is the whole documentation; the other two are one screen each so a
  // figure has one place to go stale. What cannot be in one language only is the honest
  // labelling: not official, no time a measurement, and the counts they quote.
  const doors = ['README.md', 'README.es.md', 'README.en.md'];

  for (const door of doors) {
    const text = read(door);

    assert(/Monbus/.test(text) && /Concello de Lugo/.test(text), `${door} does not say who it is not`);
    assert(/HORARIO OFICIAL/.test(text) && /ESTIMADO/.test(text), `${door} does not show the two labels every time carries`);

    // Every count it states about the network has to be the count the network has.
    for (const [claimed, what, actual] of [
      [/\b(\d+) paradas\b/, 'stops', BUS_STOPS.length],
      [/\b(\d+) stops\b/, 'stops', BUS_STOPS.length],
      [/\b(?:as |all )?(\d+) (?:liñas|líneas|lines)\b/, 'lines', BUS_LINES.length],
    ] as const) {
      const found = claimed.exec(text);
      if (found) {
        assert(Number(found[1]) === actual, `${door} says ${found[1]} ${what}; there are ${actual}`);
      }
    }
  }

  // And each summary has to point at the full document, or it is a dead end rather than
  // a front door.
  for (const door of ['README.es.md', 'README.en.md']) {
    const text = read(door);
    assert(/\(README\.md\)/.test(text), `${door} does not link to the full README`);
    assert(/\(PRIVACY\.md\)/.test(text), `${door} does not link to the privacy page`);
  }
  const gl = read('README.md');
  assert(/README\.es\.md/.test(gl) && /README\.en\.md/.test(gl), 'README.md does not offer the other two');
});

ok('the surfaces seen before the README say "non oficial" first', () => {
  // A search result, a link preview and the install prompt each show one line and none shows
  // the README; the description opened with "Horarios oficiais" and the manifest borrowed
  // the operator's name. "Non oficial" leads, and the description stays under 160 characters.
  const html = read('index.html');
  const config = read('vite.config.ts');
  const meta = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const og = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  const manifest = /description: '([^']*)'/.exec(config)?.[1] ?? '';
  const shortName = /short_name: '([^']*)'/.exec(config)?.[1] ?? '';

  for (const [where, text] of [['meta description', meta], ['og:description', og], ['manifest description', manifest]]) {
    assert(/^Non oficial\./.test(text), `${where} does not open with "Non oficial."`);
  }
  assert(meta.length <= 160, `meta description is ${meta.length} characters; 160 is where a result cuts it`);
  assert(!/\bbus ?lugo\b/i.test(shortName), `manifest short_name "${shortName}" reads as the operator's`);
  assert(shortName.length <= 12, `manifest short_name "${shortName}" is longer than a launcher shows`);
});

await okAsync('no option promises a bus the measured walk cannot reach', async () => {
  // The plan is built from the estimated walk and the router then measures the pavement;
  // past the cushion the bus is gone and the arrival on screen is unreachable. The planner
  // can be told the measured walks before ranking, and whatever survives is labelled.
  const PAIRS: [string, string][] = [
    ['Avenida das Américas', 'Rda. Muralla 56 (Sindicatos)'],
    ['Avenida das Américas', 'Hospital Lucus Augusti (HULA)'],
    ['Avenida das Américas', 'Campus Universitario'],
    ['Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)'],
    ['Praza Maior', 'Campus Universitario'],
  ];
  type Place = { lat: number; lng: number };

  /** How far past the cushion the measured walk to the first stop runs. */
  const missedBy = async (plan: RoutePlanResult, origin: Place, destination: Place) => {
    if (!plan.segments.some((seg) => seg.type === 'bus')) return 0;
    const hops = walkHopsOf(plan, origin, destination);
    if (!hops.length) return 0;
    const [a, b] = hops[0];
    const route = await routeOnFoot(a, b);
    if (!route) return 0;
    // Once a measured walk has been handed to planTrips the plan is built on it, and charging
    // the difference again would move a departure that is already right.
    const allowed =
      plan.segments[0]?.type === 'walk'
        ? plan.segments[0].durationMinutes
        : estimateWalk(getDistanceMeters(a[0], a[1], b[0], b[1])).minutes;
    return Math.max(0, route.minutes - allowed - plan.slackMinutes);
  };

  let before = 0;
  let after = 0;

  for (const hour of [7, 9, 14, 19]) {
    for (const [from, to] of PAIRS) {
      const now = new Date(2026, 8, 8, hour, 0, 0);
      const origin = resolveLocationQuery(from);
      const destination = resolveLocationQuery(to);
      assert(origin && destination, `${from} -> ${to}: one of the ends is not in the dataset`);
      let plans = planTrips(from, to, { now }).slice(0, 4);
      if (!plans.length) continue;
      if ((await missedBy(plans[0], origin, destination)) === 0) continue;

      before++;
      const known = new Map<string, number>();
      for (const plan of plans) {
        const boarding = plan.segments.find((seg) => seg.type === 'bus')?.fromStop;
        const first = walkHopsOf(plan, origin, destination)[0];
        if (!boarding || !first) continue;
        const route = await routeOnFoot(first[0], first[1]);
        if (route) known.set(boarding.id, route.minutes);
      }
      // Exactly one retry. A second boards somewhere else again and can oscillate.
      const again = planTrips(from, to, { now, measuredWalkToStop: (id) => known.get(id) }).slice(0, 4);
      if (again.length) plans = again;
      if ((await missedBy(plans[0], origin, destination)) > 0) after++;
    }
  }

  assert(before > 0, 'the sample no longer contains the case this check exists for');
  assert(after < before, `telling the planner the measured walks fixed none of the ${before} unreachable answers`);

  // The other half of the contract: what the retry cannot fix is said, not smoothed over.
  // The screen, the row of alternatives and the arithmetic they share.
  const view = ['RoutePlannerView.tsx', 'planner/TripOptions.tsx', 'planner/walkCorrection.ts']
    .map((file) => read(`src/components/${file}`))
    .join('\n');
  assert(/arrival: shiftClock\(plan\.arrivalTime, fix\.after\)/.test(view), 'the walk correction is moving the arrival again; a bus you cannot reach does not arrive later, it leaves without you');
  assert((view.match(/unreachableWalk/g) ?? []).length >= 2, 'nothing on the row or the headline says the measured walk does not reach that bus');
  assert(/replannedRef\.current = true;/.test(view), 'the replan is no longer capped at one; plan -> measure -> plan can oscillate forever');
  for (const lang of LANGS) {
    assert(translations(lang).planner.unreachableWalk.trim().length > 0, `${lang}: nothing to say it with`);
  }
});

await okAsync('walking up a hill costs more than walking down it', async () => {
  // OpenStreetMap has no elevation; until the IGN model was added every walk cost the same
  // both ways, and the climb from the river to the old town is about ninety metres.
  const graph = JSON.parse(
    read('src/data/walk-network.json'),
  ) as { junctions: number[]; heights?: number[] };

  const junctionCount = graph.junctions.length / 2;
  assert(graph.heights, 'the graph carries no heights; run pnpm run data:elevation');
  assert(graph.heights!.length === junctionCount, `${graph.heights!.length} heights for ${junctionCount} junctions`);

  // Delta-coded like the coordinates. Anything outside the city's 357-700 m is a height map
  // read wrong, which puts hills in the wrong places silently.
  let running = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const delta of graph.heights!) {
    running += delta;
    low = Math.min(low, running);
    high = Math.max(high, running);
  }
  assert(low > 300 && low < 400, `the lowest junction is at ${low} m`);
  assert(high > 600 && high < 900, `the highest junction is at ${high} m`);

  // The climb charged is along the street, not the difference between its ends: 3,169 edges
  // hide some climb and 287 hide ten metres, and they would all go flat again silently.
  const withAscent = JSON.parse(
    read('src/data/walk-network.json'),
  ) as { edges: number[]; heights: number[]; up?: number[]; down?: number[] };

  assert(withAscent.up && withAscent.down, 'the graph carries no per-edge ascent');

  // Walk the edge records to pair each edge with its two junctions.
  const junctionHeight: number[] = [];
  let climbing = 0;
  for (const delta of withAscent.heights) {
    climbing += delta;
    junctionHeight.push(climbing);
  }
  let at = 0;
  let edgeIndex = 0;
  let hiddenClimbs = 0;
  while (at < withAscent.edges.length) {
    const a = withAscent.edges[at];
    const b = withAscent.edges[at + 1];
    const shape = withAscent.edges[at + 4];
    const rise = junctionHeight[b] - junctionHeight[a];
    const climbsUp: number = withAscent.up![edgeIndex];
    const climbsDown: number = withAscent.down![edgeIndex];

    assert(climbsUp >= 0 && climbsDown >= 0, `edge ${edgeIndex} climbs a negative amount`);
    // Up must cost more than down over rises big enough for the noise filter not to be the
    // whole story; the two are not exactly the height difference apart.
    if (Math.abs(rise) >= 5) {
      assert(Math.sign(climbsUp - climbsDown) === Math.sign(rise), `edge ${edgeIndex} rises ${rise} m but costs ${climbsUp} m up against ${climbsDown} m down`);
    }
    if (rise <= 0 && climbsUp > 0) hiddenClimbs++;
    at += 5 + shape * 2;
    edgeIndex++;
  }
  assert(hiddenClimbs > 100, `only ${hiddenClimbs} edges climb over level ends; the profile is not being read`);

  const ponte = LUGO_LANDMARKS.find((l) => l.name.includes('Ponte Romana'))!;
  const praza = LUGO_LANDMARKS.find((l) => l.name.includes('Praza Maior'))!;
  const up = await routeOnFoot([ponte.lat, ponte.lng], [praza.lat, praza.lng]);
  const down = await routeOnFoot([praza.lat, praza.lng], [ponte.lat, ponte.lng]);
  assert(up && down, 'no route between the bridge and the square');

  // Once a climb costs something the cheapest way up is not the cheapest way down, so the
  // two are held within a few per cent rather than pinned to the metre.
  const spread = Math.abs(up!.meters - down!.meters) / Math.max(up!.meters, down!.meters);
  assert(spread < 0.1, `${up!.meters} m up against ${down!.meters} m down is a different trip, not a different way up`);
  assert(up!.minutes > down!.minutes, `${up!.minutes} min up the hill against ${down!.minutes} min down it`);
});

ok('an itinerary has no minutes belonging to nothing', () => {
  // The transfer buffer was in the clock but in no segment: a bus arriving at 16:52 above a
  // wait starting at 16:56. It hid a worse thing: a wait starting at the buffered minute put
  // its ends backwards and a next-morning connection passed as a one-minute change.
  const points = [...BUS_STOPS.slice(0, 60).map((s) => s.name), ...LUGO_LANDMARKS.map((l) => l.name)];
  let seed = 987654321;
  const roll = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // Two fixed clocks: read off the real one, the third defect only existed in the minutes
  // before certain departures, so the check was green almost always and red for somebody else.
  const CLOCKS = [7 * 60 + 32, 13 * 60 + 40];

  // The pair that had it: two poles the timetable puts the bus at in the same minute, so the
  // leg printed "07:36 -> 07:36" above "1 min".
  const pairs: [string, string][] = [['Rúa industria (T. Pereira)', 'Rúa Industria (Sum. La Ronda)']];
  for (let i = 0; i < 120; i++) {
    const from = points[Math.floor(roll() * points.length)];
    const to = points[Math.floor(roll() * points.length)];
    if (from !== to) pairs.push([from, to]);
  }

  let options = 0;
  for (const minutes of CLOCKS) {
    const now = new Date(2026, 8, 9, Math.floor(minutes / 60), minutes % 60, 0, 0);
    for (const [from, to] of pairs) {
    for (const plan of planTrips(from, to, { lang: 'gl', now }).slice(0, 3)) {
      options++;
      const trip = `${from} -> ${to}`;

      const legs = plan.segments.reduce((n, s) => n + (s.durationMinutes ?? 0), 0);
      assert(legs === plan.durationMinutes, `${trip}: legs add to ${legs} min, the trip says ${plan.durationMinutes}`);

      // And each leg hands over to the next on the same minute, so there is nowhere for a
      // minute to hide even when the totals happen to agree.
      for (let k = 1; k < plan.segments.length; k++) {
        const ends = plan.segments[k - 1].arrivalTime;
        const starts = plan.segments[k].departureTime;
        assert(ends === starts, `${trip}: a ${plan.segments[k - 1].type} leg ends ${ends}, the next starts ${starts}`);
      }

      // No leg runs backwards. This is what the day-wrap was papering over.
      for (const s of plan.segments) {
        if (!s.departureTime || !s.arrivalTime) continue;
        const span = parseTimeToMinutes(s.arrivalTime) - parseTimeToMinutes(s.departureTime);
        assert(span >= 0 || span + 1440 === (s.durationMinutes ?? 0), `${trip}: a ${s.type} leg runs ${s.departureTime} to ${s.arrivalTime}`);
      }
    }
    }
  }
  assert(options > 400, `only ${options} options planned; the check is not checking`);
});

console.log('\nbasemap style');

/**
 * The two style files in src/data are generated by tools/buildMapStyle.ts. What follows is
 * the set of claims they make, each of which has been false at some point.
 */
const mapStyles = () => {
  return {
    light: JSON.parse(read('src/data/map-style-light.json')),
    dark: JSON.parse(read('src/data/map-style-dark.json')),
  } as Record<string, { version: number; sprite: string; glyphs: string; sources: Record<string, { attribution?: string }>; layers: { id: string; type: string; paint?: Record<string, unknown> }[] }>;
};

/** Relative luminance of #rrggbb, and the WCAG ratio between two of them. */
const relLum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

ok('the basemap style is still ours, and still credits who it came from', () => {
  for (const [theme, style] of Object.entries(mapStyles())) {
    assert(style.version === 8, `${theme}: style version is ${style.version}`);
    assert(style.layers.length > 40, `${theme}: only ${style.layers.length} layers survived`);

    // Tiles, sprites and glyphs stay on the one host the policy in src/security/csp.ts
    // admits. Pointing any of them elsewhere is a policy change, not a style change.
    for (const url of [style.sprite, style.glyphs]) {
      assert(url.startsWith('https://tiles.openfreemap.org/'), `${theme}: ${url} is not served by OpenFreeMap, so the policy would block it`);
    }
    // Their terms ask for the credit and the file carries it as well as the map control,
    // so a style lifted out of here on its own still says where it came from.
    for (const [name, source] of Object.entries(style.sources)) {
      const credit = source.attribution ?? '';
      for (const owed of ['OpenFreeMap', 'OpenMapTiles', 'openstreetmap.org/copyright']) {
        assert(credit.includes(owed), `${theme}: source ${name} does not credit ${owed}`);
      }
    }
  }
});

ok('no layer asks the sprite for an image it does not have', () => {
  // The published dark style names a sprite pattern the sprite does not have, so every load
  // logged an error and the woods came out unpainted. The generator deletes it; it stays gone.
  for (const [theme, style] of Object.entries(mapStyles())) {
    for (const layer of style.layers) {
      assert(!('fill-pattern' in (layer.paint ?? {})), `${theme}: ${layer.id} paints with a fill-pattern, which this sprite cannot supply`);
    }
  }
});

ok('the street names fade in both themes, not just the dark one', () => {
  // The two published styles name their layers differently, so the adjustment that hides
  // street names under our labels applied to the dark map only, forgiven in silence.
  const styles = mapStyles();
  const fades = (theme: string, ids: string[]) => {
    const byId = new Map(styles[theme].layers.map((l) => [l.id, l]));
    for (const id of ids) {
      const layer = byId.get(id);
      assert(layer, `${theme}: there is no layer called ${id} to fade`);
      const opacity = layer!.paint?.['text-opacity'];
      assert(Array.isArray(opacity) && JSON.stringify(opacity).includes('16.5'), `${theme}: ${id} does not fade out where the stop labels take over`);
    }
  };
  fades('dark', ['highway_name_other', 'highway_name_motorway']);
  fades('light', ['highway-name-minor', 'highway-name-major', 'highway-name-path']);
});

ok('nothing in the dark basemap competes with the line drawn on top of it', () => {
  const dark = mapStyles().dark;
  const byId = new Map(dark.layers.map((l) => [l.id, l]));
  const colour = (id: string, property: string): string => {
    const value = byId.get(id)?.paint?.[property];
    assert(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), `${id}: ${property} is ${String(value)}`);
    return value as string;
  };

  const ground = colour('background', 'background-color');

  // The routes are 6 px polylines with no casing, so only the gap between a line's colour and
  // the street keeps it visible; a raster-era brightness filter once left the faintest at
  // 1.15. The floor is 1.45 because the 11 sits at 1.46 and its badge needs 4.5:1 on it.
  for (const street of ['highway_minor', 'highway_major_inner', 'highway_motorway_inner']) {
    const under = colour(street, 'line-color');
    for (const line of BUS_LINES) {
      const ratio = contrast(line.color, under);
      assert(ratio >= 1.45, `line ${line.number} (${line.color}) is ${ratio.toFixed(2)} against ${street} (${under})`);
    }
  }

  // And the ladder underneath, so a park does not read as a block and a block does not
  // read as the ground. Each step was measured in the browser, not chosen.
  const steps: [string, string, number][] = [
    ['building', 'fill-color', 1.12],
    ['landcover_wood', 'fill-color', 1.12],
    ['landuse_park', 'fill-color', 1.12],
  ];
  for (const [id, property, least] of steps) {
    const ratio = contrast(colour(id, property), ground);
    assert(ratio >= least, `${id} is ${ratio.toFixed(2)} over the ground, which reads as the ground`);
  }

  // Labels are held to the text bar instead, because a label is there to be read.
  for (const id of ['highway_name_other', 'place_town', 'place_city', 'water_name']) {
    const ratio = contrast(colour(id, 'text-color'), ground);
    assert(ratio >= 4.5, `${id} writes at ${ratio.toFixed(2)} over the ground`);
  }
});

ok('the light basemap draws blocks rather than outlines', () => {
  // Published, a building's fill was 1.08 over the ground and its outline 1.24, so every
  // footprint was a wireframe and the town was the colour of the fields; both are checked.
  const light = mapStyles().light;
  const byId = new Map(light.layers.map((l) => [l.id, l]));
  const paint = (id: string, property: string): string => {
    const value = byId.get(id)?.paint?.[property];
    assert(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), `${id}: ${property} is ${String(value)}`);
    return value as string;
  };

  const ground = 'rgb(242,243,240)' === String(byId.get('background')?.paint?.['background-color'])
    ? '#f2f3f0'
    : String(byId.get('background')?.paint?.['background-color']);
  assert(/^#[0-9a-f]{6}$/i.test(ground), `the light ground is ${ground}, which this cannot measure`);

  const fill = paint('building', 'fill-color');
  assert(paint('building', 'fill-outline-color') === fill, 'a light building is outlined in a different colour from its fill, so a block reads as linework');
  const step = contrast(fill, ground);
  assert(step >= 1.15, `a light building is ${step.toFixed(2)} over the ground, which reads as the ground`);

  // And the ink still clears the bar non-text contrast asks for over that heavier mass.
  for (const line of BUS_LINES) {
    const ratio = contrast(line.color, fill);
    assert(ratio >= 3, `line ${line.number} (${line.color}) is ${ratio.toFixed(2)} over a light building`);
  }
});

ok('the basemap is not being amplified behind the palette', () => {
  // For months the dark map was painted through a brightness filter on the tile pane, so
  // every value in the style meant something else on screen.
  const css = read('src/index.css');
  const rule = css.match(/\.leaflet-tile-pane\s*\{[^}]*\}/);
  assert(!rule || !/filter\s*:/.test(rule[0]), `the tile pane is filtered again: ${rule?.[0].replace(/\s+/g, ' ')}`);
});

ok('an open dialog keeps the keyboard, the board keeps quiet, and an answer takes the focus', () => {
  // Three things a screen reader or a keyboard found on 14 September 2026 that no
  // contrast or target measurement could see.

  // With the menu open, fourteen Tab presses put focus on a button behind the drawer:
  // `aria-modal` hides the page from a screen reader, not from the Tab key.
  const dialog = read('src/hooks/useDialog.ts');
  assert(/event\.key !== 'Tab'/.test(dialog) && /event\.shiftKey/.test(dialog), 'useDialog no longer wraps Tab inside the overlay');

  // The arrivals lists were `aria-live`: the minute tick changed every row at once, so
  // each minute announced up to fifteen bare numbers with no line and no way to stop it.
  const board = read('src/components/StopArrivalsView.tsx');
  assert(!/<ul[^>]*aria-live/.test(board), 'an arrivals list is a live region again');

  // "Calcular ruta" unmounted the button under the focus, and the "no route" sentence sat
  // hidden behind the form on a phone; the answer column takes focus after every question.
  const planner = read('src/components/RoutePlannerView.tsx');
  assert(/ref=\{answerRef\}\s+tabIndex=\{-1\}/.test(planner), 'the answer column can no longer take focus');
  // One reducer holds the rule: answering folds the form and counts the question, and
  // the calculate handler goes through it rather than through three setters again.
  assert(/action === 'answer'\s*\?\s*\{ formOpen: false, asked: true, answered: state\.answered \+ 1 \}/.test(planner), 'answering no longer folds the form and counts the question in one move');
  assert(/ask\('answer'\);/.test(planner), 'the calculate handler no longer answers through the reducer');
});

ok('the map opens on nobody’s line, and a zoom step rebuilds only what the zoom changes', () => {
  // measure:browser had four zoom steps at 2,133-4,055 ms of blocked main thread against
  // a budget of 900. Three things, each of which would come back quietly.

  // The map started with line 1.1 chosen -- the lines screen's default, passed through --
  // so a fresh map drew a subject line with its arrows over a choice nobody had made.
  const app = read('src/App.tsx');
  assert(/useState<BusLine \| null>\(null\)/.test(app), 'App starts with a line selected again, and the map will draw it as chosen');

  // 26,175 vertices projected and stroked whole at every zoom; now the ones the zoom can
  // show, remembered per direction and zoom. And arrows only for the part in view.
  const routes = read('src/components/Map/RouteLayer.tsx');
  assert(/verticesAt\.set\(/.test(routes) && /LineUtil\.simplify\(/.test(routes), 'route vertices are no longer simplified per zoom before drawing');
  assert(/offsetPath\(\s*verticesFor\(/.test(routes), 'the offset runs over the full geometry again');
  assert(/reach\.contains\(at\)/.test(routes) && /map\.on\('moveend', placeArrows\)/.test(routes), 'arrows are built for the whole line again, not for the view');

  // Every bus icon was rebuilt every three seconds whether or not anything about it changed.
  const buses = read('src/components/Map/VehicleLayer.tsx');
  assert(/drawn\?\.icon !== iconKey/.test(buses), 'bus icons are rebuilt on every tick again');

  // The written stop names were permanent tooltips: a DOM element each, and a forced
  // layout each on every zoom -- the largest frame left once the three above were gone.
  const stopsLayer = read('src/components/Map/StopLayer.tsx');
  assert(/stopNamesLayer\(/.test(stopsLayer) && !/permanent: true/.test(stopsLayer), 'the stop names are DOM tooltips again');
});

ok('a page opened before a deploy reloads itself once when a chunk has gone', () => {
  // Every rebuild renames the hashed chunks and the service worker drops the old names, so a
  // page opened before a deploy failed to load the map. `vite:preloadError` reloads once.
  const main = read('src/main.tsx');
  assert(/addEventListener\('vite:preloadError'/.test(main), 'the entry no longer listens for a failed chunk load');
  assert(/location\.reload\(\)/.test(main), 'a failed chunk load no longer reloads the page');
  assert(/sessionStorage\.getItem\(key\) === target\) return/.test(main), 'the reload is no longer limited to once per address');
});

ok('the letter paints before the search rows do', () => {
  // The first keystroke scored the network and drew the rows in the same render as the
  // character; the rows come from a deferred copy of the query and are kept until it changes.
  const topBar = read('src/components/TopBar.tsx');
  assert(/useDeferredValue\(q\)/.test(topBar) && /useMemo\(\(\) => searchAll\(dq\), \[dq\]\)/.test(topBar), 'the search rows render in the same task as the keystroke again');
});

ok('what the phone hides behind a menu, the button says; the board answers before it asks', () => {
  // Three things a phone got wrong and a desktop did not, each of which would come back
  // as an unremarkable tidy-up: the notice count lived only inside the drawer; search rows
  // truncated the one part that told three poles of a street apart; and the "board at
  // another hour" picker pushed the first departure to the 479th pixel of an 812 px phone.
  const topBar = read('src/components/TopBar.tsx');
  assert(/alertCount > 0 && \(/.test(topBar), 'the phone menu button no longer carries the notice count');
  assert(/alertCount=\{alerts\.announcedIncidents\}/.test(read('src/App.tsx')), 'App no longer hands the notice count to the top bar');
  assert(!/className="block truncate[^"]*">\s*\{(stop|lm)\.name\}/.test(topBar), 'a search row truncates the stop or place name again');
  const board = read('src/components/StopArrivalsView.tsx');
  assert(board.indexOf('type="time"') > board.indexOf('{soon.map('), 'the time picker sits above the arrivals again');
});

ok('motion moves the interface, never a number; and the two things the first round got wrong', () => {
  // Nineteen small animations, all CSS; two came back wrong from the browser: the pressed
  // segment read as transparent to audit:browser (the thumb is a sibling), and a padded card
  // as the fold's grid item left a 30 px stub when folded to 0fr.
  const css = read('src/index.css');
  assert(/\.seg-on\s*\{[^}]*background:\s*var\(--c-ink\)/.test(css), 'the pressed segment no longer carries its own fill at rest');
  assert(/\.fold > \*\s*\{[^}]*overflow: hidden;[^}]*min-height: 0/.test(css), 'the fold item is no longer clipped and free to shrink');
  const planner = read('src/components/RoutePlannerView.tsx');
  const fold = planner.indexOf('className={`fold fold-lg-open fold-clear');
  assert(fold > 0 && /^\s*<div>\s*$/m.test(planner.slice(fold, planner.indexOf('rounded-card', fold))), 'the planner folds the padded card directly again: a 30 px stub when closed');
  // A rolling count is a live reading, and the only screen with one bus and one number is
  // the ride; the board, with fifteen changing at once, would read as tracked.
  assert(/anim-roll-in/.test(read('src/components/TripCompanionView.tsx')), 'the ride no longer rolls its one count');
  assert(!/anim-roll-in/.test(read('src/components/StopArrivalsView.tsx')), 'the arrivals board rolls its minutes: it reads as live');
  assert(/prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration: 0\.01ms !important/.test(css), 'reduced motion no longer stops the animations');
});

// Last on purpose: it counts itself. The README quoted 141 while this file ran 143, which
// is the kind of figure the front-doors rule exists for and the one nobody re-reads.
ok('the README quotes the number of checks this file runs', () => {
  const readme = read('README.md');
  const quoted = readme.match(/^(\d+) comprobacións con asercións/m)?.[1];
  assert(quoted === String(checks + 1), `README says ${quoted ?? 'nothing'} checks; this file runs ${checks + 1}`);
});

console.log(`\n${checks} checks passed\n`);
