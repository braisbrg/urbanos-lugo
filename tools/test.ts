/**
 * One runnable check per bug that was real once: `npm test`. A regression fails here
 * rather than in the browser, and each check names the bug it guards against.
 */
import assert from 'assert';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { BUS_STOPS, BUS_LINES } from '../src/data/transitData';
import { MAX_OPERATOR_REQUESTS_PER_MINUTE, CACHE_TTL_MS as OPERATOR_CACHE_MS, operatorTimesForStop, operatorTimesResponse, parseOperatorTimes } from '../src/services/operatorTimes';
import { dayWord, daysLabel, frequencyLabel } from '../src/utils/serviceLabels';
import { CSP_HEADER, CSP_META, THEME_INIT_HASH } from '../src/security/csp';
import { THEME_INIT_SOURCE, THEME_STORAGE_KEY } from '../src/security/themeInit';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { REPO_URL } from '../src/project';
import { ROOT_HEAD, SITE_LANGS, SITE_PATHS, canonicalUrl, pageHead, pageHtml, robotsTxt, siteUrl, sitemapXml, structuredData } from '../src/seo';
import { CACHE_TTL_MS as ALERTS_CACHE_MS, MIN_OUTBOUND_INTERVAL_MS as ALERTS_MIN_OUTBOUND_MS, extractAlertsFromHtml, extractConcelloNotices } from '../src/services/alertSyncService';
import { clockDriftFromTimetable, lugoOffsetByRule } from '../src/utils/clock';
import { MAX_QUERY_LENGTH, calculateRelevanceScore, matchesQuery, normalizeText, withinEditDistance } from '../src/utils/searchUtils';
import { LANGS, translations } from '../src/i18n';
import type { RoutePlanResult, ServiceAlert, TripSegment } from '../src/types';
import { tripProgress, rememberPassed, AT_STOP_RADIUS_M, MISSED_AFTER_MIN, BOARDING_SOON_MIN, boardingIsNow, startTrip, advanceTrip, tripPhase, currentLeg, legTimes, shouldAskIfMissed, confirmBoarded, missedBus, packTrip, unpackTrip } from '../src/utils/tripProgress';
import { ALARM_RADIUS_M, subscribePosition } from '../src/services/stopAlarm';
import { poleCode, FARES, linesByNumber } from '../src/data/transitData';
import { STALE_AFTER_MS, isSnapshotStale } from '../src/utils/snapshotAge';
import { MAX_PER_WINDOW, MAX_PLANS_PER_WINDOW, rateLimit } from '../src/security/rateLimit';
import { RECENT_ROUTES } from '../src/hooks/useStoredList';
import { SNAPSHOT_AFTER_MS, readSnapshot } from '../src/hooks/useServiceAlerts';
import { readOperatorTimes } from '../src/hooks/useOperatorTimes';
import { noticeLink } from '../src/utils/operatorNotices';
import { changesNow, matchStop, noticeOver, pastTimetable, readNoticeChanges, runsAt, runsUntil, serviceDay, setsOff, stopSkipper, underNotice } from '../src/utils/noticeChanges';
import { plainText } from '../src/utils/html';
import { STORAGE_KEYS, readJson, readString, writeJson, writeString } from '../src/utils/storage';
import { LANG_PREFIX, PATHS, SLUGS, isCrawler, parsePath, pathFor, pickLang } from '../src/routes';
import { fetchWalkingPath, walkHopKey, walkHopsOf, type WalkPaths } from '../src/services/walkingPath';
import { correctionFor, rankMeasured, withMeasuredWalk } from '../src/components/planner/walkCorrection';
import { routeOnFoot } from '../src/utils/walkRouter';
import { metresBetween } from '../src/utils/geo';
import { syncOfficialAlerts } from '../src/services/alertSyncService';
import { HOLIDAY_YEARS, buildRuns, dayKind, expandHeadway, handoverMinutes, isHoliday, isWithinServiceWindow, lineRunsOn, parseTimeToMinutes, formatMinutes, anchorIndex, isLineInService, scheduledDuration } from '../src/utils/schedule';
import { MAX_BODY_BYTES, readCapped } from '../src/services/readCapped';
import festivos from '../src/data/festivos.json';
import { holidaysDue } from './checkHolidaysAhead';
import { poleToRecord } from './importStopAmenities';
import { POLE_SEEN_AT_OSM } from './lib';
import { planTrips, MAX_HEADLINE_WALK_MIN, TRANSFER_BUFFER_MIN, TRANSFER_BUFFER_ESTIMATED_MIN, WALK_MUST_BEAT_BUS_BY_MIN } from '../src/utils/planner';
import { estimateWalk, getNearbyStops, NEARBY_STOP_LIMIT_METRES, getNearestStopToCoords, findStop, resolveLocationQuery, QUICK_DESTINATIONS, LUGO_LANDMARKS } from '../src/utils/places';
import { getArrivalsForStop, getNextLineDeparture, networkAtRest, nextServiceAtStop, timingPointStopCount } from '../src/utils/arrivals';
import { getScheduledBuses } from '../src/utils/vehicles';
import { getDistanceMeters } from '../src/utils/geo';
import { hydrateGeometry } from './hydrateGeometry';
import { overpass } from './osm';
import { rideTimeReport } from './validateRideTimes';

hydrateGeometry();

/**
 * Every gate is offline and deterministic (CLAUDE.md), and this file runs on every push.
 * A check that reaches somebody else's server is refused here and noted, so one swallowed
 * by a catch still fails at the end; checks that need an answer stub fetch and put this back.
 */
const reachedOut: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  reachedOut.push(String(input));
  throw new Error(`the suite tried to reach ${String(input)}; every gate runs offline`);
}) as typeof fetch;

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
  // The one other is a pole seen standing where OSM puts it (POLE_SEEN_AT_OSM, in lib.ts).
  const moved = BUS_STOPS.filter((s) => s.positionSource === 'osm');
  assert.deepStrictEqual(moved.map((s) => s.id).sort(), ['s1065', 's133'], `the stops with an OSM position are ${moved.map((s) => s.id).join(', ')}; two are known (s1065, s133), any other needs looking at`);
  const segade = moved.find((s) => s.id === 's1065')!;
  assert(/Monte Segade/.test(segade.name), `the repositioned stop is ${segade.id} ${segade.name}`);
  // Rúa Industria (Aula 9): its grey totem is on the north pavement, on OSM node 11134839623,
  // 43 m from the operator's pin, where there is nothing. The coordinate is the node's.
  const amenities = JSON.parse(read('data/stop-amenities.json'));
  const aula9 = moved.find((s) => s.id === 's133')!;
  assert(amenities.s133?.osmNode === 11134839623, `s133 is placed on OSM node ${amenities.s133?.osmNode}, not the pole seen on the street`);
  assert(aula9.lat === amenities.s133.position[0] && aula9.lng === amenities.s133.position[1], 's133 does not stand on the OSM node recorded for it');
  assert(Object.keys(POLE_SEEN_AT_OSM).every((id) => /\b20\d\d\b/.test(POLE_SEEN_AT_OSM[id]) && BUS_STOPS.some((s) => s.id === id && s.positionSource === 'osm')), 'a pole in POLE_SEEN_AT_OSM says nothing of when it was seen, or the build did not move it');
  const calde = BUS_LINES.find((l) => l.id === '11-Calde')!;
  for (const dir of calde.directions) {
    const i = dir.stops.indexOf(segade.id);
    const before = BUS_STOPS.find((s) => s.id === dir.stops[i - 1])!;
    const after = BUS_STOPS.find((s) => s.id === dir.stops[i + 1])!;
    const gapBefore = getDistanceMeters(before.lat, before.lng, segade.lat, segade.lng);
    const gapAfter = getDistanceMeters(segade.lat, segade.lng, after.lat, after.lng);
    assert(gapBefore > 300 && gapAfter > 300, `${dir.id}: Monte Segade is ${Math.round(gapBefore)} m from ${before.name} and ${Math.round(gapAfter)} m from ${after.name}`);
  }
  // The import that records the pole reads stops.json after the build, where a moved stop
  // already stands on it: a rerun dropped Monte Segade's position, and the next build put
  // it back on the mis-entered pin.
  const pole = { id: 1 };
  assert(poleToRecord({ positionSource: 'osm' }, { node: pole, d: 0 }) === pole, 'a rerun of the amenities import drops the pole a repositioned stop stands on');
  assert(poleToRecord({}, { node: pole, d: 1100 }) === pole, 'the amenities import no longer records a same-named pole far from the pin');
  assert(poleToRecord({}, { node: pole, d: 43 }) === null, 'the amenities import records a nearby pole as a position');
  assert(poleToRecord({ id: 's133' }, { node: pole, d: 43 }) === pole, 'the amenities import does not record the pole seen where OSM puts it');
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

  // Since the simplification of 20 September 2026 every map is built in one hook, and the
  // loop that looked for `L.map(` in Map/*.tsx found none and asserted nothing. So: exactly
  // one file builds a Leaflet map, and it gives each map the basemap, a name and its zoom
  // titles in the reader's language. The route map was born after the other two got theirs,
  // and said "Zoom in" under a Galician itinerary.
  const buildsAMap = (text: string) => {
    const leaflet = /import\s+(?:\*\s+as\s+)?(\w+)\s+from\s+'leaflet'/.exec(text)?.[1];
    return !!leaflet && new RegExp(`\\b${leaflet}\\.map\\(|new\\s+${leaflet}\\.Map\\(`).test(text);
  };
  const builders = sourcesUnder('src').filter((file) => buildsAMap(readFileSync(file, 'utf8'))).map(relative);
  assert.deepStrictEqual(builders, [join('src', 'hooks', 'useLeafletMap.ts')], `Leaflet maps are built in ${builders.join(', ') || 'no file'}; useLeafletMap is the one place that gives them a basemap, a name and translated controls`);
  const hook = read('src/hooks/useLeafletMap.ts');
  assert(/createBasemap\(/.test(hook), 'useLeafletMap builds a map without createBasemap, so it gets neither the basemap nor its attribution');
  assert(/setAttribute\('aria-label', region\)/.test(hook), 'the map hook no longer names its map, so each one is an unnamed tab stop');
  assert(/t\.map\.zoomIn/.test(hook) && /t\.map\.zoomOut/.test(hook), 'the map hook no longer titles the zoom buttons in the reader’s language');
  for (const file of readdirSync(mapDir).filter((f) => /\.tsx?$/.test(f) && f !== 'basemap.ts')) {
    assert(!/setPrefix\(/.test(readFileSync(join(mapDir, file), 'utf8')), `${file} sets the attribution prefix itself; that belongs in basemap.ts for all of them`);
  }
  for (const file of ['TransitMap.tsx', 'RouteMap.tsx', 'NearbyMiniMap.tsx']) {
    assert(/useLeafletMap\(/.test(readFileSync(join(mapDir, file), 'utf8')), `${file} no longer gets its map from useLeafletMap`);
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

ok('a hint that says "press the star" also says the name a screen reader gives it', () => {
  // WCAG 1.3.3. The three empty states said only "press the star", and the button is named
  // "Engadir a gardadas": a screen reader reads the name, never the shape, so the
  // instruction pointed at a control nobody listening could find.
  for (const lang of LANGS) {
    const t = translations(lang);
    for (const [hint, name] of [
      [t.stopHome.emptyBody, t.arrivals.fav],
      [t.favourites.noFavoriteStopsHint, t.arrivals.fav],
      [t.favourites.noFavoriteLinesHint, t.lines.saveLine],
    ]) {
      assert(hint.includes(name), `${lang}: "${hint}" points at the star without its name, "${name}"`);
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
  // The helpers take only a key declared in STORAGE_KEYS, which also names the store that
  // keeps it, so an undeclared key does not compile; this holds that table to the document.
  // A key mentioned anywhere in it used to be enough, so the trip could have moved to
  // localStorage, against what the document promises, with the check still green.
  const privacy = read('PRIVACY.md');
  const sections = {
    local: privacy.slice(privacy.indexOf('## Kept on your device'), privacy.indexOf('Two more are kept')),
    session: privacy.slice(privacy.indexOf('Two more are kept'), privacy.indexOf('## Your location')),
  };
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const said = (pattern: RegExp) => words.indexOf((privacy.match(pattern)?.[1] ?? '').toLowerCase());
  const counts = { local: said(/(\w+) things are saved in your browser's `localStorage`/), session: said(/(\w+) more are kept in `sessionStorage`/) };
  for (const store of ['local', 'session'] as const) {
    const kept = Object.entries(STORAGE_KEYS).filter(([, s]) => s === store).map(([key]) => key).sort();
    const listed = [...sections[store].matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort();
    assert(kept.length > 0, `no key is kept in ${store}Storage, so this is reading the wrong table`);
    assert.deepStrictEqual(listed, kept, `PRIVACY.md's ${store}Storage table lists [${listed.join(', ')}]; the app keeps [${kept.join(', ')}] there`);
    assert(counts[store] === kept.length, `PRIVACY.md counts ${counts[store]} keys in ${store}Storage; the app keeps ${kept.length}`);
  }

  // Every key is spelled `urbanos-lugo-…` or `urbanos_lugo_…`, so the spelling is scanned for,
  // in any quote: a key the helpers never see -- the pre-paint script, the reload guard --
  // is still a key, and still belongs in the table.
  for (const full of sourcesUnder('src')) {
    for (const m of readFileSync(full, 'utf8').matchAll(/['"`](urbanos[-_]lugo[-_][a-z_-]+)['"`]/g)) {
      assert(m[1] in STORAGE_KEYS, `${relative(full)} spells the storage key ${m[1]}, which STORAGE_KEYS does not declare`);
    }
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

  // The approach is where a second ring would be heard: fixes inside the alarm radius, short
  // of the pole. With the once-a-leg guard taken out it rang on every fix, and the walk above
  // never noticed, because at the pole the cursor has already moved on to the next leg.
  let approach = advanceTrip(startTrip(plan, null, null), tripProgress(plan, at(ride1[1]), new Set())).state;
  const pole = ride1[ride1.length - 1];
  const rang = [0.0016, 0.001].map((north) => {
    const step = advanceTrip(approach, tripProgress(plan, { lat: pole.lat + north, lng: pole.lng }, new Set(approach.seen)));
    approach = step.state;
    return step.ring;
  });
  assert(rang.filter(Boolean).length === 1, `two fixes approaching the alighting pole rang ${rang.filter(Boolean).length} times`);
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
  // DECIDIDO.md: one position watch for the whole app. The map's "follow me" kept a second
  // one, beside the two files this looked at; now stopAlarm.ts is the only caller anywhere.
  const watchers = sourcesUnder('src').filter((file) => /watchPosition\(/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))).map(relative);
  assert.deepStrictEqual(watchers, [join('src', 'services', 'stopAlarm.ts')], `the GPS is watched from ${watchers.join(', ')}; the app has one watch, in stopAlarm.ts`);
});

await okAsync('the one position watch serves every listener, and a late one gets the last fix', async () => {
  // The map joined the board's alarm and the ride on one watch. What that has to keep: one
  // watchPosition however many listen, every fix to every listener, the last fix at once to
  // one that joins a running watch -- a phone standing still may not report again for a
  // while -- and the watch cleared, and forgotten, when the last listener leaves.
  const g = globalThis as unknown as { navigator: { geolocation?: unknown } };
  const calls = { watch: 0, clear: 0 };
  let report: ((pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) | null = null;
  Object.defineProperty(g.navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (onFix: typeof report) => ((report = onFix), ++calls.watch),
      clearWatch: () => void calls.clear++,
    },
  });
  // Read through calls: after one assert TypeScript narrows a count to a literal and rejects the next.
  const watches = () => calls.watch;
  const clears = () => calls.clear;
  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
  try {
    const board: number[] = [];
    const ride: number[] = [];
    const offBoard = subscribePosition((fix) => board.push(fix.lat), () => {});
    const offRide = subscribePosition((fix) => ride.push(fix.lat), () => {});
    assert(watches() === 1, `two listeners opened ${watches()} watches`);
    report!({ coords: { latitude: 43.01, longitude: -7.55, accuracy: 12 } });
    assert(board[0] === 43.01 && ride[0] === 43.01, 'a fix did not reach every listener');
    const map: { lat: number; accuracy: number }[] = [];
    const offMap = subscribePosition((fix) => map.push(fix), () => {});
    await flush();
    assert(watches() === 1 && map[0]?.lat === 43.01 && map[0].accuracy === 12, `a listener joining a running watch got ${JSON.stringify(map)} and the watch was opened ${watches()} times`);
    offBoard();
    offRide();
    assert(clears() === 0, 'the watch was cleared while the map was still listening');
    offMap();
    assert(clears() === 1, 'the watch outlived its last listener');
    // A new watch has no fix yet, and the second listener to join it must not be handed the
    // old one: an hour-old position read as where the phone is now.
    const later: number[] = [];
    const offLater = subscribePosition((fix) => later.push(fix.lat), () => {});
    const offAnother = subscribePosition((fix) => later.push(fix.lat), () => {});
    await flush();
    assert(watches() === 2 && later.length === 0, 'a new watch handed out a fix from the last one');
    offLater();
    offAnother();
  } finally {
    delete g.navigator.geolocation;
  }
});

ok('the places that ask for a position are the ones PRIVACY.md lists', () => {
  // PRIVACY.md names each place the app asks where you are, and said four while the map's
  // "my location" made five. Each file that asks is pinned to the words PRIVACY.md uses for
  // it: a sixth fails here until the page, and this table, say so.
  const PLACES: Record<string, string> = {
    [join('src', 'components', 'StopHome.tsx')]: '"stops near me"',
    [join('src', 'components', 'RoutePlannerView.tsx')]: '"use my GPS location"',
    [join('src', 'components', 'Map', 'useFollowMe.ts')]: '"my location"** on the map',
    [join('src', 'components', 'StopArrivalsView.tsx')]: '**arrival alarm**',
    [join('src', 'hooks', 'useTripCompanion.ts')]: '"Vou nesta"',
  };
  const asking = sourcesUnder('src')
    .filter((file) => !file.endsWith(join('services', 'stopAlarm.ts')))
    .filter((file) => /getCurrentPosition\(|subscribePosition\(|watchForStop\(|watchPosition\(/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
    .map(relative)
    .sort();
  assert.deepStrictEqual(asking, Object.keys(PLACES).sort(), `the position is asked for in ${asking.join(', ')}; PRIVACY.md lists ${Object.keys(PLACES).length} places`);
  const privacy = read('PRIVACY.md').replace(/\s+/g, ' ');
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  assert(privacy.includes(`asks for it in ${words[asking.length]} places`), `PRIVACY.md does not say the app asks in ${words[asking.length]} places`);
  for (const [file, label] of Object.entries(PLACES)) assert(privacy.includes(label.replace(/\s+/g, ' ')), `PRIVACY.md no longer names ${label}, where ${file} asks`);
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
  const realLog = console.log;
  const down = (() => Promise.reject(new Error('offline'))) as typeof fetch;
  const up = (async () => new Response('<html><body></body></html>', { status: 200 })) as typeof fetch;
  // An hour past whatever the previous check left in the module's cache, so it is expired
  // whichever way it went.
  const t0 = Date.now() + 60 * 60_000;
  // `up` answers the council's feed too, and the read's line went into every deploy log
  // ahead of the real one: "council feed read in 0 ms" where the real read had failed.
  console.log = () => {};
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
    console.log = realLog;
  }
});

await okAsync('the council’s feed cannot hold the operator’s notices back, and says how its read went', async () => {
  // Read after the operator's page and allowed 15 s, a feed that would not connect held the
  // operator's notices back with it: the worker took 16 s to answer on 6 October 2026. And
  // the failed read became an empty list without a word, the same as a feed with nothing in it.
  const realFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  const realWarn = console.warn;
  const deadlines = new Map<AbortSignal, number>();
  const warned: string[] = [];
  let allowed = Infinity;
  AbortSignal.timeout = (ms: number) => {
    const signal = realTimeout.call(AbortSignal, ms);
    deadlines.set(signal, ms);
    return signal;
  };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (!url.includes('concellodelugo.gal')) return new Response('<html><body></body></html>', { status: 200 });
    allowed = deadlines.get(init?.signal as AbortSignal) ?? Infinity;
    throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
  }) as typeof fetch;
  console.warn = (line: string) => void warned.push(line);
  try {
    // Two hours ahead, past whatever the check above left in the module's cache.
    const result = await syncOfficialAlerts(true, Date.now() + 2 * 60 * 60_000);
    assert(result.status !== 'unreachable', 'a council feed that would not connect took the operator’s answer down with it');
    assert(allowed <= 5_000, `the council’s feed may hold the operator’s notices back ${allowed} ms`);
    assert(warned.some((line) => line.includes('council feed') && line.includes('UND_ERR_CONNECT_TIMEOUT')), `a failed council read left no line: ${warned.join(' | ') || 'nothing warned'}`);
  } finally {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
    console.warn = realWarn;
  }
});

ok('what the API sends is read, not trusted: text as text, and links only to the two notice sites', () => {
  // The snapshot was narrowed but the live answer went to the screen as sent, and so did the
  // operator's minutes: a malformed answer could take a screen down, and any link was
  // followed. The council feed's own <link> was relayed unread on the server too.
  for (const good of ['https://buslugo.com/', 'https://buslugo.com/aviso', 'https://www.concellodelugo.gal/es/x']) assert(noticeLink(good) === good, `${good} was refused`);
  for (const bad of ['http://buslugo.com/', 'javascript:alert(1)', 'https://buslugo.com.example.net/', 'https://evilbuslugo.com/', 'data:text/html,x', '//buslugo.com/x', 7]) {
    assert(noticeLink(bad) === undefined, `${String(bad)} was let through as a notice link`);
  }
  const hostile = readSnapshot({
    status: 'active_incidents',
    lastSyncTime: 5,
    message: { a: 1 },
    alerts: [null, 'x', { title: { html: 1 }, linesAffected: '1.1', sections: [{ heading: 3, paragraphs: 'p' }, 'x'], link: 'https://example.net/', severity: 'boom', source: 'someone' }],
  });
  assert(hostile.alerts.length === 1 && hostile.lastSyncTime === '' && hostile.message === '', 'a malformed answer was not narrowed');
  const [notice] = hostile.alerts;
  assert(notice.title === '' && notice.linesAffected.length === 0 && notice.link === undefined && notice.severity === 'info' && notice.source === undefined, `a hostile notice came through: ${JSON.stringify(notice)}`);
  assert(notice.sections?.length === 1 && notice.sections[0].heading === '' && notice.sections[0].paragraphs.length === 0, 'a hostile section came through');
  assert(readSnapshot('nonsense').status === 'operational_normal' && readSnapshot(null).alerts.length === 0, 'an answer that is not an object was not narrowed');

  const day = new Date().toUTCString();
  const feed = (link: string) => `<rss><channel><item><title>Corte de tráfico na rúa</title><pubDate>${day}</pubDate><link>${link}</link></item></channel></rss>`;
  assert(extractConcelloNotices(feed('https://concellodelugo.gal/es/noticia'))[0]?.link === 'https://concellodelugo.gal/es/noticia', 'the council feed lost its own link');
  assert(extractConcelloNotices(feed('https://example.net/'))[0]?.link === undefined, 'the council feed relayed a link to another site');

  const times = readOperatorTimes({ code: 'Zjge', fetchedAt: 'x', departures: [{ line: '6', towards: 'Ronda', minutes: 8 }, { line: { x: 1 }, towards: 'a', minutes: 1 }, { line: '7', towards: 'b', minutes: 'soon' }, null] });
  assert(times?.departures.length === 1 && times.departures[0].line === '6', `malformed departures reached the board: ${JSON.stringify(times)}`);
  assert(readOperatorTimes({ departures: 'none' }) === null && readOperatorTimes('x') === null, 'an answer with no list of departures was not refused');
  // And the two hooks read what they fetch through these, rather than casting it.
  assert(/setData\(readSnapshot\(await res\.json\(\)\)\)/.test(read('src/hooks/useServiceAlerts.ts')), 'the live notices answer reaches the screen unread again');
  assert(/readOperatorTimes\(await res\.json\(\)\)/.test(read('src/hooks/useOperatorTimes.ts')), 'the operator’s minutes reach the board unread again');
});

/** The San Froilán 2026 notice as the worker served it, the parts that change something. */
const SAN_FROILAN: ServiceAlert = {
  id: 'nav-notice-1',
  title: 'Cambios en las líneas por San Froilán',
  description: 'Refuerzo de transporte urbano los días 3, 4, 5, 9, 10, 11 y 12 de octubre',
  severity: 'warning',
  linesAffected: ['Todas'],
  date: '2026-10-07',
  active: true,
  source: 'operator',
  sections: [
    {
      heading: 'Línea 1.2 : Campus USC – Fingoi – O Ceao – HULA',
      lines: ['1.2'],
      paragraphs: [
        'Prolongación del recorrido hasta las 03:07 (Sindicatos), suprimiendo su recorrido por el HULA y Avda. Benigno Rivera proseguirá por Avda. Infanta Elena, Avenida Paulo Favio Máximo siguiendo su recorrido habitual. Se suprime la parada de Praza de Bretaña y se habilitará una en Celso Emilio Ferreiro esquina Avda. Ramón Ferreiro',
      ],
    },
    {
      heading: 'Línea 10 : Ramón Ferreiro – Cementerio',
      lines: ['10'],
      paragraphs: [
        'Modificación de la parada Avda. Ramón Ferreiro (Femenino) pasará a ubicarse provisionalmente en Avda. Ramón Ferreiro, 14',
        'Los días 5 y 12 de octubre el final del servicio tendrá lugar a la 1:00 del día siguiente',
      ],
    },
    {
      heading: 'Línea 13 : Rda. Muralla (Sindicatos) – As Gándaras',
      lines: ['13'],
      paragraphs: ['Prolongación del recorrido hasta las 03:00 (Cementerio)', 'Los días 5 y 12 de octubre el final del servicio tendrá lugar a la 1:00 del día siguiente'],
    },
    {
      heading: 'Resto de líneas',
      lines: [],
      paragraphs: ['Corte desde Rda. Muralla (Porta Santiago): desvío por rúa Santiago.', 'Paradas provisionales:'],
    },
  ],
};

ok('an operator notice becomes changes the app uses: stops closed and moved, lines running late, on its own days', () => {
  // San Froilán 2026 ran five lines to 03:00 and past, closed a stop for two of them and
  // moved one for another, on seven named days. The app showed the notice and nothing else:
  // its boards said "no buses" at one in the morning, and the planner sent people to a stop
  // the 1.2 and the 1.4 did not call at.
  const changes = readNoticeChanges([SAN_FROILAN], 2026);
  assert(changes, 'a notice with three lines of changes read as none');
  assert(changes.days.join(' ') === '2026-10-03 2026-10-04 2026-10-05 2026-10-09 2026-10-10 2026-10-11 2026-10-12', `the notice's days came out as ${changes.days.join(' ')}`);
  const line = (n: string) => changes.lines.find((c) => c.line === n);
  assert(line('1.2')?.until?.time === '03:07' && line('1.2')?.until?.to === 'Sindicatos', 'the 1.2 lost its 03:07 to Sindicatos');
  assert(
    line('1.2')?.closed[0]?.stopId === 's15' && line('1.2')?.closed[0]?.instead === 'Celso Emilio Ferreiro esquina Avda. Ramón Ferreiro',
    `the 1.2's closed stop came out as ${JSON.stringify(line('1.2')?.closed)}: the abbreviation's period cut the replacement short once`,
  );
  assert(line('10')?.moved[0]?.stopId === 's71' && line('10')?.moved[0]?.to === 'Avda. Ramón Ferreiro, 14', `the 10's moved stop came out as ${JSON.stringify(line('10')?.moved)}`);
  assert(line('13')?.until?.time === '03:00' && line('13')?.endsEarly?.time === '01:00' && line('13')?.endsEarly?.days.join(' ') === '2026-10-05 2026-10-12', 'the 13 lost its 03:00 or its early end on the 5th and the 12th');
  assert(changes.general.length === 2, 'the part for every other line was not kept');

  // The night belongs to the day it began on, and a day the notice does not name has nothing.
  assert(changesNow(changes, new Date(2026, 9, 8, 12, 0)) === null, 'the notice applied on the 8th, a day it does not name');
  assert(serviceDay(new Date(2026, 9, 10, 2, 0)) === '2026-10-09' && changesNow(changes, new Date(2026, 9, 10, 2, 0)) !== null, 'two in the morning of the 10th was not still the night of the 9th');
  assert(runsUntil(line('13')!, new Date(2026, 9, 10, 23, 30))?.time === '03:00' && runsUntil(line('13')!, new Date(2026, 9, 12, 23, 30))?.time === '01:00', 'the 13 ran to the wrong hour on the 10th or the 12th');
  assert(runsUntil(line('10')!, new Date(2026, 9, 10, 23, 30)) === undefined && runsUntil(line('10')!, new Date(2026, 9, 12, 23, 30))?.time === '01:00', 'the 10 ran late on a night the notice gives it no extension, or not on the 12th');
  assert(!runsAt(line('1.2')!, new Date(2026, 9, 10, 3, 10)) && runsAt(line('13')!, new Date(2026, 9, 10, 0, 30)), 'a line ran past its notice end, or stopped before it');
  // Read night by night against the live notice: at 05:30 on the 10th, before the first bus,
  // the banner said five lines kept running; at 04:00 a board said the 9 ran until 03:15; on
  // the 12th the 13's 01:00 end borrowed «(Cementerio)» from the 03:00 one; the 10 came after the 12.
  assert(!runsAt(line('1.2')!, new Date(2026, 9, 10, 5, 30)) && runsAt(line('1.2')!, new Date(2026, 9, 10, 23, 30)), 'a festival morning before the first bus read as the festival night');
  assert(runsUntil(line('1.2')!, new Date(2026, 9, 11, 3, 0))?.time === '03:07' && runsUntil(line('1.2')!, new Date(2026, 9, 11, 4, 0)) === undefined, 'an end time already gone was still announced');
  assert(runsUntil(line('13')!, new Date(2026, 9, 10, 23, 30))?.to === 'Cementerio' && runsUntil(line('13')!, new Date(2026, 9, 12, 23, 30))?.to === undefined, 'the early end was given the place written with the late one');
  const backwards = readNoticeChanges([{ ...SAN_FROILAN, sections: [...SAN_FROILAN.sections!].reverse() }], 2026);
  assert(backwards?.lines.map((c) => c.line).join(' ') === '1.2 10 13', `the lines came out in the notice's order, ${backwards?.lines.map((c) => c.line).join(' ')}`);
  // From a line's last printed call at a stop the notice is the only answer the board has, so
  // it is said there unfolded; not before, not after its end, and not on a night it does not extend.
  const head13 = BUS_LINES.find((l) => l.number === '13')!.directions[0].stops[0];
  const head10 = BUS_LINES.find((l) => l.number === '10')!.directions[0].stops[0];
  assert(!pastTimetable(line('13')!, head13, new Date(2026, 9, 10, 20, 0)), 'the 13 was handed to the notice while its timetable still ran');
  assert(pastTimetable(line('13')!, head13, new Date(2026, 9, 10, 23, 30)) && pastTimetable(line('13')!, head13, new Date(2026, 9, 11, 2, 0)), 'the 13 past its last printed call was not handed to the notice');
  assert(!pastTimetable(line('13')!, head13, new Date(2026, 9, 11, 3, 30)) && !pastTimetable(line('13')!, head13, new Date(2026, 9, 10, 5, 30)), 'the notice spoke for the 13 after its end, or on the morning before');
  assert(!pastTimetable(line('10')!, head10, new Date(2026, 9, 10, 23, 30)) && pastTimetable(line('10')!, head10, new Date(2026, 9, 12, 23, 30)), 'the 10 was handed to the notice on a night it does not extend, or not on the 12th');

  // A name in the notice is a stop only when it clearly is one, among the line's own.
  const ofLine = (id: string) => BUS_STOPS.filter((s) => s.lines.includes(id));
  assert(matchStop('Praza de Bretaña', ofLine('1.2')) === 's15', '«Praza de Bretaña» is not «Praza Bretaña» any more');
  assert(matchStop('Avda. Ramón Ferreiro (Femenino)', ofLine('10')) === 's71', '«(Femenino)» did not find «(Feminino)», or found «(Anexa)»');
  assert(matchStop('Rúa que non existe', ofLine('10')) === undefined, 'a stop nobody serves was matched to one');
});

ok('the planner never boards or leaves a line at a stop the notice closes', () => {
  // The 1.2 and the 1.4 did not call at Praza Bretaña on San Froilán; the planner proposed
  // boarding the 1.4 there all the same.
  const now = new Date(2026, 9, 9, 10, 0);
  const legs = (skipsStop?: (lineId: string, stopId: string) => boolean) =>
    planTrips('Praza Bretaña', 'Benigno Rivera (H. Ferreiro)', { now, skipsStop }).flatMap((p) => p.segments.filter((s) => s.type === 'bus'));
  const atBretana = (s: TripSegment) => s.fromStop?.id === 's15' || s.toStop?.id === 's15';
  assert(legs().some((s) => s.line?.id === '1.4' && atBretana(s)), 'with nothing closed no plan boards the 1.4 at Praza Bretaña, so this check proves nothing');
  const closed = legs((lineId, stopId) => stopId === 's15' && (lineId === '1.2' || lineId === '1.4'));
  assert(!closed.some((s) => (s.line?.id === '1.2' || s.line?.id === '1.4') && atBretana(s)), 'a plan still boards or leaves the 1.2 or the 1.4 at the closed stop');
  assert(closed.some((s) => atBretana(s)), 'closing the stop for two lines closed it for every line');
  // And what the screens are given is what the notice says: the predicate comes from it.
  const skips = stopSkipper(readNoticeChanges([SAN_FROILAN], 2026), now);
  assert(skips?.('1.2', 's15') && !skips('1.1', 's15') && stopSkipper(readNoticeChanges([SAN_FROILAN], 2026), new Date(2026, 9, 8, 10, 0)) === undefined, 'the notice closes the wrong lines, or closes them on a day it does not name');
  const planner = read('src/components/RoutePlannerView.tsx');
  assert((planner.match(/underNotice\(changes, [^,]+, \(skipsStop\) => planTrips\(/g) ?? []).length === 3, 'a planTrips call on the Route screen ignores the notice');

  // Under the notice of the night the trip is on, not of the moment it is asked. Asked at 01:00
  // on the 13th, the night was still the 12th's and the planner kept the 1.2 off Praza Bretaña
  // for the 07:10 of a morning the notice no longer names; at 23:50 on the 8th, the other way.
  const changes = readNoticeChanges([SAN_FROILAN], 2026);
  const asked = (from: Date, departureTime: string, daysAhead: number) => {
    const seen: boolean[] = [];
    const result = underNotice(changes, from, (skipsStop) => {
      seen.push(!!skipsStop?.('1.2', 's15'));
      return [{ departureTime, daysAhead }];
    });
    return { seen: seen.join(' '), leaves: setsOff(result[0], from) };
  };
  assert(asked(new Date(2026, 9, 13, 1, 0), '07:10', 0).seen === 'true false', 'a trip the morning after the festival was planned with the festival night closed');
  assert(asked(new Date(2026, 9, 8, 23, 50), '07:00', 1).seen === 'false true', 'the first bus of a festival day was planned with the stop open');
  assert(asked(new Date(2026, 9, 10, 10, 0), '10:15', 0).seen === 'true', 'a trip on the night it is asked was planned twice');
  assert(setsOff({ departureTime: '00:10', daysAhead: 0 }, new Date(2026, 9, 10, 23, 50)).getDate() === 11, 'a departure past midnight was read as the morning of the day asked');
});

ok('a notice whose own days are over leaves the app as it was', () => {
  // San Froilán ended on the 12th; nothing says the operator takes the notice down on the 13th.
  // Left up, its strip, its count in the badge and its card in Avisos stayed on, a week later.
  assert(!noticeOver(SAN_FROILAN, new Date(2026, 9, 8, 10, 0)), 'a notice with days still to come was over');
  assert(!noticeOver(SAN_FROILAN, new Date(2026, 9, 12, 23, 0)) && !noticeOver(SAN_FROILAN, new Date(2026, 9, 13, 2, 0)), 'the last festival night was over before it ended');
  assert(noticeOver(SAN_FROILAN, new Date(2026, 9, 13, 6, 0)), 'the morning after the last day, the notice still held');
  assert(!noticeOver({ ...SAN_FROILAN, description: 'Cambios en el servicio', title: 'Aviso' }, new Date(2027, 5, 1)), 'a notice that names no day ended by itself');
  const newYear = { ...SAN_FROILAN, description: 'Servicio especial los días 1 y 2 de enero', title: 'Año nuevo' };
  assert(!noticeOver(newYear, new Date(2026, 11, 30, 12, 0)) && noticeOver(newYear, new Date(2027, 0, 3, 12, 0)), 'a January notice read in December was taken as this January, already gone');
  const newYearsEve = { ...SAN_FROILAN, description: 'Servicio especial los días 30 y 31 de diciembre', title: 'Fin de año' };
  assert(noticeOver(newYearsEve, new Date(2027, 0, 2, 12, 0)) && !noticeOver(newYearsEve, new Date(2026, 11, 29, 12, 0)), 'a December notice read in January was taken as next December');
  // Everywhere at once, from the one place every screen reads the notices.
  assert(/alerts: data\.alerts\.filter\(\(a\) => !noticeOver\(a, now\)\)/.test(read('src/hooks/useServiceAlerts.ts')) && /useServiceAlerts\(now\)/.test(read('src/App.tsx')), 'a notice whose days are over still reaches the screens');
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

  // The word list above knows twenty-five words, and only on a line of its own: `<p>Tarifas</p>`
  // started with "<" and was let through, and so were "Próximos buses" and an English
  // aria-label. So, in the views, any words between a tag and the next tag or expression,
  // and any literal accessible name, title, placeholder or alt, in whatever language. The
  // exceptions are names, which stay as their owners write them.
  const NAMES = ['buslugo.com', 'Concello de Lugo - Mobilidade: 982 29 74 00', 'Monbus Lugo: 982 24 16 00'];
  for (const file of sourcesUnder('src').filter((f) => f.endsWith('.tsx') && !f.split(sep).includes('i18n'))) {
    const code = readFileSync(file, 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, (comment) => comment.replace(/[^\n]/g, ''));
    const at = (index: number) => `${relative(file)}:${code.slice(0, index).split('\n').length}`;
    // Not after `=` or `-`, which make `=>` and `->`; code between them (`a > b && c <`) has operators in it.
    for (const m of code.matchAll(/(?<![=-])>([^<>{}]*)(?=[<{])/g)) {
      const text = m[1].trim();
      if (/\p{L}{2,}/u.test(text) && !/[=;()&|?`$]/.test(text) && !NAMES.includes(text)) offenders.push(`${at(m.index)}  ${text.slice(0, 54)}`);
    }
    for (const m of code.matchAll(/\b(aria-label|aria-description|title|placeholder|alt|label)="([^"]*)"/g)) {
      if (/\p{L}{2,}/u.test(m[2]) && !m[2].includes('${')) offenders.push(`${at(m.index)}  ${m[1]}="${m[2].slice(0, 40)}"`);
    }
  }

  assert(offenders.length === 0, `text typed straight into the markup instead of coming from the dictionary:\n  ` + offenders.join('\n  '));
});

console.log('\nuntested corners');

ok('a service window that crosses midnight is not read as finished', () => {
  // A night line running 22:30 to 06:30 has a window ending before it starts, and the naive
  // comparison called it closed all day. (The "no service" banner no longer reads this: it
  // reads the runs, yesterday's included -- see networkAtRest.)
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

await okAsync('an Overpass that cannot be reached is no answer, not a crash', async () => {
  // The retry knew HTTP statuses only. A connection that never opened threw past it and
  // failed the weekly geometry check, which is written to skip when Overpass is down.
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const warned: string[] = [];
  globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } }))) as typeof fetch;
  console.warn = (line: string) => void warned.push(line);
  try {
    assert((await overpass('[out:json];', 1)) === null, 'a connection that never opened escaped overpass() instead of coming back as no answer');
    assert(warned.some((line) => line.includes('ETIMEDOUT')), `the reason never reached the log: ${warned.join(' | ') || 'nothing warned'}`);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
});

await okAsync('when Overpass will not answer, a second instance is asked the same question', async () => {
  // FOSSGIS's instance refused connections on 28 September 2026 and answered 504 on
  // 5 October. With nowhere else to ask, the weekly check went two Mondays without
  // comparing a single route.
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const asked: { host: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    asked.push({ host, body: String(init?.body) });
    return host === 'overpass-api.de' ? new Response('', { status: 504 }) : new Response('{"elements":[]}', { status: 200 });
  }) as typeof fetch;
  console.warn = () => {};
  try {
    const json = await overpass('[out:json];', 1);
    assert(Array.isArray(json?.elements), 'the second instance answered and overpass() still came back with nothing');
    const hosts = asked.map((a) => a.host);
    assert(hosts.length === 2 && hosts[0] === 'overpass-api.de' && hosts[1] !== hosts[0], `asked ${hosts.join(', ')}: FOSSGIS first, then one other`);
    assert(asked[0].body === asked[1].body, 'the second instance was asked a different question');
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
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
      bySource.set(src, [...(bySource.get(src) ?? []), `${line.number} towards ${d.destination}`]);
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

ok('the service worker may fetch every host it caches for', () => {
  // Sent as a header, the policy is the service worker's too, and the worker re-fetches what
  // it caches with fetch(), which answers to connect-src. The raster tiles were allowed as
  // images and not as connections: on a self-hosted server, once the worker took over, every
  // raster tile was refused and a map that had fallen back to raster was an empty grey box.
  const connect = CSP_HEADER.match(/connect-src ([^;]+)/)?.[1].split(/\s+/) ?? [];
  const patterns = [...read('vite.config.ts').matchAll(/urlPattern: \/\^https:\\\/\\\/\(([^)]+)\)/g)].map((m) => m[1]);
  assert(patterns.length > 0, 'found no cross-origin runtime cache in vite.config.ts, so this is reading the wrong thing');
  for (const host of patterns.flatMap((p) => p.split('|')).map((h) => h.replace(/\\\./g, '.'))) {
    assert(connect.includes(`https://${host}`), `the service worker caches ${host} but connect-src does not let it fetch there`);
  }
});

ok('a cached map tile costs the phone its own size, not megabytes', () => {
  // Chrome charges an opaque response against the site's storage at megabytes whatever its
  // size. The raster tiles were fetched without CORS, so each was opaque, and the tile cache
  // kept responses with status 0: six raster tiles cost 38 MB of quota where ten vector tiles
  // cost 3, with room for 600. OSM's tile servers answer CORS, so the tiles ask for it and
  // nothing opaque is kept.
  assert(/L\.tileLayer\(OSM_FALLBACK_TILES, \{[^}]*crossOrigin: true/.test(read('src/components/Map/basemap.ts')), 'the raster tiles are fetched without CORS again, so each is an opaque response');
  const config = read('vite.config.ts');
  const tiles = config.slice(config.indexOf("cacheName: 'map-tiles'"), config.indexOf('}', config.indexOf('cacheableResponse', config.indexOf("cacheName: 'map-tiles'"))) + 1);
  assert(/cacheableResponse: \{ statuses: \[200\] \}/.test(tiles), `the tile cache keeps opaque responses again: ${tiles.slice(tiles.indexOf('cacheableResponse')).split('\n')[0]}`);
});

ok('a browser that refuses site data still gets the app', () => {
  // With site data blocked, reading window.localStorage throws SecurityError. The helpers
  // took the store as a default parameter, which is evaluated before the try, so the first
  // read -- the language, in App's first render -- threw and the page stayed blank.
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = ['localStorage', 'sessionStorage'].map((name) => [name, Object.getOwnPropertyDescriptor(g, name)] as const);
  for (const [name] of saved) {
    Object.defineProperty(g, name, { configurable: true, get: () => { throw new Error(`SecurityError: Failed to read the '${name}' property`); } });
  }
  const survives = <T>(what: string, run: () => T): T => {
    try {
      return run();
    } catch (error) {
      throw new assert.AssertionError({ message: `${what} threw with site data refused, which blanks the page: ${(error as Error).message}` });
    }
  };
  try {
    assert.strictEqual(survives('reading the language', () => readString('urbanos-lugo-lang')), null);
    assert.strictEqual(survives('reading the trip', () => readString('urbanos-lugo-trip')), null);
    assert.deepStrictEqual(survives('reading the favourites', () => readJson('urbanos_lugo_fav_stops', [])), []);
    survives('saving the theme', () => writeString('urbanos-lugo-theme', 'light'));
    survives('saving a route', () => writeJson('urbanos-lugo-recent-routes', [{ from: 'a', to: 'b' }]));
    survives('clearing the trip', () => writeString('urbanos-lugo-trip', null));
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(g, name, descriptor);
      else delete g[name];
    }
  }
  // Nothing else in the app reaches for the stores unguarded: the pre-paint script and the
  // one-reload guard in main.tsx sit inside their own try, and everything else goes through here.
  for (const file of sourcesUnder('src').filter((f) => !/[\\/]utils[\\/]storage\.ts$|[\\/]security[\\/]themeInit\.ts$|[\\/]main\.tsx$/.test(f))) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert(!/\b(localStorage|sessionStorage)\b/.test(code), `${relative(file)} reaches for web storage outside the guarded helpers`);
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

ok('what the workflows run is pinned, and none of them hands out more than it uses', () => {
  // Nineteen actions were pinned by tag, and a tag can be moved to other code after it was
  // reviewed; denoland/setup-deno@v2 was not even a tag but a branch. The job that holds the
  // deploy token also fetched `jsr:@deno/deploy` and Deno `v2.x`, whatever was newest that
  // minute, and ran them with -A. And it asked for an id-token nothing ever used.
  const dir = join(root, '.github', 'workflows');
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert(files.length >= 5, `found ${files.length} workflows, which means this is not reading what it thinks`);
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const [, spec] of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)) {
      assert(/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/.test(spec), `${file}: ${spec} is not pinned to a commit`);
    }
    for (const line of text.split('\n').filter((l) => /^\s*(?:-\s*)?uses:/.test(l))) {
      assert(/@[0-9a-f]{40} # v\d+(\.\d+)*$/.test(line.trim()), `${file}: "${line.trim()}" has no version beside its pin, so nobody can tell what it is`);
    }
    const commands = text.replace(/^\s*#.*$/gm, '');
    for (const [spec] of commands.matchAll(/\b(?:jsr|npm):@?[\w./-]+(?:@[\w.^~-]+)?/g)) {
      assert(/@\d+\.\d+\.\d+$/.test(spec), `${file}: ${spec} is fetched at run time without an exact version`);
    }
    for (const [, version] of text.matchAll(/deno-version:\s*(\S+)/g)) {
      assert(/^v?\d+\.\d+\.\d+$/.test(version), `${file}: deno-version ${version} is whatever is newest on the day`);
    }
    // Without this the token stays in .git/config for every later step, where an install
    // script could read it. Every checkout, not only the ones that deploy.
    const checkouts = text.split(/\n(?=\s*- )/).filter((step) => /uses:\s*actions\/checkout@/.test(step));
    for (const step of checkouts) assert(/persist-credentials:\s*false/.test(step), `${file}: a checkout keeps its credentials in .git/config`);
    // A token-minting permission belongs to the job that deploys with it, never to the whole workflow.
    const topLevel = commands.split(/^jobs:/m)[0];
    assert(!/id-token:\s*write/.test(topLevel), `${file}: id-token: write is granted to every job in the workflow`);
    // A secret lives in an environment that Settings → Environments lets only main deploy
    // from. A job that reads one without naming its environment reads it on any branch.
    for (const job of (commands.split(/^jobs:/m)[1] ?? '').split(/\n(?= {2}[\w-]+:[ \t]*\n)/)) {
      if (!/\bsecrets\.(?!GITHUB_TOKEN\b)/.test(job)) continue;
      assert(/^ {4}environment:/m.test(job), `${file}: job "${job.trim().split(':')[0]}" reads a secret outside an environment`);
    }
  }
});

ok('the tools that ask public routers and the IGN keep to the gap DATA.md promises', () => {
  // DATA.md: FOSSGIS ask for one request a second, and the IGN's elevation tiles are asked
  // for 1,5 s apart. compareWalkRouter.ts kept 1.1 s ("the only rate this may ever run at");
  // calibrateWalking.ts asked the same router every 350 ms. Each file that names one of
  // these hosts is pinned to the pause of the tool that sends the requests, and a new one
  // fails until it is added here. The IGN's address is built in terrain.ts and fetched,
  // paced, by importElevation.ts.
  const POLITE: [string, string, RegExp, number][] = [
    ['tools/calibrateWalking.ts', 'tools/calibrateWalking.ts', /const PAUSE_MS = ([\d_]+);/, 1000],
    ['tools/compareWalkRouter.ts', 'tools/compareWalkRouter.ts', /const MIN_GAP_MS = ([\d_]+);/, 1000],
    ['tools/importOfficialData.ts', 'tools/importOfficialData.ts', /await sleep\(([\d_]+)\);\r?\n {2}\}\r?\n {2}return \{ path/, 1000],
    ['tools/terrain.ts', 'tools/importElevation.ts', /const GAP_MS = ([\d_]+);/, 1500],
  ];
  const hosts = /routing\.openstreetmap\.de|router\.project-osrm\.org|servicios\.idee\.es/;
  const naming = readdirSync(join(root, 'tools')).filter((f) => f.endsWith('.ts') && !f.startsWith('_') && f !== 'test.ts').map((f) => `tools/${f}`).filter((f) => hosts.test(read(f).replace(/^\s*(\/\/|\*).*$/gm, '')));
  assert.deepStrictEqual(naming.sort(), POLITE.map(([f]) => f).sort(), `these tools name a public router or the IGN: ${naming.join(', ')}; each needs its pause pinned here`);
  for (const [, file, pattern, floor] of POLITE) {
    // A pause this cannot find is reported as lost, not as 0 ms: a CRLF checkout once read so.
    const found = pattern.exec(read(file))?.[1];
    assert(found, `${file}: the pause is no longer where this check reads it (${pattern})`);
    const pause = Number(found.replace(/_/g, ''));
    assert(pause >= floor, `${file} waits ${pause} ms between requests; the service it asks wants ${floor}`);
  }
  const gap = Number(/const GAP_MS = ([\d_]+);/.exec(read('tools/importElevation.ts'))?.[1]);
  assert(read('DATA.md').replace(/\s+/g, ' ').includes(`spaced ${String(gap / 1000).replace('.', ',')} s apart`), `DATA.md no longer says the IGN is asked ${gap / 1000} s apart`);
});

ok('the gates run on every push and proposal, offline, and only the schedule reads other people’s sites', () => {
  // CLAUDE.md: ci.yml runs the four gates on every push and nothing merges without them;
  // all four are offline; a pull request never publishes; the tools that read buslugo.com,
  // the council's feed or Overpass run by hand or on a schedule, never in a loop. SECURITY.md:
  // the type check and the suite run before anything is built, Dependabot looks weekly. Only
  // the YAML held any of it, and a step taken out of it is the kind of change nobody re-reads.
  // Read through a CRLF checkout: a step's line ending in \r is not "run: |", and every
  // command under it went unread, so the weekly step looked removed when it was not.
  const workflow = (name: string) => read(`.github/workflows/${name}`).replace(/\r\n/g, '\n').replace(/^\s*#.*$/gm, '');
  // A step's command, whether on its own line or in a `run: |` block under it.
  const runs = (text: string) => {
    const lines = text.split('\n');
    const out: string[] = [];
    lines.forEach((line, i) => {
      const m = /^(\s*)(?:- )?run: (.+)$/.exec(line);
      if (!m) return;
      if (!/^[|>]-?$/.test(m[2].trim())) return void out.push(m[2].trim());
      const block: string[] = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > m[1].length); j++) block.push(lines[j].trim());
      out.push(block.filter(Boolean).join('\n'));
    });
    return out;
  };
  const ci = workflow('ci.yml');
  assert.deepStrictEqual(runs(ci), [
    'pnpm install --frozen-lockfile', 'pnpm run lint', 'pnpm test', 'pnpm run check:deep',
    'pnpm run data:build && git diff --exit-code --stat -- src/data', 'pnpm run build', 'pnpm test',
    'PORT=3002 node dist-server/server.cjs > server.log 2>&1 &\nfor i in $(seq 1 30); do curl -sf http://localhost:3002/ > /dev/null && break; sleep 1; done\npnpm run audit:browser',
  ], 'ci.yml no longer runs the gates, the dataset rebuild, the suite against the build and the browser audit, in that order');
  // The audit is a gate only if a finding fails it and a run that never started fails it too.
  const audit = read('tools/auditBrowser.ts');
  assert(/if \(gated\.length\) process\.exitCode = 1;/.test(audit) && /if \(!ran && process\.env\.CI\) process\.exitCode = 1;/.test(audit), 'the browser audit passes CI with findings, or without running');
  // And it reads nobody's site: every request to another host is refused, and the API answered from fixtures.
  assert(/if \(url\.host !== audited\) return void page\.send\('Fetch\.failRequest'/.test(audit) && /await page\.send\('Network\.setBypassServiceWorker', \{ bypass: true \}\)/.test(audit), 'the browser audit can reach another host from CI');
  assert(/pull_request:\s*\n\s*branches: \[main, develop\]/.test(ci) && /push:\s*\n\s*branches-ignore: \[main\]/.test(ci), 'ci.yml no longer runs on every proposal to main and develop and every push but main');
  // What makes "nothing merges without them" true is a ruleset on GitHub that main requires
  // the job called checks; the weekly job asks GitHub that it still does. A renamed job is
  // a check main waits for and never gets.
  assert(/^ {2}checks:\s*$/m.test(ci), 'the ci.yml job is no longer called "checks", the name the ruleset on main requires');
  const weekly = runs(workflow('check-source.yml')).join('\n');
  assert(weekly.includes('rules/branches/main') && weekly.includes('.context == "checks"') && weekly.includes('for branch in main develop'), 'check-source.yml no longer asks GitHub that main requires the checks and that main and develop cannot be rewritten');
  assert(weekly.includes('pnpm exec tsx tools/checkHolidaysAhead.ts'), 'check-source.yml no longer warns from November that next year’s holidays are missing');
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.scripts['check:deep'] === 'tsx tools/stressInvariants.ts && tsx tools/stressPlanner.ts', `check:deep runs "${pkg.scripts['check:deep']}", not the two offline sweeps`);
  for (const sweep of ['tools/stressInvariants.ts', 'tools/stressPlanner.ts']) assert(!/\bfetch\(|overpass\(/.test(read(sweep)), `${sweep} reaches the network, and it is a gate`);

  // Deploying is a push to main or the clock, never a proposal, and checks before it builds.
  for (const [name, build] of [['deploy-pages.yml', 'pnpm run build'], ['deploy-worker.yml', 'pnpm run worker:build']] as const) {
    const text = workflow(name);
    assert(!/^\s*pull_request/m.test(text), `${name} runs on a pull request, and a pull request must never publish`);
    const steps = runs(text);
    const at = (step: string) => steps.findIndex((s) => s.includes(step));
    assert(at('pnpm run lint') >= 0 && at('pnpm test') >= 0 && at('pnpm run lint') < at(build) && at('pnpm test') < at(build), `${name} builds before it type-checks and tests`);
  }

  // Every install is the locked one, and pnpm comes from packageManager, not from a workflow.
  const network = /importOfficialData|importOsmRoutes|importStopAmenities|fetchAlerts|calibrateWalking|importFonts|checkParsersUnchanged|reconcile\.ts|checkFares|checkOsmGeometry|compareOperatorTimes|data:(fetch|osm|amenities|alerts)\b|pnpm (run )?reconcile\b|compare:operator|calibrate:walking|fonts:import|check:parsers/;
  for (const name of readdirSync(join(root, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    const text = workflow(name);
    for (const step of runs(text).filter((s) => /pnpm (i|install)\b/.test(s))) assert(step === 'pnpm install --frozen-lockfile', `${name}: "${step}" is not the locked install`);
    for (const step of text.split(/\n(?=\s*- )/).filter((s) => /uses:\s*pnpm\/action-setup@/.test(s))) assert(!/^\s*version:/m.test(step), `${name}: pnpm/action-setup is given a version, so the workflow and package.json can drift apart`);
    // Somebody else's site only on the clock: Mondays in check-source.yml, and the notices
    // snapshot in the hourly Pages build. Never in the gates.
    const reaching = runs(text).filter((s) => network.test(s));
    if (name === 'check-source.yml') assert(/cron: '\S+ \S+ \* \* 1'/.test(text) && !/^\s*(push|pull_request):/m.test(text), 'check-source.yml reads other people’s sites on something other than its Monday schedule');
    else if (name === 'deploy-pages.yml') assert(reaching.every((s) => /fetchAlerts/.test(s)), `deploy-pages.yml reaches other sites beyond the notices: ${reaching.join(' | ')}`);
    else assert(reaching.length === 0, `${name} runs a tool that reads somebody else’s site: ${reaching.join(' | ')}`);
  }

  // Each entry read on its own: one pattern across the file found the next entry's "weekly".
  const entries = read('.github/dependabot.yml').split(/\n(?=\s*- package-ecosystem:)/);
  for (const ecosystem of ['npm', 'github-actions']) {
    const entry = entries.find((e) => new RegExp(`package-ecosystem: ${ecosystem}\\b`).test(e)) ?? '';
    assert(/^\s*interval: weekly\s*$/m.test(entry), `Dependabot no longer looks at ${ecosystem} weekly`);
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
  // Its own plugin, not any of the six that say `apply: 'build'`: with the line taken out of
  // the injector the old pattern still matched the other five.
  const injector = vite.slice(vite.indexOf("name: 'inject-csp'"), vite.indexOf('transformIndexHtml', vite.indexOf("name: 'inject-csp'")));
  assert(injector.length > 0 && /apply: 'build'/.test(injector), 'the CSP injector no longer limits itself to builds');
});

ok('the app imports nothing from the tools, and the browser never imports the policy', () => {
  // CLAUDE.md: tools/ is never imported by the app. csp.ts hashes with node:crypto and reads
  // process.env, and says it is only ever imported by Node; in the bundle either would be a
  // broken page or a build that pulls a Node polyfill in. Comments are stripped, because
  // themeInit.ts names csp.ts in one.
  const offenders: string[] = [];
  for (const file of sourcesUnder('src')) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [, from] of code.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      if (/(^|\/)tools\//.test(from)) offenders.push(`${relative(file)} imports ${from}`);
      if (/(^|\/)csp$|security\/csp(\.ts)?$/.test(from) && !file.endsWith(join('security', 'csp.ts'))) offenders.push(`${relative(file)} imports ${from}`);
    }
  }
  assert(offenders.length === 0, `the bundle reaches what it must not:\n    ${offenders.join('\n    ')}`);
  // And the two Node files that may import it still do, or this is checking an unused name.
  assert(/from '\.\/src\/security\/csp'/.test(read('server.ts')) && /from '\.\/src\/security\/csp'/.test(read('vite.config.ts')), 'server.ts or vite.config.ts no longer imports the policy');
});

ok('no translated string claims a live feed, a remote router or a wake lock', () => {
  // Nobody publishes where this network's buses are: the README says the app never says
  // "real time", and DATA.md keeps EN DIRECTO unused until a feed exists. Those words may
  // appear only to deny it ("non en directo"). The ride's switch never says "wake lock"
  // (DECIDIDO.md). And no string credits a router with the walk: one said "measured by the
  // OpenStreetMap pedestrian router" for three weeks after that router left the app.
  const LIVE = /tempo real|tiempo real|real[- ]?time|en directo|en vivo|ao vivo|\blive\b|EN DIRECTO/i;
  const DENIED = /\b(non|no|not|nunca|never|sen|sin|without)\b/i;
  let read = 0;
  for (const lang of LANGS) {
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        read++;
        assert(!LIVE.test(node) || DENIED.test(node), `${lang}.${path} claims a live feed: "${node.slice(0, 80)}"`);
        assert(!/wake ?lock/i.test(node), `${lang}.${path} says "wake lock": "${node.slice(0, 80)}"`);
        assert(!/router|enrutador|routing/i.test(node), `${lang}.${path} credits a router with the walk, which is worked out on the device: "${node.slice(0, 80)}"`);
      } else if (typeof node === 'function') {
        // A number in every slot, or a list of lines for the one function that takes them.
        const call = (arg: unknown) => (node as (...a: unknown[]) => unknown)(...Array(node.length).fill(arg));
        let out: unknown;
        try { out = call(1); } catch { out = call(['1']); }
        walk(out, path);
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(translations(lang), '');
  }
  assert(read > 300, `read only ${read} strings, so this is not walking the dictionaries`);
});

ok('the documents name every data file, every bundled library and every host a visit contacts', () => {
  // DATA.md, NOTICE.md and PRIVACY.md are promises about provenance, credit and what leaves
  // the device, and each was kept by hand: three of the fourteen data files went unnamed in
  // DATA.md, the dataset itself among them.
  const tracked = execFileSync('git', ['ls-files', '-z', 'src/data', 'data', 'public'], { cwd: root, encoding: 'utf8' }).split('\0').filter((f) => f.endsWith('.json'));
  assert(tracked.length >= 10, `git lists only ${tracked.length} data files, so this is not reading the repository`);
  const data = read('DATA.md');
  for (const file of tracked) assert(data.includes(file.split('/').pop()!), `${file} ships or builds the dataset and DATA.md does not say where it comes from`);

  // Every library the build bundles, by the name NOTICE.md credits it under. A new
  // dependency fails here until it has a row there and an entry in this table.
  const notice = read('NOTICE.md');
  const CREDITED: Record<string, string> = {
    react: 'React', 'react-dom': 'React DOM', leaflet: 'Leaflet', 'maplibre-gl': 'MapLibre GL JS',
    '@maplibre/maplibre-gl-leaflet': 'maplibre-gl-leaflet', 'lucide-react': 'Lucide', express: 'Express',
    tailwindcss: 'Tailwind CSS', 'vite-plugin-pwa': 'Workbox',
  };
  const pkg = JSON.parse(read('package.json'));
  for (const name of [...Object.keys(pkg.dependencies), 'tailwindcss', 'vite-plugin-pwa']) {
    assert(CREDITED[name], `${name} is a dependency with no credit recorded; add it to NOTICE.md and to this table`);
    assert(notice.includes(CREDITED[name]), `NOTICE.md does not credit ${CREDITED[name]} (${name})`);
  }
  // The typeface is redistributed, so its licence travels beside it, naming both families,
  // and NOTICE.md counts the files that are really there.
  const ofl = read('src/fonts/OFL.txt');
  assert(/Atkinson Hyperlegible Next/.test(ofl) && /Atkinson Hyperlegible Mono/.test(ofl), 'src/fonts/OFL.txt no longer carries the copyright of both families');
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const woff = readdirSync(join(root, 'src', 'fonts')).filter((f) => f.endsWith('.woff2')).length;
  assert(new RegExp(`\\b${words[woff]} files\\b`, 'i').test(notice), `src/fonts has ${woff} font files and NOTICE.md says otherwise`);
  // The heights in the walking network are the IGN's, CC BY, and DATA.md says NOTICE.md carries the credit.
  assert(notice.includes('CC BY 4.0 scne.es'), 'NOTICE.md lost the attribution the IGN asks for');

  // PRIVACY.md lists the hosts a visit contacts, "and that is the whole list": exactly the
  // remote origins the content security policy lets the page reach.
  const privacy = read('PRIVACY.md');
  const listed = [...privacy.matchAll(/^\| `([a-z0-9.-]+\.[a-z]{2,})` \|/gm)].map((m) => `https://${m[1]}`).sort();
  const allowed = [...new Set([...CSP_HEADER.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]))].sort();
  assert.deepStrictEqual(listed, allowed, `PRIVACY.md lists [${listed.join(', ')}] as the hosts a visit contacts; the policy allows [${allowed.join(', ')}]`);
});

ok('the figures the documents quote are the ones the code runs and the data holds', () => {
  // A limit changed in the code leaves its documents quoting the old one, and nothing failed:
  // with the operator's ceiling raised from 120 to 1,200 the check on it stayed green, because
  // it reads the same constant. So each figure is read out of the sentence that quotes it,
  // whitespace folded so a line break cannot hide it, and compared with what runs.
  const doc = (file: string) => read(file).replace(/\s+/g, ' ');
  const WORDS: Record<string, number> = { un: 1, one: 1, once: 1, dous: 2, two: 2, tres: 3, three: 3, catro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, dez: 10, ten: 10, vinte: 20, twenty: 20, trinta: 30, thirty: 30 };
  // Galician writes 21.093 and 0,1: a dot groups thousands, a comma marks the decimal.
  const figure = (raw: string) => (raw.toLowerCase() in WORDS ? WORDS[raw.toLowerCase()] : raw.includes(',') ? Number(raw.replace(',', '.')) : Number(raw.replace(/\./g, '')));
  const walk = JSON.parse(read('src/data/walk-network.json')) as { junctions: number[]; edges: number[] };
  let edges = 0;
  let metres = 0;
  for (let i = 0; i < walk.edges.length; i += 5 + walk.edges[i + 4] * 2) {
    edges++;
    metres += walk.edges[i + 2];
  }
  // The dataset's own counts the README states: legs between consecutive stops, those that
  // drive four times the straight line, and the operator's listings with no coordinates.
  let legs = 0;
  let detours = 0;
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      direction.legMeters?.forEach((road, i) => {
        const a = BUS_STOPS.find((s) => s.id === direction.stops[i]);
        const b = BUS_STOPS.find((s) => s.id === direction.stops[i + 1]);
        if (!a || !b) return;
        legs++;
        const straight = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
        if (direction.stopPathIndex?.length && straight > 5 && road / straight > 4) detours++;
      });
    }
  }
  const unplaced = (JSON.parse(read('data/official-raw.json')).stops as { coords?: unknown }[]).filter((s) => !Array.isArray(s.coords)).length;
  const timing = rideTimeReport();
  const tenth = (n: number) => Math.round(n * 10) / 10;
  const QUOTED: [string, RegExp, number[]][] = [
    ['README.md', /\*\*(\d+) paradas\*\* teñen a súa hora suxeita por horas oficiais a ambos os lados, e \*\*(\d+)\*\* quedan/, [timing.bracketed, timing.extrapolated]],
    ['README.md', /Nos (\d+) tramos que se poden contrastar, o erro fronte ao impreso ten mediana de ([\d,]+) min, chega a ([\d,]+) min no peor caso lento e a −([\d,]+) no peor rápido, e só o (\d+)% cae/, [timing.legs.length, tenth(timing.median), tenth(timing.worstSlow), tenth(-timing.worstFast), timing.withinTwoMinutes]],
    ['README.md', /\*\*(\d+) tramos de (\d+) \(/, [detours, legs]],
    ['README.md', /\*\*(\d+) paradas sen coordenadas\*\*/, [unplaced]],
    ['SECURITY.md', /the stop page at most (\d+) times a minute/, [MAX_OPERATOR_REQUESTS_PER_MINUTE]],
    ['DATA.md', /asks for at most (\d+) pages a minute/, [MAX_OPERATOR_REQUESTS_PER_MINUTE]],
    ['README.md', /detrás do QR como moito (\d+) veces por minuto/, [MAX_OPERATOR_REQUESTS_PER_MINUTE]],
    ['SECURITY.md', /capped at (\d+) KB/, [MAX_BODY_BYTES / 1024]],
    ['DATA.md', /capped at (\d+) KB/, [MAX_BODY_BYTES / 1024]],
    ['README.md', /teito de (\d+) KB en cada lectura/, [MAX_BODY_BYTES / 1024]],
    ['README.md', /(\d+) peticións por minuto e enderezo, (\d+) se son de planificación/, [MAX_PER_WINDOW, MAX_PLANS_PER_WINDOW]],
    ['SECURITY.md', /(\d+) requests a minute per address/, [MAX_PER_WINDOW]],
    ['SECURITY.md', /fetched at most (once) a minute behind a (\w+)-minute cache/, [60_000 / ALERTS_MIN_OUTBOUND_MS, ALERTS_CACHE_MS / 60_000]],
    ['README.md', /(\w+) minutos para os avisos, (\w+) se a lectura fallou, (\w+) segundos para unha parada/, [ALERTS_CACHE_MS / 60_000, ALERTS_MIN_OUTBOUND_MS / 60_000, OPERATOR_CACHE_MS / 1000]],
    ['DATA.md', /cached for (\w+) seconds/, [OPERATOR_CACHE_MS / 1000]],
    ['README.md', /deixa de contar incidencias ás (\w+) horas/, [STALE_AFTER_MS / 3_600_000]],
    ['README.md', /máis dos (\w+) segundos que o \*hook\* concede/, [SNAPSHOT_AFTER_MS / 1000]],
    ['README.md', /(\w+) minutos abondan cando a chegada é oficial, [^;]*; (\w+) cando é interpolada/, [TRANSFER_BUFFER_MIN, TRANSFER_BUFFER_ESTIMATED_MIN]],
    ['README.md', /Ten que sacarlle (\w+) minutos ao mellor bus, e nunca encabeza por riba de (\d+) minutos/, [WALK_MUST_BEAT_BUS_BY_MIN, MAX_HEADLINE_WALK_MIN]],
    ['design/DECIDIDO.md', /a (\d+) m ou no propio poste/, [ALARM_RADIUS_M]],
    ['design/DECIDIDO.md', /nos (\w+) minutos antes do bus/, [BOARDING_SOON_MIN]],
    ['README.md', /nos (\w+) minutos antes do/, [BOARDING_SOON_MIN]],
    ['design/DECIDIDO.md', /Aos (\w+) minutos da hora impresa/, [MISSED_AFTER_MIN]],
    ['README.md', /Se pasan (\w+) minutos da hora de subida/, [MISSED_AFTER_MIN]],
    ['PRIVACY.md', /it is capped at (\w+)/, [RECENT_ROUTES]],
    ['PRIVACY.md', /the last (\w+) trips you planned/, [RECENT_ROUTES]],
    ['README.md', /(\d+\.\d{3}) cruces e (\d+\.\d{3}) arestas/, [walk.junctions.length / 2, edges]],
    ['DATA.md', /(\d+\.\d{3}) junctions, (\d+\.\d{3}) edges, (\d+\.\d{3}) km of walkable way/, [walk.junctions.length / 2, edges, Math.floor(metres / 1000)]],
    ['PRIVACY.md', /(\d+\.\d{3}) junctions and (\d+\.\d{3}) edges/, [walk.junctions.length / 2, edges]],
    ['README.md', /Paradas cun código QR no poste \| (\d+)/, [BUS_STOPS.filter((s) => poleCode(s)).length]],
    ['CLAUDE.md', /(\d+) lines, (\d+) stops/, [BUS_LINES.length, BUS_STOPS.length]],
    ['CLAUDE.md', /(\d+) stops, (\d+) lines, (\d+) poles with a printed code/, [BUS_STOPS.length, BUS_LINES.length, BUS_STOPS.filter((s) => poleCode(s)).length]],
  ];
  for (const [file, pattern, expected] of QUOTED) {
    const found = pattern.exec(doc(file));
    assert(found, `${file} no longer has the sentence ${pattern}; if it moved, move this with it`);
    const said = found.slice(1).map(figure);
    assert.deepStrictEqual(said, expected, `${file} says ${found[0]}, and the code or the data says ${expected.join(', ')}`);
  }

  // The council's feeds: one is read since 15 September 2026, and NOTICE.md went on crediting three.
  const feeds = [...read('src/services/alertSyncService.ts').matchAll(/concellodelugo\.gal\/[^'"]*feed/g)].length;
  assert(feeds === 1, `the app reads ${feeds} council feeds; the documents say one`);
  for (const file of ['README.md', 'DATA.md', 'NOTICE.md', 'SECURITY.md', 'PRIVACY.md']) {
    const plural = /\b(two|three|four|dous|tres|catro|\d+) (RSS )?(feeds|fontes RSS)\b/i.exec(doc(file));
    assert(!plural, `${file} says "${plural?.[0]}"; the app reads one council feed`);
  }
});

ok('what the servers bring reaches the reader only as DATA.md says', () => {
  // DATA.md: the council's notices are press releases, not incidents, so they never count
  // towards the navigation badge; the operator's own minutes behind a pole's QR are shown
  // to somebody who arrived by scanning that sticker "and only them". server.ts: an unknown
  // /api path is a JSON 404, never the app's page. Each was one line nothing checked.
  const alerts = read('src/hooks/useServiceAlerts.ts');
  assert(/const announcedIncidents = [^;]*\.filter\(\(a\) => a\.source !== 'concello'\)/.test(alerts), 'the navigation badge counts the council’s notices as incidents again');
  const board = read('src/components/StopArrivalsView.tsx');
  assert(/useOperatorTimes\(viaQr \? /.test(board) && (board.match(/useOperatorTimes\(/g) ?? []).length === 1, 'the board asks for the operator’s minutes without the reader having scanned the pole');
  const app = read('src/App.tsx');
  const qrSets = [...app.matchAll(/setQrStopId\(([^)]*)\)/g)].map((m) => m[1]);
  assert(qrSets.length === 2 && qrSets.includes('viaQr ? stop.id : null') && qrSets.includes('stop.id'), `the scanned pole is set from ${qrSets.join(' and ')}; only the scanner and a ?parada= link may set it`);
  assert(/onSelectStop=\{\(stop\) => selectStop\(stop, true\)\}/.test(app) && (app.match(/selectStop\([^)]*, true\)/g) ?? []).length === 1, 'something other than the QR scanner opens a board as scanned');
  const server = read('server.ts');
  const unknown = server.indexOf("app.use('/api', (_req, res) => res.status(404).json(");
  assert(unknown > 0 && unknown > server.lastIndexOf("app.get('/api/") && unknown < server.indexOf('app.use(express.static('), 'an unknown /api path no longer gets a JSON 404 before the app’s page is served');
});

ok('the servers write nothing down but a failure’s path, and the page sets no cookie and parses no HTML', () => {
  // PRIVACY.md: no cookie, nothing written to disk, no access log, and a failure logged by
  // method and path alone. alertSyncService.ts: what is scraped is rendered by React as
  // text, never as HTML. The 500 handler logged the whole URL, and a plan's query is the two
  // addresses somebody typed; nothing else held any of these.
  const serverSide = ['server.ts', 'worker/index.ts', ...sourcesUnder('src/security', 'src/services').map(relative)];
  for (const file of serverSide) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert(!/\b(writeFile|appendFile|createWriteStream|writeFileSync|appendFileSync)\b/.test(code), `${file} writes to disk`);
    for (const [call] of code.matchAll(/console\.\w+\([^;]*\)/g)) {
      assert(!/originalUrl|req\.url\b|req\.query|searchParams|request\.url\b/.test(call), `${file} logs a request's query: ${call.slice(0, 80)}`);
    }
  }
  assert(/console\.error\('request failed:', req\.method, req\.path, err\)/.test(read('server.ts')), 'the 500 handler no longer logs the method and path alone');
  for (const file of sourcesUnder('src')) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert(!/dangerouslySetInnerHTML/.test(code), `${relative(file)} renders a string as HTML through React`);
    assert(!/document\.cookie/.test(code), `${relative(file)} touches cookies, and PRIVACY.md promises none`);
  }
});

ok('what the browser floor does not cover is asked for only where it exists', () => {
  // The README: below Baseline the app promises nothing, and what the floor does not cover
  // degrades -- the screen kept awake only where the API exists, vibration optional, a
  // notification only where there is a Notification. A call without its question works in
  // Chrome and throws in Safari, which is the other half of the phones in Lugo.
  for (const file of sourcesUnder('src').filter((f) => !f.endsWith('.d.ts'))) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const where = relative(file);
    assert(!/navigator\.vibrate\(/.test(code), `${where} vibrates without asking whether the phone can`);
    if (/navigator\.wakeLock\./.test(code)) assert(/'wakeLock' in navigator/.test(code), `${where} keeps the screen awake without asking whether the API exists`);
    if (/new Notification\(|Notification\.(permission|requestPermission)/.test(code)) assert(/typeof Notification (===|!==) 'undefined'/.test(code), `${where} uses Notification without asking whether it exists`);
    if (/webkitAudioContext|AudioContext/.test(code)) assert(/window\.AudioContext \|\| window\.webkitAudioContext/.test(code), `${where} reaches for AudioContext without Safari's prefixed one`);
  }
});

ok('the limiter turns an address away past its minute, with a 429 and a time to come back', () => {
  // The README and SECURITY.md promise 120 requests a minute per address and 30 plans, then
  // a 429 with Retry-After. Only stress:http, against a running server, ever measured it.
  const ask = (ip: string, path: string) => {
    const sent: { status: number; headers: Record<string, string> } = { status: 200, headers: {} };
    let passed = false;
    const res = {
      setHeader: (name: string, value: string) => void (sent.headers[name] = value),
      status: (code: number) => ((sent.status = code), res),
      json: () => res,
    };
    rateLimit({ ip, path, socket: {} } as unknown as Parameters<typeof rateLimit>[0], res as unknown as Parameters<typeof rateLimit>[1], () => (passed = true));
    return { ...sent, passed };
  };
  const reader = `198.51.100.${Date.now() % 200}`;
  for (let i = 1; i <= MAX_PER_WINDOW; i++) assert(ask(reader, '/stops').passed, `request ${i} of ${MAX_PER_WINDOW} was turned away`);
  const over = ask(reader, '/stops');
  assert(!over.passed && over.status === 429, `request ${MAX_PER_WINDOW + 1} in a minute got ${over.status}`);
  assert(Number(over.headers['Retry-After']) >= 1 && Number(over.headers['Retry-After']) <= 60, `the 429 says Retry-After ${over.headers['Retry-After']}`);
  // Planning has its own, lower ceiling, and another address is not touched by either.
  const planner = `203.0.113.${Date.now() % 200}`;
  for (let i = 1; i <= MAX_PLANS_PER_WINDOW; i++) assert(ask(planner, '/plan').passed, `plan ${i} of ${MAX_PLANS_PER_WINDOW} was turned away`);
  assert(ask(planner, '/plan').status === 429, `plan ${MAX_PLANS_PER_WINDOW + 1} in a minute was served`);
  assert(ask(planner, '/stops').passed, 'an address over its plan limit was turned away from everything else');
  assert(ask('192.0.2.1', '/plan').passed, 'one address over its limit turned another away');
});

ok('no session transcript and no build output is tracked, and the ignore file still says so', () => {
  // The assistant directories hold verbatim transcripts and absolute paths with the
  // machine's user name, and this repository is public (CLAUDE.md); build output is not
  // committed anywhere. Only .gitignore held either, and `git add -f` walks past it.
  const NEVER = ['.claude/', '.antigravity/', '.agents/', '.codex/', '.impeccable/', 'dist/', 'dist-server/', 'worker/dist/'];
  const ignore = read('.gitignore').split(/\r?\n/);
  for (const entry of NEVER) assert(ignore.includes(entry), `.gitignore no longer lists ${entry}`);
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert(tracked.length > 100, `git lists ${tracked.length} files, so this is not reading the repository`);
  const leaked = tracked.filter((file) => NEVER.some((dir) => file.startsWith(dir)));
  assert(leaked.length === 0, `tracked, and never to be: ${leaked.slice(0, 5).join(', ')}${leaked.length > 5 ? ` and ${leaked.length - 5} more` : ''}`);
});

ok('the lockfile keeps the two pinned packages above their advisories', () => {
  // pnpm-workspace.yaml overrides qs and fast-uri past a denial of service and a bypass,
  // fast-uri with a ceiling so a fix cannot become an outage; the README and the yaml say
  // so and nothing checked what was resolved. An override may go once a parent asks for a
  // fixed version itself, so it is the resolved version that is held, not the line.
  const lock = read('pnpm-lock.yaml');
  const versions = (name: string) => [...lock.matchAll(new RegExp(`^  ${name}@(\\d+)\\.(\\d+)\\.(\\d+):`, 'gm'))].map((m) => m.slice(1, 4).map(Number));
  const atLeast = (v: number[], min: number[]) => v[0] !== min[0] ? v[0] > min[0] : v[1] !== min[1] ? v[1] > min[1] : v[2] >= min[2];
  const qs = versions('qs');
  const fastUri = versions('fast-uri');
  assert(qs.length > 0 && fastUri.length > 0, 'qs or fast-uri is no longer in the lockfile, so this checks nothing; drop it with its override');
  for (const v of qs) assert(atLeast(v, [6, 16, 0]), `the lockfile resolves qs ${v.join('.')}, under 6.16.0`);
  for (const v of fastUri) assert(atLeast(v, [3, 1, 6]) && v[0] < 4, `the lockfile resolves fast-uri ${v.join('.')}, outside >=3.1.6 <4`);
});

ok('the services and the worker bundle for a runtime with no Node in it', () => {
  // src/services is imported by the browser, server.ts and the Deno worker, so it may use
  // web standards only (CLAUDE.md). Only the worker's deploy job, on main, ever bundled it
  // that way, so a Node import would have passed every gate and broken the deployment. This
  // is the same esbuild call as `pnpm run worker:build`, for every service too, in memory.
  const entries = ['worker/index.ts', ...readdirSync(join(root, 'src', 'services')).filter((f) => f.endsWith('.ts')).map((f) => `src/services/${f}`)];
  let bundled: ReturnType<typeof buildSync>;
  try {
    bundled = buildSync({ absWorkingDir: root, entryPoints: entries, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, metafile: true, outdir: 'out', logLevel: 'silent' });
  } catch (error) {
    throw new assert.AssertionError({ message: `the services do not bundle without Node: ${(error as Error).message.split('\n').slice(0, 3).join(' ')}` });
  }
  // A global is not an import, so esbuild cannot see it; ours are read for Node's own.
  const ours = Object.keys(bundled.metafile!.inputs).filter((file) => /^(src|worker)\/.*\.tsx?$/.test(file));
  assert(ours.length > 5, `the bundle read only ${ours.length} of our files, so this is not looking at the services`);
  for (const file of ours) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const node = /\b(process\.|Buffer\b|require\(|__dirname|__filename)/.exec(code);
    assert(!node, `${file} reaches for Node's ${node?.[1]}, and it is bundled into the worker or a service`);
  }
});

ok('the development server answers this machine, not the network', () => {
  // In development Vite serves any file under the project root, gitignored ones included,
  // and the server listened on 0.0.0.0: a file planted in .claude/ came back 200 through the
  // machine's own Wi-Fi address. Development listens on localhost unless HOST says otherwise;
  // the built server serves dist/ alone and still listens everywhere.
  const server = read('server.ts');
  assert(/const host = process\.env\.HOST \?\? \(isDev \? '127\.0\.0\.1' : '0\.0\.0\.0'\);/.test(server), 'development listens on every interface again');
  assert(/app\.listen\(port, host,/.test(server), 'the server does not listen on the host it chose');
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

ok('the shortcut past the time-zone database agrees with it at every change of the clocks', () => {
  // A phone in Lugo is answered by Lugo's rule without building an Intl formatter, which
  // loads the time-zone database: 150 ms at 6x CPU in the first render of every board. The
  // rule has to be the database's, hour by hour either side of each change, or the board
  // stays silent about a clock that is out.
  const madrid = (at: Date) => {
    const name = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  };
  let compared = 0;
  for (let year = 2026; year <= 2032; year++) {
    for (let month = 0; month < 12; month++) {
      // Every hour of the last week of each month: both changes fall in one, and the rest is the plain case.
      for (let hour = 0; hour < 7 * 24; hour++) {
        const at = new Date(Date.UTC(year, month + 1, 1) - (hour + 1) * 3_600_000);
        assert.strictEqual(lugoOffsetByRule(at), madrid(at), `the rule says UTC+${lugoOffsetByRule(at) / 60} at ${at.toISOString()}, the database UTC+${madrid(at) / 60}`);
        compared++;
      }
    }
  }
  assert(compared > 10_000, `compared ${compared} instants, which is too few to have crossed every change`);
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
  assert(!/paradas\//.test(full), 'the sitemap still lists a /paradas/, which is its language root under another name');
  // Six screens in each of three languages, so a search can return the one in the searcher's.
  assert((full.match(/<loc>/g) ?? []).length === 18, `the sitemap has ${(full.match(/<loc>/g) ?? []).length} entries, expected 18`);
  for (const url of [site, `${site}es/`, `${site}en/`, `${site}en/lines/`, `${site}es/lineas/`]) assert(full.includes(`<loc>${url}</loc>`), `the sitemap is missing ${url}`);
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
  // The app's own title is the same line, from the same table: a tab strip should read the
  // same before and after the bundle arrives, and a search engine takes the title the running
  // page sets. A dictionary of its own once gave Google "Lugo city bus" for a Galician page.
  assert(pageHead('', 'gl') === ROOT_HEAD, 'ROOT_HEAD is not the Galician root head');
  assert(/document\.title = pageHead\(activeTab === 'stops' \? '' : PATHS\[activeTab\], lang\)\.title/.test(read('src/App.tsx')), 'the app no longer titles the page from the heads the copies carry');
  // A crawler that does not run the app sees no heading unless one is in the document; it
  // is extracted and compared, not spliced into a RegExp, because the title carries a "|".
  const staticH1 = html.match(/<div id="root"><h1[^>]*>([^<]*)<\/h1><\/div>/)?.[1];
  assert(staticH1 === ROOT_HEAD.title, `the static <h1> inside #root says ${JSON.stringify(staticH1)}, not ROOT_HEAD.title`);
  // Search Console re-checks its verification tag now and then; a head rewrite that
  // dropped it would end the verification without anything on screen changing.
  assert(/<meta name="google-site-verification" content="[\w-]{20,}"/.test(html), 'index.html lost the Search Console verification tag');

  // "bus" is the word people search; "not official" is what they are owed, in their language.
  // 155 is where a result cuts the description, and 60 the title.
  const OPENER = { gl: /^Non oficial\./, es: /^No oficial\./, en: /^Unofficial\./ };
  const withCanonical = html.replace('<meta name="theme-color"', `<link rel="canonical" href="${site}" />\n    <meta name="theme-color"`);
  for (const lang of SITE_LANGS) {
    const seen = new Set<string>();
    for (const route of SITE_PATHS) {
      const head = pageHead(route, lang);
      const where = `${lang} ${route || 'root'}`;
      assert(/\bbus\b/i.test(head.title), `"${head.title}" does not say bus`);
      assert(head.title.length <= 60, `"${head.title}" is ${head.title.length} characters; 60 is where a result cuts it`);
      assert(OPENER[lang].test(head.description), `the ${where} description does not open by saying it is not official`);
      assert(head.description.length <= 155, `the ${where} description is ${head.description.length} characters; 155 is the cut`);
      assert(!/tempo real|tiempo real|real[- ]time|en vivo|en directo|\blive\b/i.test(head.title + head.description), `the ${where} head promises live data`);
      assert(!seen.has(head.title), `two ${lang} pages share the title "${head.title}"`);
      seen.add(head.title);

      // Injected the way the build does it, on a page carrying the root canonical.
      const page = pageHtml(withCanonical, route, site, lang);
      assert(page.includes(`<html lang="${lang}"`), `the ${where} page does not say its language`);
      assert(page.includes(`<title>${head.title}</title>`), `the ${where} page did not get its title`);
      assert(page.includes(`<meta name="description" content="${head.description}"`), `the ${where} page did not get its description`);
      assert(page.includes(`<meta property="og:title" content="${head.title}"`), `the ${where} page did not get its og:title`);
      assert(page.includes(`>${head.title}</h1>`), `the ${where} page did not get its own <h1>`);
      assert(page.includes(`<meta property="og:locale" content="${{ gl: 'gl_ES', es: 'es_ES', en: 'en_GB' }[lang]}" />`), `the ${where} page names another locale`);
      // Its own address, except the stops tab, which is its language root's screen and says so.
      assert(page.includes(`<link rel="canonical" href="${canonicalUrl(site, route, lang)}" />`), `the ${where} page canonical is not ${canonicalUrl(site, route, lang)}`);
      assert((page.match(/rel="canonical"/g) ?? []).length === 1, `the ${where} page has more than one canonical`);
      // And the same screen in the other two, which is what lets a search show each reader theirs.
      for (const other of SITE_LANGS) assert(page.includes(`<link rel="alternate" hreflang="${other}" href="${canonicalUrl(site, route, other)}" />`), `the ${where} page does not name its ${other} version`);
      assert(page.includes(`<link rel="alternate" hreflang="x-default" href="${canonicalUrl(site, route, 'gl')}" />`), `the ${where} page has no x-default`);
    }
  }

  // The preview image is injected with the canonical, absolute, and is a file that ships.
  const vite = read('vite.config.ts');
  assert(/og:image" content="\$\{site\}icon-512\.png"/.test(vite), 'the build no longer injects an absolute og:image');
  assert(existsSync(join(root, 'public/icon-512.png')), 'public/icon-512.png is gone, so og:image points at nothing');

  // The tabs are links, so a crawler can walk from any copy to the other six, in the language
  // it is reading, and the address they carry is the one the build writes, slash included.
  for (const file of ['src/components/BottomNav.tsx', 'src/components/SideNav.tsx', 'src/components/MenuDrawer.tsx']) {
    const source = read(file);
    assert(/<a\s[^>]*\{\.\.\.tabLink\(/.test(source), `${file} no longer renders the tabs as links`);
    assert(/tabLink\([\s\S]*?,\s*lang,?\s*\)/.test(source) && /const lang = useLang\(\)/.test(source), `${file} builds its tab links without the language`);
  }
  assert(pathFor('gl', 'linhas') === 'linhas/' && pathFor('es', 'linhas') === 'es/lineas/' && pathFor('en', 'linhas') === 'en/lines/' && pathFor('en', '') === 'en/' && pathFor('gl', '') === '', 'an address lost its trailing slash, so every shared link 301s again');
  assert(/\$\{BASE\}\$\{pathFor\(lang, PATHS\[tab\]\)\}\$\{window\.location\.search\}/.test(read('src/hooks/useTabRoute.ts')), 'urlForTab no longer builds the address from pathFor');
});

ok('an address names its language, and a search engine reads a bare one in Galician', () => {
  // Google rendered the Galician page with a browser that says English, the app followed the
  // browser, and the result carried an English title over a Galician description. Each
  // language now has its own address, and the address decides.
  assert.deepStrictEqual(Object.keys(LANG_PREFIX), [...LANGS], 'the languages with addresses are not the languages the app speaks');
  assert.deepStrictEqual(parsePath(''), { lang: null, tab: null }, 'the bare root names a language or a tab');
  assert.deepStrictEqual(parsePath('linhas/'), { lang: null, tab: 'lines' }, '/linhas/ is not the lines tab in the bare language');
  assert.deepStrictEqual(parsePath('es/'), { lang: 'es', tab: null }, '/es/ is not the Spanish root');
  assert.deepStrictEqual(parsePath('EN/Lines/'), { lang: 'en', tab: 'lines' }, '/en/lines/ is not the lines in English');
  assert.deepStrictEqual(parsePath('es/lineas/'), { lang: 'es', tab: 'lines' }, '/es/lineas/ is not the lines in Spanish');
  // A tab's word from another language still opens it, and the router rewrites the address.
  assert.deepStrictEqual(parsePath('en/linhas/'), { lang: 'en', tab: 'lines' }, '/en/linhas/ does not open the lines');
  assert.deepStrictEqual(parsePath('gl/linhas/'), { lang: null, tab: null }, 'Galician has no prefix, so /gl/ is not an address');
  // Every word names one tab, in every language, and none is a language prefix.
  const owner = new Map<string, string>();
  for (const [lang, words] of Object.entries(SLUGS)) {
    for (const [tab, word] of Object.entries(words)) {
      assert(!Object.values(LANG_PREFIX).includes(word as never) && /^[a-z]+$/.test(word), `${lang}'s word for ${tab}, "${word}", is a prefix or not a plain word`);
      assert((owner.get(word) ?? tab) === tab, `"${word}" names both ${owner.get(word)} and ${tab}`);
      owner.set(word, tab);
    }
  }
  assert(/window\.location\.pathname !== `\$\{BASE\}\$\{pathFor\(lang, PATHS\[tab\]\)\}`/.test(read('src/hooks/useTabRoute.ts')), 'the router no longer rewrites an address that is not in its language\'s words');
  const visit = { address: null, crawler: false, stored: null, browser: 'en-US' } as const;
  assert(pickLang(visit) === 'en', 'a reader with an English browser and no choice on record does not get English');
  assert(pickLang({ ...visit, crawler: true }) === 'gl', 'a crawler at a bare address is not read Galician');
  assert(pickLang({ ...visit, crawler: true, address: 'es' }) === 'es', 'a crawler at /es/ is not read Spanish');
  assert(pickLang({ ...visit, stored: 'gl', address: 'en' }) === 'en', 'a shared /en/ link opens in the language on record instead');
  assert(pickLang({ ...visit, stored: 'es' }) === 'es', 'the choice on record no longer beats the browser at a bare address');
  assert(pickLang({ ...visit, stored: 'constructor', browser: 'fr-FR' }) === 'gl', 'a stored value that is no language, or a browser in none of the three, does not fall back to Galician');
  const googlebot = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  assert(isCrawler(googlebot) && isCrawler('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'), 'Googlebot or Bingbot is not taken for a crawler');
  assert(!isCrawler('Mozilla/5.0 (Linux; Android 13; CUBOT KingKong 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'), 'a phone whose make ends in "bot" is taken for a crawler');
  const app = read('src/App.tsx');
  assert(/pickLang\(\{ address: langFromLocation\(\), crawler: isCrawler\(navigator\.userAgent\)/.test(app), 'the app no longer picks its language from the address first');
  assert(/useTabRoute\('stops', lang\)/.test(app), 'the address no longer follows the language');
  assert(/SITE_LANGS/.test(read('vite.config.ts')), 'the build no longer writes a copy of each page per language');
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

ok('a notice the operator writes out line by line comes out line by line', () => {
  // San Froilán 2026: the bell said only "Cambios en las líneas por San Froilán", and the
  // changes (four lines past 03:00, stops moved on three) were on the home page it links to,
  // one heading per line. The operator's editor also splits words across tags, and a space
  // per tag printed "recorrido h abitual". A page of the same shape:
  const page = `<html><body><ul class="dropdown-menu list-unstyled msg_list"><li><a href="https://buslugo.com/"><i class="fa fa-warning"></i> Cambios en las líneas por las fiestas</a></li></ul>
    <div><h3></h3></div><div><h1><strong>INFORMACIÓN ESPECIAL</strong></h1><h3><strong>Refuerzo los días 3, 4 y 5</strong></h3><p>&nbsp;</p>
    <h2><strong>Línea 1.2 : Campus &#8211; HULA</strong></h2><p><span>Prolongación hasta las 03:07, siguiendo su recorrido h</span><span>abitual.</span></p>
    <h2><strong>Línea 13 : Rda. Muralla 56 &#8211; Gándaras</strong></h2><p>Hasta las 03:00</p><p>Los días 5 y 12 termina a la 1:00</p>
    <h2></h2><h2><strong>Resto de líneas</strong></h2><p><strong>Corte desde la Muralla</strong>: desvío por rúa Santiago.</p><p>Calle A, 14<br />Calle B (esquina)</p><p>&nbsp;</p>
    <p><a href="/lineas"><button type="button">Consulta de líneas</button></a></p><p>¿Has encontrado algún dato erróneo?</p></div><footer><p>©2026</p></footer></body></html>`;

  const found = extractAlertsFromHtml(page);
  assert.strictEqual(found.length, 1, `the bell and its page came out as ${found.length} notices; they are one`);
  const [notice] = found;
  assert.strictEqual(notice.title, 'Cambios en las líneas por las fiestas');
  assert.strictEqual(notice.link, 'https://buslugo.com/', 'the bell item no longer points at the page its detail is on');
  assert.strictEqual(notice.description, 'Refuerzo los días 3, 4 y 5', 'the days under the title were not read as what the notice says');
  assert.strictEqual(notice.severity, 'warning', 'a notice of closures and diversions read as a note');
  // The street number after the colon is the route, not a line; the site's buttons, what follows them and the footer are not the notice.
  assert.deepStrictEqual(
    notice.sections?.map((s) => [s.heading, s.lines, s.paragraphs]),
    [
      ['Línea 1.2 : Campus – HULA', ['1.2'], ['Prolongación hasta las 03:07, siguiendo su recorrido habitual.']],
      ['Línea 13 : Rda. Muralla 56 – Gándaras', ['13'], ['Hasta las 03:00', 'Los días 5 y 12 termina a la 1:00']],
      ['Resto de líneas', [], ['Corte desde la Muralla: desvío por rúa Santiago.', 'Calle A, 14', 'Calle B (esquina)']],
    ],
  );

  // A page whose headings name no line is the page's own text, not a notice.
  assert.strictEqual(extractAlertsFromHtml(page.replace(/Línea (1\.2|13) :/g, 'Tramo :'))[0].sections, undefined, 'ordinary headings were read as a notice');
  // A bell item pointing anywhere but the operator's own site is not a link we put in our page, and its detail is a notice of its own.
  const elsewhere = extractAlertsFromHtml(page.replace('https://buslugo.com/', 'https://example.org/'));
  assert.strictEqual(elsewhere[0].link, undefined, 'a scraped link to another site became a link in the app');
  assert.deepStrictEqual(elsewhere.map((a) => [a.title, (a.sections ?? []).length]), [['Cambios en las líneas por las fiestas', 0], ['INFORMACIÓN ESPECIAL', 3]]);
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
  // And on a Friday evening, after its last run, the next one is Monday's: three days ahead.
  // This asked for ">= 1" and so accepted Saturday, which is what the engine answered.
  const late = getNextLineDeparture('gl', line, direction.id, direction.stops[0], 23 * 60, new Date(2026, 7, 21, 23, 0, 0));
  assert(Math.floor(late.departureMinutes / (24 * 60)) === 3 && late.daysAhead === 3, `the ${line.id} on a Friday night is offered ${Math.floor(late.departureMinutes / (24 * 60))} day(s) ahead, expected 3 (Monday)`);
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
    // The Xunta's decree is out by July and Lugo's two days only in late October, so a year
    // entered early, from the decree alone, would pass the count and miss San Froilán.
    assert(entry.source.some((s) => /local/i.test(s) && /Lugo/.test(s)), `${year} has no source for Lugo's two local holidays, the DOG resolution each autumn`);
  }
  const thisYear = String(new Date().getFullYear());
  assert(HOLIDAY_YEARS.includes(thisYear), `src/data/festivos.json has no entry for ${thisYear}: add the year's holidays from the DOG (see the 2026 entry for the sources)`);
  // And the weekly job's warning ahead of that: quiet through October, due from November
  // until next year is in, and quiet again once it is.
  assert(holidaysDue(['2026'], new Date(2026, 9, 31)) === null, 'the holiday reminder fires before November');
  assert(holidaysDue(['2026'], new Date(2026, 10, 1))?.includes('2027'), 'the holiday reminder is quiet on 1 November with next year missing');
  assert(holidaysDue(['2026'], new Date(2026, 11, 31))?.includes('2027'), 'the holiday reminder is quiet on 31 December with next year missing');
  assert(holidaysDue(['2026', '2027'], new Date(2026, 10, 1)) === null, 'the holiday reminder fires with next year already in');
  assert(holidaysDue(['2027'], new Date(2027, 0, 5)) === null, 'the holiday reminder fires in January, which the suite already covers');
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
      // Names, zones and line numbers are the scraped fields, and so are a bus's destination
      // and next stop. Numbers computed here are not markup and need no escaping.
      const scraped = /\.(name|zone|number|color|address|destination|nextStopName|lineNumber|lineColor|code)\b/.exec(call);
      if (scraped && !/escapeHtml/.test(call)) {
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`);
      }
    }
  }

  // That reads four lines and is satisfied by one escapeHtml anywhere in them, and it never
  // looked at divIcon markup: the trip map's pin printed a line number raw. So every value
  // interpolated into a template that carries markup, at any depth, has to be escaped, a
  // number, the dictionary's own markup, or a local escaped where it was made.
  const NOT_TEXT = new Set(['weight', 'fontSize', 'minWidth', 'bus.bearing', 'rowButtonStyle', 'inner', 'ink']);
  let read = 0;
  for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
    const code = readFileSync(join(dir, file), 'utf8');
    const escapedLocals = new Set([...code.matchAll(/const (\w+) = escapeHtml\(/g)].map((m) => m[1]));
    for (const { expr, at } of markupInterpolations(code)) {
      read++;
      const fine = /^(escapeHtml|badgeHtml)\(/.test(expr) || /^t\.\w+\.\w+$/.test(expr) || /\.toFixed\(\d\)$/.test(expr) || NOT_TEXT.has(expr) || escapedLocals.has(expr) || /^\w+ \? `/.test(expr);
      if (!fine) offenders.push(`${file}:${code.slice(0, at).split('\n').length}  \${${expr.slice(0, 60)}}`);
    }
  }
  assert(read > 25, `found only ${read} values interpolated into map markup, so the scan is not reading the templates`);

  assert(offenders.length === 0, `scraped text reaches a Leaflet tooltip without escapeHtml:\n    ${offenders.join('\n    ')}`);
});

/**
 * Every `${...}` inside a template literal whose own text carries a tag, nested templates
 * included, with where it sits. Strings and comments are stepped over, so a backtick or a
 * brace inside one does not open anything.
 */
function markupInterpolations(code: string): { expr: string; at: number }[] {
  const found: { expr: string; at: number }[] = [];
  const skipQuoted = (k: number) => {
    const quote = code[k];
    for (k++; k < code.length && code[k] !== quote; k++) if (code[k] === '\\') k++;
    return k;
  };
  const skipComment = (k: number) => (code[k + 1] === '/' ? code.indexOf('\n', k) : code.indexOf('*/', k) + 1);
  const readExpression = (k: number): number => {
    for (let depth = 0; k < code.length; k++) {
      const c = code[k];
      if (c === '`') k = readTemplate(k);
      else if (c === "'" || c === '"') k = skipQuoted(k);
      else if (c === '{') depth++;
      else if (c === '}' && depth-- === 0) return k;
    }
    return k;
  };
  const readTemplate = (k: number): number => {
    let text = '';
    const inside: { expr: string; at: number }[] = [];
    for (k++; k < code.length; k++) {
      if (code[k] === '\\') k++;
      else if (code[k] === '`') break;
      else if (code[k] === '$' && code[k + 1] === '{') {
        const end = readExpression(k + 2);
        inside.push({ expr: code.slice(k + 2, end).trim(), at: k });
        k = end;
      } else text += code[k];
    }
    if (/</.test(text)) found.push(...inside);
    return k;
  };
  for (let k = 0; k < code.length; k++) {
    const c = code[k];
    if (c === '/' && (code[k + 1] === '/' || code[k + 1] === '*')) k = skipComment(k);
    else if (c === "'" || c === '"') k = skipQuoted(k);
    else if (c === '`') k = readTemplate(k);
    if (k < 0) break;
  }
  return found;
}

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

ok('the download sizes the README quotes are the build’s, within five per cent', () => {
  // "Every measured figure lives here and is updated here" (CLAUDE.md), and the size table
  // is the one most moved by a change nobody connects to it: a dependency bump renamed and
  // regrew the renderer, and the README was re-measured by hand afterwards. Read against the
  // build when there is one -- CI's second run of this file, after `pnpm run build`.
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) return;
  const files = readdirSync(assets);
  const size = (file: string) => statSync(join(assets, file)).size / 1024;
  const chunk = (pattern: RegExp) => {
    const found = files.filter((f) => pattern.test(f));
    assert(found.length === 1, `the build has ${found.length} files matching ${pattern}, so the README's row cannot be read against it`);
    return [size(found[0]), size(`${found[0]}.gz`), size(`${found[0]}.br`)];
  };
  const html = join(root, 'dist', 'index.html');
  const page = [statSync(html).size, statSync(`${html}.gz`).size, statSync(`${html}.br`).size].map((n) => n / 1024);
  const entry = chunk(/^index-[\w-]+\.js$/);
  const styles = chunk(/^index-[\w-]+\.css$/);
  const ROWS: [string, number[]][] = [
    ['Anaco de entrada', entry],
    ['Folla de estilos', styles],
    ['\\*\\*Primeira carga\\*\\*', [0, 1, 2].map((i) => entry[i] + styles[i] + page[i])],
    ['Renderizador do mapa, co estilo e a paleta', chunk(/^palette-[\w-]+\.js$/)],
    ['Estilos do renderizador', chunk(/^palette-[\w-]+\.css$/)],
    ['Worker do renderizador', chunk(/^maplibre-gl-worker-[\w-]+\.js$/)],
    ['Xeometría viaria', chunk(/^route-geometry-[\w-]+\.js$/)],
    ['Rede peonil con alturas', chunk(/^walk-network-[\w-]+\.js$/)],
  ];
  const readme = read('README.md');
  const kb = (cell: string) => Number(cell.replace(/[*~\s]|KB.*$/g, '').replace(/\./g, ''));
  for (const [label, built] of ROWS) {
    const row = new RegExp(`^\\| ${label} \\| ([^|]+) \\| ([^|]+) \\| ([^|]+) \\|`, 'm').exec(readme);
    assert(row, `the README's size table has no row "${label}"`);
    row.slice(1, 4).forEach((cell, i) => {
      const quoted = kb(cell);
      assert(Math.abs(quoted - built[i]) <= Math.max(built[i] * 0.05, 2), `README: ${label.replace(/\\/g, '')} ${['raw', 'gzip', 'brotli'][i]} is ${cell.trim()}; the build has ${built[i].toFixed(0)} KB`);
    });
  }
  const fonts = files.filter((f) => f.endsWith('.woff2')).reduce((n, f) => n + size(f), 0);
  const typeface = Number(/^\| Tipografía \| (\d+) KB/m.exec(readme)?.[1]);
  assert(Math.abs(typeface - fonts) <= Math.max(fonts * 0.05, 2), `README: the typeface is ${typeface} KB; the build has ${fonts.toFixed(0)} KB`);

  // And what the first visit downloads in the background, read from the service worker's
  // own manifest: entries, distinct files, and their bytes raw, gzip and brotli (a file the
  // build does not compress counts as itself in all three).
  const listed = [...read('dist/sw.js').matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
  const distinct = [...new Set(listed)];
  const bytes = (file: string, suffix: string) => statSync(existsSync(join(root, 'dist', file + suffix)) ? join(root, 'dist', file + suffix) : join(root, 'dist', file)).size / 1048576;
  const precache = ['', '.gz', '.br'].map((suffix) => distinct.reduce((n, file) => n + bytes(file, suffix), 0));
  const said = /(\d+) ficheiros distintos \(o manifesto lista (\d+):[^)]*\), ([\d,]+) MB sen comprimir, ([\d,]+) MB en gzip e ([\d,]+) MB en brotli/.exec(readme.replace(/\s+/g, ' '));
  assert(said, 'the README no longer gives the precache in files and megabytes, or the sentence moved');
  assert(Number(said[1]) === distinct.length && Number(said[2]) === listed.length, `README: the precache is ${said[1]} files in ${said[2]} entries; the build's has ${distinct.length} in ${listed.length}`);
  said.slice(3, 6).map((n) => Number(n.replace(',', '.'))).forEach((quoted, i) => {
    assert(Math.abs(quoted - precache[i]) <= precache[i] * 0.05, `README: the precache is ${quoted} MB ${['raw', 'gzip', 'brotli'][i]}; the build's is ${precache[i].toFixed(2)} MB`);
  });
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
  // In the code, not a comment: apiUrl.ts names the variable in its doc comment, and with the
  // read renamed on purpose the comment alone kept this green.
  for (const file of ['src/services/apiUrl.ts', 'src/security/csp.ts']) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert(code.includes('VITE_API_ORIGIN'), `${file} no longer reads VITE_API_ORIGIN, so the request and the policy can disagree`);
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

ok('hostile markup at the read cap parses in milliseconds, not minutes', () => {
  // Four lazy patterns were left when the other scans went linear: the bell's <ul>, a feed
  // field, the <script>/<style> pre-pass, and the operator's blocks, kept quadratic on a
  // reckoning of one stop every 20 s while a server reads 271. Measured at the 512 KB
  // readCapped allows: 49.7 s, 11.3 s, 7.4 s and half a second of a server doing nothing
  // else.
  //
  // Not a fixed limit on one run: that took 223 ms once on a CI runner for work that takes 4
  // here, and the operator's old scan stays under half a second at the cap. A fourfold input
  // costs a linear scan four times as long and a quadratic one sixteen, on any machine, so
  // each shape runs at a quarter of its size and at its size, the fastest of three runs
  // each: a collector's pause lands in one run, the scan in all of them. The 50 ms floor is
  // for ratios of fractions of a millisecond; the old scans take 0.4 to 0.7 s at these sizes.
  const cases: [string, number, (kb: number) => string, (html: string) => unknown][] = [
    ['a <ul whose tag never ends', 64, (kb) => '<ul '.repeat((kb * 1024) / 4), extractAlertsFromHtml],
    ['an item of unclosed <title>s', 128, (kb) => `<item>${'<title>'.repeat((kb * 1024) / 7)}</item>`, extractConcelloNotices],
    ['unclosed <script openings', 128, (kb) => '<script '.repeat((kb * 1024) / 8), plainText],
    ['unclosed departure blocks', MAX_BODY_BYTES / 1024, (kb) => '<div class="sae-content-info">'.repeat((kb * 1024) / 30), parseOperatorTimes],
    // The walker that reads a notice off the home page, linear from the start; this keeps it so.
    ['a notice with a page of paragraphs', MAX_BODY_BYTES / 1024, (kb) => `<h1>x</h1><h2>Línea 1 : y</h2>${'<p>z</p>'.repeat((kb * 1024) / 8)}`, extractAlertsFromHtml],
    ['a notice of unclosed paragraphs', MAX_BODY_BYTES / 1024, (kb) => `<h1>x</h1><h2>Línea 1 : y</h2>${'<p>z'.repeat((kb * 1024) / 4)}`, extractAlertsFromHtml],
  ];
  const fastest = (parse: (html: string) => unknown, html: string) => {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      parse(html);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  for (const [label, kb, markup, parse] of cases) {
    const quarter = fastest(parse, markup(kb / 4));
    const whole = fastest(parse, markup(kb));
    assert(
      whole < Math.max(8 * quarter, 50),
      `${label}: ${quarter.toFixed(1)} ms for ${kb / 4} KB and ${whole.toFixed(1)} ms for ${kb} KB, which is the quadratic scan back`,
    );
  }

  // The walkers search a lower-cased copy and slice the original, so the copy must keep
  // every index: "İ" lower-cases to two code units, and eight of them before an article
  // put "> " at the head of its card.
  const [notice] = extractAlertsFromHtml(`<p>${'İ'.repeat(8)}</p><article><h2>Desvío da liña 5</h2><p>Aviso: desvío por obras</p></article>`);
  assert(notice?.description.startsWith('Desvío da liña 5'), `after eight "İ" the article read "${notice?.description}"`);
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

await okAsync('one server asks the operator’s site a bounded number of times a minute, however it is asked', async () => {
  // The cache holds one stop for twenty seconds and nothing held the whole: one client
  // walking the coded poles once a second made 813 requests a minute to their site, and
  // while it answered errors, which are not cached, ten a second here were ten a second there.
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let clock = realNow() + 30 * 86_400_000; // clear of every window the checks above opened
  let sent = 0;
  let failing = false;
  Date.now = () => clock;
  globalThis.fetch = (async () => {
    sent++;
    return failing ? new Response('down', { status: 503 }) : new Response('<div class="sae-content-info"><div class="sae-content-info-time"><p>4</p></div></div></div>', { status: 200 });
  }) as typeof fetch;
  try {
    const coded = BUS_STOPS.filter((s) => poleCode(s));
    for (let second = 0; second < 60; second++, clock += 1000) for (const stop of coded) await operatorTimesResponse(stop.id);
    assert(sent <= MAX_OPERATOR_REQUESTS_PER_MINUTE, `every coded pole once a second for a minute sent ${sent} requests to the operator`);
    assert(sent >= Math.min(coded.length, MAX_OPERATOR_REQUESTS_PER_MINUTE), `the ceiling left only ${sent} requests for a minute of real questions`);

    sent = 0;
    failing = true;
    for (let tenth = 0; tenth < 600; tenth++, clock += 100) await operatorTimesResponse(coded[0].id);
    assert(sent <= MAX_OPERATOR_REQUESTS_PER_MINUTE, `one pole asked ten times a second of a failing site sent ${sent} requests in a minute`);
    // The ceiling is a minute's, not for ever: the next minute asks again.
    clock += 60_000;
    const before = sent;
    await operatorTimesResponse(coded[0].id);
    assert(sent === before + 1, 'the next minute did not ask the operator again');
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
});

await okAsync('the worker answers only for the origin it was given, and keeps one copy per question', async () => {
  // What the worker does and nothing held. With no ALLOWED_ORIGIN it answers with no
  // allow-origin and stores nothing, since a browser throws that answer away. The origin is in
  // the cache key: changed, it served the old origin's copies for half an hour. A copy past
  // its age is not served, because cache.match ignores cache-control and a half-hour answer
  // went out for three days. And a made-up query string was one more stored copy each time.
  const g = globalThis as unknown as { Deno?: unknown; caches?: unknown };
  const [realDeno, realCaches, realFetch] = [g.Deno, g.caches, globalThis.fetch];
  const stored = new Map<string, Response>();
  // Read through a call, or TypeScript narrows the size to 0 after the first assert.
  const copies = () => stored.size;
  const env: Record<string, string> = {};
  g.Deno = { env: { get: (key: string) => env[key] } };
  g.caches = {
    open: async () => ({
      match: async (r: Request) => stored.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void stored.set(r.url, res),
      delete: async (r: Request) => stored.delete(r.url),
    }),
  };
  globalThis.fetch = (async () => new Response('<div class="sae-content-info"><div class="sae-content-info-time"><p>4</p></div></div></div>', { status: 200 })) as typeof fetch;
  // The worker reads its origin once, when loaded, so each setting is its own copy of the module.
  const load = async (tag: string): Promise<(r: Request) => Promise<Response>> => (await import(`../worker/index.ts?${tag}`)).handle;
  try {
    const pole = BUS_STOPS.filter((s) => poleCode(s))[3];
    const ask = (handle: (r: Request) => Promise<Response>, query = '') => handle(new Request(`https://api.example/api/paradas/${pole.id}/agora${query}`));

    const closed = await ask(await load('no-origin'));
    assert(closed.status === 200 && closed.headers.get('access-control-allow-origin') === '', 'with no ALLOWED_ORIGIN the worker named an origin');
    assert(closed.headers.get('cache-control') === 'no-store' && copies() === 0, 'an answer no browser will accept was kept at the edge');

    env.ALLOWED_ORIGIN = 'https://owner.github.io';
    const open = await load('with-origin');
    const first = await ask(open);
    assert(first.headers.get('access-control-allow-origin') === 'https://owner.github.io', 'the allowed origin is not the one configured');
    assert([...stored.keys()].every((key) => key.includes(encodeURIComponent('https://owner.github.io'))), 'the edge copy is not keyed by the origin it names');
    for (const junk of ['?x=1', '?x=2', '?utm=a&b=c', '?']) await ask(open, junk);
    assert(copies() === 1, `a made-up query string got its own edge copy: ${copies()} stored for one question`);

    // A copy past its twenty seconds is answered afresh, whatever the store still holds.
    const [key, copy] = [...stored][0];
    const stale = new Headers(copy.headers);
    stale.set('x-stored-at', String(Date.now() - 25_000));
    stored.set(key, new Response(await copy.clone().text(), { status: 200, headers: stale }));
    const again = await ask(open);
    assert(Number(again.headers.get('x-stored-at')) > Date.now() - 5_000, 'a copy past its age was served from the edge store');
  } finally {
    g.Deno = realDeno;
    g.caches = realCaches;
    globalThis.fetch = realFetch;
  }
});

ok('every request to somebody else’s server has a deadline, and the server keeps its headers', () => {
  // Protections the simplification kept and nothing checked. Without a deadline one stalled
  // upstream holds a request, and in the browser a 30 s poll stacked requests behind a stall.
  const calls: string[] = [];
  for (const file of sourcesUnder('src/services', 'src/hooks')) {
    const text = readFileSync(file, 'utf8');
    for (let at = text.indexOf('fetch('); at !== -1; at = text.indexOf('fetch(', at + 6)) {
      const call = text.slice(at, text.indexOf(';', at));
      // The notices snapshot is a file beside the page, not somebody else's server.
      if (/alerts\.json/.test(call)) continue;
      calls.push(relative(file));
      assert(/signal: AbortSignal\.timeout\??\.?\(\d/.test(call), `${relative(file)}: a fetch with no deadline: ${call.slice(0, 90)}`);
      // A server reading somebody else's site says who it is (DATA.md: "identifies itself in
      // its User-Agent"); a browser cannot set one, and asks only our own API.
      const isServerSide = file.split(sep).includes('services') && !/apiUrl\(/.test(call);
      if (isServerSide) {
        assert(/'User-Agent': \w+/.test(call), `${relative(file)}: a request to somebody else's site that does not say who is asking: ${call.slice(0, 90)}`);
        // Every host read here is fixed, and a redirect from one was followed wherever it
        // pointed (OWASP's SSRF sheet: an allowlist means nothing to a client that follows).
        assert(/redirect: 'error'/.test(call), `${relative(file)}: a request to somebody else's site that follows redirects: ${call.slice(0, 90)}`);
      }
      // And in the browser the deadline is asked for only where it exists: Safari 16 has none.
      else assert(/AbortSignal\.timeout\?\.\(/.test(call), `${relative(file)}: AbortSignal.timeout is called in the browser without asking whether it exists`);
    }
  }
  assert(calls.length >= 5, `found ${calls.length} outside requests, which means this is not reading what it thinks`);
  for (const file of ['src/services/alertSyncService.ts', 'src/services/operatorTimes.ts']) {
    assert(/= `UrbanosLugoBot\/[\d.]+ \(\+\$\{REPO_URL\}; unofficial timetable reader\)`/.test(read(file)), `${file} no longer sends a User-Agent naming this project and what it is`);
  }

  const server = read('server.ts');
  for (const header of [
    "res.setHeader('Content-Security-Policy', CSP_HEADER)",
    "res.setHeader('X-Content-Type-Options', 'nosniff')",
    "res.setHeader('X-Frame-Options', 'DENY')",
    "res.setHeader('Referrer-Policy', 'no-referrer')",
    "res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), screen-wake-lock=(self), microphone=()')",
    "res.setHeader('Cache-Control', 'no-store')",
    "express.json({ limit: '32kb' })",
    // Express sent X-Powered-By: Express on every response, and neither of these was sent.
    "app.disable('x-powered-by')",
    "res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')",
    "res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')",
  ]) {
    assert(server.includes(header), `server.ts no longer has ${header}`);
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
  // The fastest of three each: one run against one run read 3.4x on a loaded machine, a
  // collector's pause in the wrong sweep, and lands in one run only.
  const fastest = (run: () => void) => Math.min(time(run), time(run), time(run));
  const fast = fastest(bounded);
  const slow = fastest(plain);
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
  // And each opens the app in its own language, now that each language has an address.
  for (const [door, url] of [['README.md', 'https://braisbrg.github.io/urbanos-lugo/'], ['README.es.md', 'https://braisbrg.github.io/urbanos-lugo/es/'], ['README.en.md', 'https://braisbrg.github.io/urbanos-lugo/en/']]) {
    assert(read(door).split('\n').slice(0, 4).join('\n').includes(`](${url})`), `${door} does not open the app at ${url}`);
  }
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

await okAsync('the route options are listed in the order of the arrivals they print', async () => {
  // A row prints its arrival with the measured walk, and the list kept the planner's order,
  // ranked on the estimated one. From Praza Bretaña to Benigno Rivera on a Saturday at 10:00
  // «12, 52 min, ~10:54» headed «1.2, 22 min, ~10:51», the headline with it, in every build
  // since September: the walk at the far end measured 27 minutes where the estimate said 22.
  const QUESTIONS: [Date, string, string][] = [
    [new Date(2026, 9, 17, 10, 0), 'Praza Bretaña', 'Benigno Rivera (H. Ferreiro)'],
    [new Date(2026, 9, 14, 10, 0), 'Praza Bretaña', 'Benigno Rivera (H. Ferreiro)'],
    [new Date(2026, 9, 14, 10, 0), 'Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)'],
    [new Date(2026, 9, 17, 18, 30), 'Praza Maior', 'Hospital Lucus Augusti (HULA)'],
  ];
  let disordered = 0;
  for (const [now, from, to] of QUESTIONS) {
    const [origin, destination] = [resolveLocationQuery(from), resolveLocationQuery(to)];
    assert(origin && destination, `${from} -> ${to}: one of the ends is not in the dataset`);
    const ends = { origin: { ...origin, name: from }, destination: { ...destination, name: to } };
    const options = planTrips(from, to, { now }).slice(0, 4).map((option, idx) => ({ option, idx }));
    const paths: WalkPaths = {};
    for (const { option } of options) for (const [a, b] of walkHopsOf(option, origin, destination)) paths[walkHopKey(a, b)] = await routeOnFoot(a, b);
    const fix = (plan: RoutePlanResult) => correctionFor(plan, ends, paths);
    // What each catchable bus row prints, in minutes from the question: the planner's own measure.
    const reached = (list: typeof options) =>
      list
        .filter(({ option }) => option.segments.some((seg) => seg.type === 'bus'))
        .map(({ option }) => withMeasuredWalk(option, fix(option)))
        .filter((shown) => shown.reachable)
        .map((shown) => shown.slackMinutes + shown.durationMinutes);
    const inOrder = (minutes: number[]) => minutes.every((m, i) => i === 0 || minutes[i - 1] <= m);
    if (!inOrder(reached(options))) disordered++;
    const ranked = rankMeasured(options, fix);
    assert(inOrder(reached(ranked)), `${from} -> ${to} at ${now.toTimeString().slice(0, 5)}: the rows print ${reached(ranked).join(', ')} minutes, out of order`);
    // Until a walk is measured nothing moves.
    assert(rankMeasured(options, () => ({ before: 0, after: 0 })).every((o, i) => o.idx === i), `${from} -> ${to}: with no walk measured the planner's order changed`);
  }
  assert(disordered > 0, 'no question in the sample prints its rows out of order any more, so this check proves nothing');
  // And the screen lists the ranked rows and heads them with the first.
  const view = read('src/components/RoutePlannerView.tsx');
  assert(/options=\{ranked\}/.test(view) && /const planResult = planOptions\[chosen\]/.test(view) && /chosenOption \?\? ranked\[0\]\?\.idx/.test(view), 'the screen lists or heads the options in the planner order again');
  // Keyed by the trip, so a re-rank or the one replan never leaves a focused row on another trip (WCAG 2.4.3).
  assert(/key=\{tripKey\(option\)\}/.test(read('src/components/planner/TripOptions.tsx')), 'a route option row is keyed by its number in the list again');
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

ok('what the basemap left out stays out', () => {
  // DECIDIDO.md: the one-way arrows went in both themes (nobody reading this is driving, and
  // they land where the stop labels need the room); the light residential wash went, and
  // the dark one stays capped at zoom 9, as buildMapStyle.ts says. A re-derived style from
  // a new upstream would bring either back without a word.
  for (const [theme, style] of Object.entries(mapStyles())) {
    const oneWay = style.layers.filter((l) => /oneway/.test(l.id)).map((l) => l.id);
    assert(oneWay.length === 0, `${theme}: one-way arrows are back (${oneWay.join(', ')})`);
  }
  const { light, dark } = mapStyles();
  assert(!light.layers.some((l) => l.id === 'landuse_residential'), 'light: the residential wash is back over the neighbourhoods');
  const residential = dark.layers.find((l) => l.id === 'landuse_residential') as { maxzoom?: number } | undefined;
  assert(!residential || (residential.maxzoom ?? 24) <= 9, `dark: the residential fill reaches zoom ${residential?.maxzoom ?? 'any'}, past the 9 it is capped at`);
});

ok('what the interface announces, names and keeps is what the README and DECIDIDO say', () => {
  // Small promises, each in one sentence and held by none. The README: toggles carry
  // aria-pressed -- board views, map layers, line filters, time mode, trip options, theme and
  // language -- and the navigation aria-current="page"; occupancy is "expected"; the line
  // list says "1 en ruta", not "1 GPS". DECIDIDO: one segmented control, shared by the board
  // and the planner; the ride has four states and no "done"; the keep-awake switch starts
  // off and is not shown where the API is missing; one favicon file; the manifest dark.
  const pressed = { 'ui/controls.tsx': 2, 'ui/Settings.tsx': 2, 'Map/MapControls.tsx': 3, 'Map/LineChips.tsx': 2, 'planner/TripOptions.tsx': 1 };
  for (const [file, least] of Object.entries(pressed)) {
    const found = (read(`src/components/${file}`).match(/aria-pressed=/g) ?? []).length;
    assert(found >= least, `${file} announces ${found} pressed states, fewer than its ${least} toggles`);
  }
  for (const file of ['StopArrivalsView.tsx', 'RoutePlannerView.tsx']) assert(/<Segmented\b/.test(read(`src/components/${file}`)), `${file} draws its own segmented control again`);
  for (const file of ['BottomNav.tsx', 'SideNav.tsx']) assert(/aria-current=\{[^}]*'page'/.test(read(`src/components/${file}`)), `${file} no longer marks the current tab as the page`);
  for (const lang of LANGS) {
    const t = translations(lang);
    assert(/prevista|expected/i.test(t.map.occupancyLabel), `${lang}: occupancy is no longer called expected: "${t.map.occupancyLabel}"`);
    assert(!/gps|live|directo/i.test(t.lines.enRoute(2)), `${lang}: the line list counts buses as tracked: "${t.lines.enRoute(2)}"`);
  }
  assert(/export type TripPhase = 'waiting' \| 'riding' \| 'alighting' \| 'walking';/.test(read('src/utils/tripProgress.ts')), 'the ride no longer has exactly its four states');
  const ride = read('src/hooks/useTripCompanion.ts');
  assert(/const \[keepAwakeOn, setKeepAwakeOn\] = useState\(false\)/.test(ride) && /CAN_KEEP_AWAKE \? \{/.test(ride), 'the keep-awake switch no longer starts off, or shows where the API is missing');
  assert.deepStrictEqual(readdirSync(join(root, 'public')).filter((f) => f.endsWith('.svg')), ['favicon.svg'], 'there is more than one drawing of the icon again');
  const background = /background_color: '(#[0-9a-f]{6})'/i.exec(read('vite.config.ts'))?.[1] ?? '#ffffff';
  assert(relLum(background) < 0.02, `the installed app opens on ${background}, a white flash before the dark page`);
});

ok('three tones carry meaning, at least 50 degrees apart, and the mark is the fleet red', () => {
  // DECIDIDO.md: red is the app, blue a time the operator publishes, amber a time this app
  // works out; nothing else carries meaning, they sit 50 degrees or more apart in oklch,
  // "and a check holds it". There was no such check. The two hues 50 apart are the dark
  // theme's accent and amber, so a few degrees of drift is a reader with a colour
  // deficiency losing the difference between published and worked out.
  const css = read('src/index.css');
  const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('\n}', css.indexOf(`${selector} {`)));
  const hue = (theme: string, token: string) => {
    const value = new RegExp(`--c-${token}: oklch\\([\\d.]+ [\\d.]+ ([\\d.]+)\\)`).exec(block(theme))?.[1];
    assert(value, `${theme} no longer gives --c-${token} as oklch, so its hue cannot be read`);
    return Number(value);
  };
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  for (const theme of [':root', '.dark']) {
    const tones = { accent: hue(theme, 'accent'), published: hue(theme, 'official-bg'), estimated: hue(theme, 'estimated-fg'), 'estimated line': hue(theme, 'estimated-line') };
    assert(tones.estimated === tones['estimated line'], `${theme}: the estimated text and its dashed line are two hues, ${tones.estimated} and ${tones['estimated line']}`);
    for (const [a, b] of [['accent', 'published'], ['accent', 'estimated'], ['published', 'estimated']] as const) {
      assert(apart(tones[a], tones[b]) >= 50, `${theme}: ${a} at ${tones[a]} and ${b} at ${tones[b]} are ${apart(tones[a], tones[b])} degrees apart, under 50`);
    }
  }
  // The token is a step darker for text; the mark itself is the fleet red, in its three places.
  for (const [file, pattern] of [['index.html', /name="theme-color" content="#d81f26"/], ['vite.config.ts', /theme_color: '#d81f26'/], ['public/favicon.svg', /fill='#d81f26'/]] as const) {
    assert(pattern.test(read(file)), `${file} no longer carries the fleet red #d81f26`);
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
  // And every overlay goes through it, as the README says this file demands: the trap in
  // the hook did nothing for a fifth modal that built its own. Each element marked
  // aria-modal carries a ref made by useDialog, in its own file or handed down by the
  // component that renders it (the map's sheet gets TransitMap's).
  const views = sourcesUnder('src/components');
  let overlays = 0;
  for (const file of views) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/aria-modal/g)) {
      overlays++;
      const tag = code.slice(code.lastIndexOf('<', m.index), code.indexOf('>', m.index));
      const ref = /\bref=\{(?:p\.|props\.)?(\w+)\}/.exec(tag)?.[1];
      const madeHere = !!ref && new RegExp(`const ${ref} = useDialog\\(`).test(code);
      const handedDown = !!ref && views.some((other) => {
        const parent = readFileSync(other, 'utf8');
        const passed = new RegExp(`\\b${ref}=\\{(\\w+)\\}`).exec(parent)?.[1];
        return !!passed && new RegExp(`const ${passed} = useDialog\\(`).test(parent);
      });
      assert(madeHere || handedDown, `${relative(file)} marks an overlay aria-modal without a ref from useDialog, so Tab walks out of it`);
    }
  }
  assert(overlays >= 5, `found ${overlays} modal overlays; there are five, so this is not reading them`);

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

  // A rung change rebuilt every marker in its new style, then restyled them all again: the
  // selection effect followed the rung and the theme too, and each setStyle asked the canvas
  // for a redraw. Traced at 6x CPU: 128 of them at the first zoom step, 67 ms of a 113 ms task.
  const restyleDeps = stopsLayer.split('useEffect(').find((part) => part.includes('marker.setStyle('))?.match(/\}, \[([^\]]*)\]\);/)?.[1];
  assert(restyleDeps === 'selectedStop?.id', `the selection restyle follows [${restyleDeps ?? 'nothing found'}], so a rung change restyles the markers the rebuild has just drawn`);
  assert(stopsLayer.includes('}, [map, stops, visibleLineIds, showStops, rung, colors, thinnedIn]);'), 'the rebuild no longer follows the rung and the theme, and the restyle no longer covers for it');
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

ok('a ride costs the phone what it shows, not a repaint every frame', () => {
  // measure:browser, a minute of "Vou nesta" at 6x CPU: 45 s of main-thread work, 39 of them
  // repainting the one looping animation, a box-shadow the compositor cannot run. And the
  // map, mounted behind `hidden` once opened, kept its three-second clock going under the ride.
  const css = read('src/index.css');
  const keyframes = new Map([...css.matchAll(/@keyframes ([\w-]+) \{([^\n]*)\}\s*$/gm)].map((m) => [m[1], m[2]]));
  const looping = [...css.matchAll(/animation: ([\w-]+) [^;]*\binfinite\b/g)].map((m) => m[1]);
  assert(looping.length > 0, 'found no looping animation in index.css, so this is reading the wrong thing');
  for (const name of looping) {
    const body = keyframes.get(name);
    assert(body, `the looping animation ${name} has no one-line @keyframes to read`);
    const properties = [...body!.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
    assert(properties.every((p) => p === 'opacity' || p === 'transform'), `${name} loops for ever and animates ${properties.join(', ')}: that repaints every frame on the main thread`);
  }
  assert(/useClock\(visible \? \d+ : null\)/.test(read('src/components/Map/TransitMap.tsx')), 'the map keeps its clock running while another tab is on screen');
  assert(/<InteractiveMap [^>]*visible=\{activeTab === 'map'\}/.test(read('src/App.tsx')), 'the map is no longer told when it is hidden');
});

ok('every animation moves on the compositor: opacity and transform, nothing else', () => {
  // The motion rule of 20 September 2026 says opacity and transform only, and two one-shots
  // broke it until 2 October: `attention`, the ring around «Vou nesta», spread a box-shadow,
  // and `seg-reveal` held a button's background colour. Each repainted every frame it ran,
  // which is what the rule is there to stop; the ride's pulse did it for an hour at a time.
  const css = read('src/index.css');
  const keyframes = [...css.matchAll(/@keyframes ([\w-]+) \{([^\n]*)\}\s*$/gm)];
  assert(keyframes.length > 10, `found ${keyframes.length} one-line @keyframes, so this is reading the wrong thing`);
  assert(!/@keyframes [\w-]+ \{\s*$/m.test(css), 'a @keyframes spans several lines, where the reading below would not see it');
  for (const [, name, body] of keyframes) {
    const properties = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
    assert(properties.every((p) => p === 'opacity' || p === 'transform'), `@keyframes ${name} animates ${properties.join(', ')}: that repaints every frame on the main thread`);
  }
});

ok('every animation runs 120 to 240 ms, and only two loop besides the waiting indicators', () => {
  // The README said none ran over 240 ms while four did, from the day the sentence was
  // written; it then named them, and on 6 October they came down to 240 (DECIDIDO). An
  // animation outside 120-240 ms, a new loop, or a transition over 240 fails here, and so
  // does the README if it stops saying so. The reduced-motion block zeroes every duration
  // and is not read.
  const css = read('src/index.css').replace(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\s{2}\}\n/, '');
  const ms = (value: string, unit: string) => Number(value) * (unit === 's' ? 1000 : 1);
  const LOOPS = ['pulse-ring', 'dot-bounce'];
  const readme = read('README.md').replace(/\s+/g, ' ');
  assert(readme.includes('Cada un dura entre 120 e 240 ms'), 'the README no longer says every animation runs 120 to 240 ms');
  const animations = [...css.matchAll(/animation:\s*([\w-]+)\s+(\d+(?:\.\d+)?)(ms|s)\b([^;]*);/g)];
  assert(animations.length > 12, `found ${animations.length} animations, so this is reading the wrong thing`);
  for (const [, name, value, unit, rest] of animations) {
    if (/\binfinite\b/.test(rest)) {
      assert(LOOPS.includes(name), `${name} loops for ever; the README names two loops, the ride's pulse and «Calculando»`);
      continue;
    }
    const duration = ms(value, unit);
    assert(duration >= 120 && duration <= 240, `${name} runs ${duration} ms, outside the 120-240 ms the README gives every animation`);
    // The one delay is the ring around «Vou nesta», and the README gives it.
    const delay = /(\d+(?:\.\d+)?)(ms|s)\b/.exec(rest);
    if (delay) assert(name === 'attention' && readme.includes(`«Vou nesta» agarda ${ms(delay[1], delay[2])} ms`), `${name} waits ${ms(delay[1], delay[2])} ms and the README says otherwise`);
  }
  for (const [, value, unit] of css.matchAll(/transition:[^;]*?\b(\d+(?:\.\d+)?)(ms|s)\b/g)) {
    assert(ms(value, unit) <= 240, `a transition runs ${ms(value, unit)} ms, over the 240 every movement keeps to`);
  }
  // And a duration written in a component, which the stylesheet never shows: the planner's
  // swap arrow turned in 260 ms, in a bracketed Tailwind class (spelled out here, Tailwind
  // would read it and ship the rule). Tailwind's duration-N is N ms; in an inline style, the
  // first time in the value is the duration.
  let inComponents = 0;
  for (const file of sourcesUnder('src')) {
    const source = readFileSync(file, 'utf8');
    const found = [
      ...[...source.matchAll(/\bduration-(?:(\d+)\b|\[(\d+(?:\.\d+)?)(ms|s)\])/g)].map(([, n, value, unit]) => (n ? Number(n) : ms(value, unit))),
      ...[...source.matchAll(/\b(?:transition|animation)(?:Duration)?:\s*['"`][^'"`]*?(\d+(?:\.\d+)?)(ms|s)\b/g)].map(([, value, unit]) => ms(value, unit)),
    ];
    for (const duration of found) assert(duration <= 240, `${relative(file)} moves for ${duration} ms, over the 240 every movement keeps to`);
    inComponents += found.length;
  }
  assert(inComponents >= 3, `found ${inComponents} durations in the components, so this is reading the wrong thing`);
  // Tailwind's own loops (animate-spin, animate-pulse, …) never pass through the stylesheet
  // either, and the README counted two loops while five more ran. They are waiting
  // indicators, kept by DECIDIDO on 6 October; a sixth fails here.
  const WAITING = [
    'src/App.tsx animate-pulse', 'src/components/AlertsView.tsx animate-spin', 'src/components/RoutePlannerView.tsx animate-pulse',
    'src/components/TripCompanionView.tsx animate-pulse', 'src/components/planner/PlaceField.tsx animate-pulse',
  ];
  const tailwindLoops = sourcesUnder('src').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/\banimate-(?!none\b)[\w-]+/g)].map(([cls]) => `${relative(file).replace(/\\/g, '/')} ${cls}`));
  assert.deepStrictEqual(tailwindLoops.sort(), [...WAITING].sort(), `the Tailwind loops are not the five waiting indicators DECIDIDO keeps: ${tailwindLoops.join(', ')}`);
  assert(readme.includes('Á parte van os indicadores de espera'), 'the README no longer names the waiting indicators');
});

ok('a tap on «Calcular ruta» says «Calculando» before the plan holds the thread', () => {
  // The plan ran inside the tap: "arrive by" held a slow phone for 5.0-6.4 s with nothing on
  // screen to say why. The button now says «Calculando» in a frame of its own, and the plan
  // waits until that frame has been painted.
  const view = read('src/components/RoutePlannerView.tsx');
  const body = view.slice(view.indexOf('const calculate = ('), view.indexOf('// A place chosen in the search box'));
  assert(body.length > 200, 'could not find calculate() in RoutePlannerView, so this is reading the wrong thing');
  assert(body.includes('setCalculating(true)'), 'calculate() no longer marks the button as calculating');
  const painted = body.indexOf('afterPaint(');
  assert(painted !== -1 && painted < body.indexOf('planTrips('), 'calculate() plans before the «Calculando» frame is on screen');
  assert(/const afterPaint = \(run: \(\) => void\) => requestAnimationFrame\(\(\) => setTimeout\(run, 0\)\)/.test(view), 'afterPaint no longer waits for a painted frame');
});

await okAsync('what the planner remembers never changes what it answers', async () => {
  // The planner keeps what depends on the network alone per stop, and which bus a question
  // lands on while `now` is one instant: "arrive by" went from 1.6 s to 0.6 s on this machine
  // and a tap from 12.4 s to 5.1 s on the throttled phone. A remembered answer handed to the
  // wrong question is a plan that reads perfectly, passes every invariant, and is worse: one
  // key missing its direction of travel changed 168 of 187 answers and no other check failed.
  // So each answer is compared with a copy of the planner that has remembered nothing, asked
  // first, against this one after the reverse questions and other instants filled it.
  const copy = 'fresh'; // a query string makes it another module, with nothing remembered
  const fresh = ((await import(`../src/utils/planner.ts?${copy}`)) as { planTrips: typeof planTrips }).planTrips;
  const at = new Date(2026, 8, 30, 8, 0);
  const pairs = [0, 1, 2, 3, 4, 5].map((i) => [BUS_STOPS[(i * 53) % BUS_STOPS.length].name, BUS_STOPS[(i * 97 + 29) % BUS_STOPS.length].name]);
  const ask = (plan: typeof planTrips, [from, to]: string[]) => JSON.stringify([plan(from, to, { now: at }), plan(from, to, { now: at, arriveBy: 9 * 60 + 30 })]);
  const clean = pairs.map((pair) => ask(fresh, pair));
  for (const [from, to] of pairs) {
    planTrips(to, from, { now: at });
    planTrips(to, from, { now: new Date(2026, 9, 4, 18, 0), lang: 'en' });
  }
  pairs.forEach((pair, i) => assert(ask(planTrips, pair) === clean[i], `${pair[0]} -> ${pair[1]} is answered differently once other questions have been asked`));
});

ok('the planner calls a departure official only when its own run prints that stop', () => {
  // The board had been fixed for exactly this; getNextLineDeparture, which the planner and
  // the ride ask, still asked the whole direction. On a weekday 485 of 16,468 departures --
  // the headway-filled runs of the 2 among them -- came back HORARIO OFICIAL.
  const monday = new Date(2026, 8, 28, 6, 0, 0);
  for (const line of BUS_LINES) {
    line.directions.forEach((direction, d) => {
      const runs = buildRuns(line, d, BUS_STOPS, dayKind(monday));
      direction.stops.forEach((stopId, i) => {
        if (i === direction.stops.length - 1) return;
        for (const run of runs) {
          const dep = getNextLineDeparture('gl', line, direction.id, stopId, Math.round(run.minutesByStopIndex[i]), monday);
          if (dep.precision !== 'published') continue;
          const leaving = runs.filter((r) => Math.round(r.minutesByStopIndex[i]) === dep.departureMinutes);
          assert(leaving.some((r) => r.publishedStopIndices.includes(i)), `${line.number}/${direction.id} ${stopId} at ${formatMinutes(dep.departureMinutes)} is labelled official and no run printing that stop leaves then`);
        }
      });
    });
  }
});

ok('past the last bus, the next one comes from the timetable of the day it runs, and says which day', () => {
  // Rolling over moved today's first run to tomorrow: on a Friday night 664 of the 1,136
  // departures offered for Saturday were wrong, 398 of them on lines that do not run on
  // Saturdays at all.
  const friday = new Date(2026, 9, 2, 23, 30, 0);
  assert(friday.getDay() === 5, 'the probe date is not a Friday');
  const onDay = (ahead: number) => {
    const day = new Date(friday);
    day.setDate(day.getDate() + ahead);
    return dayKind(day);
  };
  for (const line of BUS_LINES) {
    line.directions.forEach((direction, d) => {
      direction.stops.forEach((stopId, i) => {
        if (i === direction.stops.length - 1) return;
        const dep = getNextLineDeparture('gl', line, direction.id, stopId, 23 * 60 + 30, friday);
        if (dep.isServiceActive) return;
        const firstAt = (ahead: number) =>
          lineRunsOn(line, onDay(ahead)) ? buildRuns(line, d, BUS_STOPS, onDay(ahead)).map((r) => r.minutesByStopIndex[i]).filter((m) => m !== undefined).sort((a, b) => a - b)[0] : undefined;
        for (let ahead = 1; ahead < dep.daysAhead; ahead++) assert(firstAt(ahead) === undefined, `${line.number}/${direction.id} ${stopId} skips ${ahead} day(s) ahead, when it does run`);
        const first = firstAt(dep.daysAhead);
        assert(first !== undefined, `${line.number} is offered ${dep.daysAhead} day(s) ahead, a day it does not run at ${stopId}`);
        assert(formatMinutes(first!) === formatMinutes(dep.departureMinutes), `${line.number}/${direction.id} ${stopId}: offered ${formatMinutes(dep.departureMinutes)}, that day's first is ${formatMinutes(first!)}`);
        assert(Math.floor(dep.departureMinutes / (24 * 60)) === dep.daysAhead, 'the day it names and the minute it returns disagree');
      });
    });
  }
  // The notice names the day: "07:00" alone was read as the next morning whichever it was.
  // That Monday is San Froilán, Lugo's own holiday, so a weekday-only line is next on Tuesday.
  const weekdayOnly = BUS_LINES.find((l) => l.services.every((p) => p.days.length === 1 && p.days[0] === 'laborable'))!;
  const dir = weekdayOnly.directions[0];
  const tuesday = getNextLineDeparture('gl', weekdayOnly, dir.id, dir.stops[0], 23 * 60 + 30, friday);
  assert(tuesday.daysAhead === 4 && dayWord('gl', 4, friday) === 'o martes' && (tuesday.serviceNotice ?? '').includes('o martes'), `the notice for Tuesday's bus does not say Tuesday: "${tuesday.serviceNotice}"`);
  assert(dayWord('gl', 3, friday) === 'o luns' && dayWord('es', 1, friday) === 'mañana' && dayWord('en', 0, friday) === '', 'the day words are wrong');
});

ok('asked before midnight, a walk that ends past it does not make tomorrow a running service', () => {
  // From 28 Sep "rolled over" was counted from the minute the walk to the pole ended, so a walk
  // past midnight made the next morning's first bus a running one. At 23:50 the planner then
  // headed with a fifteen-minute walk to Sindicatos for the 07:15 1.1, which passes Praza Bretaña
  // at 07:11, and walking there tonight was not among the options at all; on 15 Sep it led them.
  const night = new Date(2026, 9, 15, 23, 50);
  const plans = planTrips('Praza Bretaña', 'Benigno Rivera (H. Ferreiro)', { now: night });
  assert(plans[0]?.segments.every((seg) => seg.type === 'walk'), `at 23:50 the first answer is ${plans[0]?.departureTime}, not the walk that gets there tonight`);
  const direct = plans.map((p) => p.segments.filter((seg) => seg.type === 'bus')).filter((legs) => legs.length === 1 && legs[0].line?.number === '1.1');
  assert(direct.length > 0 && direct.every(([leg]) => leg.fromStop?.name === 'Praza Bretaña'), `the 1.1 straight there is boarded at ${direct.map(([leg]) => leg.fromStop?.name).join(', ')}, a walk away from the pole it passes first`);
  for (const plan of sampleTrips(night)) assert(!plan.daysAhead || !plan.isServiceActive, `a trip that sets off tomorrow at ${plan.departureTime} was counted as running tonight`);
});

ok('an empty board names a bus that can be boarded there, on the day it runs', () => {
  // At 03:00 five poles -- HULA, Facultade Veterinaria, A Tolda, Czda. Gándaras, Calde --
  // answered with a bus that ends its run at that very pole: "5ES at 07:30 to HULA", at HULA.
  const night = new Date(2026, 8, 29, 3, 0, 0);
  for (const stop of BUS_STOPS) {
    const next = nextServiceAtStop(stop.id, night);
    if (!next) continue;
    const line = BUS_LINES.find((l) => l.id === next.lineId)!;
    const boardable = line.directions.some((direction) => {
      const i = direction.stops.indexOf(stop.id);
      return i !== -1 && i < direction.stops.length - 1 && direction.destination === next.destination;
    });
    assert(boardable, `${stop.name}: "${next.lineNumber} ${next.time} to ${next.destination}" ends its run here`);
    assert(next.daysAhead === 0, `${stop.name}: at 03:00 the next bus is put ${next.daysAhead} day(s) ahead`);
  }
  const busiest = [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length)[0];
  const late = nextServiceAtStop(busiest.id, new Date(2026, 8, 28, 23, 30));
  assert(late && late.daysAhead === 1, 'after the last bus the next one is not put on tomorrow');
  // And the sentence's time says where it came from, like every other time in the app.
  assert(/nextServiceAt\([^)]*nextService\.precision === 'estimated' \? '~'/.test(read('src/components/StopArrivalsView.tsx')), "the empty board's next time is drawn without its tilde again");
});

ok('a headway line keeps its printed last departure', () => {
  // "Every 30 min until 21:45" leaves at 21:45. The expansion stopped at 21:30, which would
  // drop the last bus of the day; every pattern in the dataset happens to land on it today.
  const every30 = expandHeadway(7 * 60 + 30, 21 * 60 + 45, 30);
  assert(every30[every30.length - 1] === 21 * 60 + 45, `the last departure is ${formatMinutes(every30[every30.length - 1])}, not 21:45`);
  const exact = expandHeadway(7 * 60 + 30, 22 * 60, 30);
  assert(exact.length === new Set(exact).size && exact[exact.length - 1] === 22 * 60, 'an exact span gains a duplicate last departure');
});

ok('the line screen marks a derived time as the board does, and nothing on it pulses', () => {
  // 1,077 of the 1,585 departures of a day type -- ten lines print a first, a last and a
  // frequency, and 26 direction-days start at a stop that is not a timing point -- were drawn
  // in "Saídas desde cabeceira" as printed times, and a time already passed lost its tilde.
  // The "bus here" dot pulsed over a position worked out from the timetable.
  const lines = read('src/components/LinesView.tsx');
  assert(/derived: derived\(r, 0\)/.test(lines), 'the departures table no longer asks whether each departure is printed');
  assert(/\{derived\(shownRun, idx\) && '~'\}\s*\{formatMinutes\(passingMinutes\)\} &middot; \{t\.lines\.passed\}/.test(lines), 'a time already passed is drawn as printed again');
  assert(/\{derived\(shownRun, 0\) && '~'\}/.test(lines), 'the run header draws a derived departure as printed');
  assert(!/animate-pulse/.test(lines), 'something on the line screen pulses again');
});

ok('the planner turns the swap arrow on a swap only, and keeps the asked row in view', () => {
  // The port counted every question: "Calcular" turned the arrow beside a desktop form that
  // never folds. And scrolling to the answer after the fold hid the row above it -- 76 px,
  // the way back to the fields.
  const planner = read('src/components/RoutePlannerView.tsx');
  const calculate = planner.slice(planner.indexOf('const calculate ='), planner.indexOf('const swap ='));
  assert(calculate.length > 0 && !/setSwaps/.test(calculate), 'every question turns the swap arrow again');
  assert(/const swap = \(\) => \{\s*setSwaps/.test(planner), 'a swap no longer turns the arrow');
  assert(/askedRowRef\.current\?\.scrollIntoView/.test(planner) && !/answerRef\.current\?\.scrollIntoView/.test(planner), 'the answer scrolls the asked row out of view again');
  // Two-line labels need room: a fixed 44 px and no padding filled the pill edge to edge.
  assert(/\.seg-btn \{[^}]*min-height: 2\.75rem;[^}]*padding:/.test(read('src/index.css')), 'the segmented buttons are a fixed height with no padding again');
});

ok('the night banner is up exactly while no bus is on the road, and names the next one', () => {
  // It read each line's first and last departure from the terminus and the earliest
  // firstDeparture of any line on any day: "no service" for 34 minutes of a weekday while the
  // last buses were still running and on the boards, and "first bus at 07:00" on weekend
  // mornings that begin at 07:10.
  const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi);
  const lastOnRoad = networkAtRest(at(2026, 8, 28, 22, 50));
  assert(!lastOnRoad.atRest, 'at 22:50 on a Monday the banner says no service while the last buses run');
  const night = networkAtRest(at(2026, 8, 28, 23, 30));
  assert(night.atRest && night.daysAhead === 1 && night.firstBus.replace('~', '') === '06:50', `after the last bus on a Monday the next is not Tuesday's first: ${JSON.stringify(night)}`);
  assert(night.firstBus.startsWith('~'), "Tuesday's first run starts at a stop that is not a timing point, and its time is not marked as worked out");
  const saturdayDawn = networkAtRest(at(2026, 9, 3, 7, 5));
  assert(saturdayDawn.atRest && saturdayDawn.daysAhead === 0 && saturdayDawn.firstBus.replace('~', '') === '07:10', `at 07:05 on a Saturday nothing runs until 07:10: ${JSON.stringify(saturdayDawn)}`);
  const sanFroilanEve = networkAtRest(at(2026, 9, 4, 23, 30));
  assert(sanFroilanEve.firstBus.replace('~', '') === '07:10', `the night before San Froilán the first bus is the Sunday timetable's: ${sanFroilanEve.firstBus}`);
  assert(translations('es').nightBanner.closed('07:10', dayWord('es', 1)) === 'Sin servicio · primer bus mañana a las 07:10', 'the banner sentence does not read');
});

ok('a malformed address is the caller’s mistake on both servers, and the build keeps to its own folder', () => {
  // `/api/paradas/%E0%A4%A/agora` was a 500 and a stack trace in the log on express, and an
  // uncaught URIError on the worker. And the precompressed-file guard compared without a
  // separator, so a path into dist-server, which also begins "dist", passed it.
  const server = read('server.ts');
  assert(/err\.status >= 400 && err\.status < 500 \? err\.status : 500/.test(server), 'the express error handler answers a 4xx as a 500 again');
  assert(/target\.startsWith\(distPath \+ path\.sep\)/.test(server), 'the precompressed-file guard lets a sibling of dist/ through again');
  const worker = read('worker/index.ts');
  assert(/try \{\s*code = decodeURIComponent\(stopMatch\[1\]\);\s*\} catch/.test(worker), 'the worker decodes the stop code unguarded again');
});

ok('the planner never plans from somewhere the phone did not say, and never shows its GPS token', () => {
  // With the location refused it planned from Lugo's centre under "📍 Mi ubicación" -- what
  // the stops screen refuses to do. And the token itself, my_location, was printed in the
  // row above the answer, in the recent trips and in the destination field after a swap.
  const planner = read('src/components/RoutePlannerView.tsx');
  assert(!/LUGO_CENTER/.test(planner), 'the planner falls back to Lugo’s centre for a refused location again');
  assert(/\{gpsRefused && \(/.test(planner) && /t\.map\.locationDenied/.test(planner), 'a refused location is no longer said');
  assert(/\{placeLabel\(originQuery\)\} → \{placeLabel\(destQuery\)\}/.test(planner), 'the row above the answer prints the GPS token again');
  assert(/\{placeLabel\(route\.from\)\}/.test(planner) && /\{placeLabel\(route\.to\)\}/.test(planner), 'the recent trips print the GPS token again');
  assert(/display=\{destQuery === 'my_location' \? placeLabel\(destQuery\)/.test(planner), 'a swapped GPS origin shows as "my_location" in the destination again');
});

ok('the itinerary vouches for the boarding time only, and marks a worked-out arrival', () => {
  // One chip per leg, at its foot, with the departure's precision: under "Baja en 07:30" it
  // read HORARIO OFICIAL for an arrival the timetable does not print -- 966 of 6,469 legs
  // over the quick destinations on a weekday morning -- while the answer above said ~07:30.
  const itinerary = read('src/components/planner/Itinerary.tsx');
  const board = itinerary.indexOf('label={t.planner.board}');
  const chip = itinerary.indexOf('<Provenance precision={seg.precision');
  const alight = itinerary.indexOf('label={t.planner.alight}');
  assert(board > 0 && chip > board && alight > chip, 'the provenance chip no longer sits under the boarding time');
  assert(/label=\{t\.planner\.alight\}[^>]*estimated=\{seg\.arrivalPrecision !== 'published'\}/.test(itinerary), 'the alighting time no longer says when it is worked out');
});

ok('the favourites show a stop’s lines by their number, each once', () => {
  // The badges printed the line's id: on 96 of the 417 stops one read "11-Igrexa de Bóveda",
  // "11-Calde" or "11-Santa Comba" where the bus says "11", and on three the 11 came twice.
  const both = BUS_STOPS.find((s) => s.lines.includes('11') && s.lines.some((id) => id.startsWith('11-')));
  assert(both, 'no stop is served by the 11 and one of its variants any more; the check needs another case');
  const numbers = linesByNumber(both.lines).map((l) => l.number);
  assert(numbers.length === new Set(numbers).size && numbers.includes('11'), `${both.name}: ${numbers.join(' ')}`);
  for (const stop of BUS_STOPS) {
    const distinct = new Set(stop.lines.map((id) => BUS_LINES.find((l) => l.id === id)?.number));
    assert(linesByNumber(stop.lines).length === distinct.size, `${stop.name}: the badges do not match its lines' numbers`);
  }
  const favs = read('src/components/FavoritesDrawer.tsx');
  assert(/linesByNumber\(stop\.lines\)/.test(favs) && !/number=\{l\}/.test(favs), 'the favourites badges print the line id again');
});

ok('a saved row’s bin is a named 44 px button, and its arrow is not a second, nameless one', () => {
  // The bin was 28 px with only a title, a finger's width from the arrow; the arrow was a
  // button with no name, repeating what the row itself does, read out as just "button".
  const favs = read('src/components/FavoritesDrawer.tsx');
  assert(/onClick=\{onRemove\} aria-label=\{removeLabel\}[^>]*h-11 w-11/.test(favs), 'the bin is small or nameless again');
  assert(/onClick=\{onOpen\} tabIndex=\{-1\} aria-hidden="true"/.test(favs), 'the arrow is a second, nameless stop for the keyboard again');
});

ok('the line screen: today’s hours from today’s runs, every departure, no box scrolling inside the page', () => {
  // "Horario de servizo" printed the line's first and last departure of any day, 07:15 - 22:00
  // for the 7 on a Tuesday, whose first bus is 07:30. The list and the departures scrolled in
  // boxes of their own inside the page, 520 px and two rows; the table's title was cut at 28
  // characters; and an invisible hover hint pushed every stop row 7 px past its column.
  const lines = read('src/components/LinesView.tsx');
  assert(/label=\{t\.lines\.serviceHoursToday\}>\s*\{runs\.length \?/.test(lines), 'the hours are not today’s runs again');
  assert(!/max-h-\[520px\]|max-h-24/.test(lines), 'a box scrolls inside the page again');
  assert(!/\.slice\(0, 28\)/.test(lines), 'the departures title is cut again');
  assert(!/t\.lines\.viewStop/.test(lines), 'the invisible hover hint is back');
});

ok('with the text at 200 % the side paddings stop growing and the bar keeps its buttons', () => {
  // In rem, the page's, the panel's and the card's side padding doubled with the type: on a
  // 375 px phone they kept 172 px and left a line's name 51 px, "R…". The bar's buttons were
  // rem inside a 46 px bar and pushed the QR button half out of it; the favourites panel was
  // 80 px wider than the screen and hid its own close button.
  const css = read('src/index.css');
  assert(/@utility px-cap-\* \{\s*padding-inline: min\(calc\(var\(--spacing\) \* --value\(number\)\), calc\(1\.25vw \* --value\(number\)\)\);/.test(css), 'the capped side padding is gone');
  for (const file of [...sourcesUnder('src/components'), join(root, 'src/App.tsx')]) {
    for (const [cls] of readFileSync(file, 'utf8').matchAll(/className="[^"]*\bmx-auto\b[^"]*"/g)) {
      assert(!/[\s"]px-(3\.5|4)(?=[\s"])/.test(cls), `${relative(file)}: a page gutter grows with the type again: ${cls}`);
    }
  }
  const bar = read('src/components/TopBar.tsx');
  assert((bar.match(/h-\[44px\] w-\[44px\]/g) ?? []).length === 3 && !/h-11 w-11/.test(bar), 'the bar’s buttons are rem inside a px bar again');
  const favs = read('src/components/FavoritesDrawer.tsx');
  assert(/pl-\[min\(2\.5rem,12\.5vw\)\]/.test(favs) && /w-screen min-w-0 max-w-md/.test(favs), 'the favourites panel can be wider than the screen again');
});

ok('where a name shares its row, it keeps a floor and the rest goes under it', () => {
  // Squeezed beside a badge and a time, a name at 200 % text had nothing left: the board's
  // destination went one letter a line, a line's name was "R…", a search result's spilled up
  // to 130 px out of its box, and in the route options "Co paseo medido xa non chegas a este
  // bus" was printed over the minutes -- and took four lines on a 320 px phone at 100 % too.
  const board = read('src/components/StopArrivalsView.tsx');
  assert((board.match(/min-w-\[6rem\] flex-1/g) ?? []).length === 2 && (board.match(/ml-auto flex shrink-0 items-end gap-1\.5/g) ?? []).length === 2, 'a board row squeezes its destination again');
  const lines = read('src/components/LinesView.tsx');
  assert(/<span className="line-clamp-3 break-words">\{parts\[parts\.length - 1\]\}<\/span>/.test(lines) && /min-w-\[6rem\] flex-1/.test(lines), 'a line card cuts its name to a letter again');
  assert(/ml-auto shrink-0 rounded bg-surface px-2 py-1/.test(read('src/components/TopBar.tsx')), 'a search result squeezes its name beside the pole code again');
  const options = read('src/components/planner/TripOptions.tsx');
  assert(/@container border-y/.test(options) && /@min-\[18rem\]:grid-cols-\[auto_1fr_auto\]/.test(options) && /col-span-2 row-start-2/.test(options), 'the route options squeeze their clocks between the lines and the minutes again');
  assert(!/truncate/.test(options), 'a route option cuts its sentence again');
  assert(/tnum ml-auto shrink-0 text-emph font-bold/.test(read('src/components/planner/Itinerary.tsx')), 'a leg pushes its minutes off the screen again');
  assert(!/truncate/.test(read('src/components/Map/MapControls.tsx')), 'a list on the map cuts a name again');
  assert(/\.seg-btn \{ overflow-wrap: anywhere; \}/.test(read('src/index.css')), 'a word wider than its option spills into the next again');
});

ok('an empty saved stop names its next bus, with its day and its tilde, and the banner keeps its time', () => {
  // A saved stop with no bus left today was a name and nothing else, where the board of the
  // same stop names the next one. And the night banner cut its own time: with the day word in
  // the sentence, "primeiro bus mañá ás ~06:50" ended "~0…".
  const home = read('src/components/StopHome.tsx');
  assert(/next: arrivals\.length \? null : nextServiceAtStop\(stop\.id\)/.test(home) && /t\.stopHome\.nextLater/.test(home), 'an empty saved stop no longer names its next bus');
  assert(/next\.daysAhead > 0 && [^\n]*dayWord\(lang, next\.daysAhead\)/.test(home) && /next\.precision === 'estimated' && <span className="text-ink-3">~<\/span>/.test(home), 'the next bus on an empty saved stop loses its day or its tilde');
  assert(/<span className="block text-body font-semibold">\{t\.nightBanner\.closed\(/.test(read('src/App.tsx')), 'the night banner cuts its sentence again');
});

ok('the page never scrolls under its own bars: main holds what is positioned inside it', () => {
  // <main> was not positioned, so each absolute box inside it -- the screen-reader text of a
  // line card, 1 px -- took its place from the page: on the lines tab the page grew 1,392 px
  // taller than the screen, and a desktop scrollbar narrowed the bottom bar from 375 to
  // 360 px each time the tab opened. The other three tabs had none that far down.
  assert(/<main id="contido" className="relative\b/.test(read('src/App.tsx')), 'main is not the containing block of its absolute boxes again');
  assert(/root\.scrollHeight - root\.clientHeight/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer measures a page taller than the screen');
});

ok('the map’s buses start hidden, and while they are shown the map says they are the timetable’s', () => {
  // Drawn by default and moving, the buses read as tracked ones, and the one sentence saying
  // otherwise lived in a popup that only opens on a tap. Nobody publishes where this
  // network's buses are; the count above the map called them "buses en servizo".
  const map = read('src/components/Map/TransitMap.tsx');
  assert(/useState<Record<Layer, boolean>>\(\{ stops: true, buses: false, routes: true \}\)/.test(map), 'the buses are drawn by default again');
  assert(/\{layers\.buses && \([\s\S]{0,600}\{t\.map\.busesEstimatedNotice\}/.test(map), 'the buses can be on the map without the sentence that says they are estimated');
  assert(/aria-label=\{t\.map\.hideBuses\}/.test(map), 'the sentence lost its way to hide the buses');
  for (const lang of LANGS) {
    assert(/horario|timetable/.test(translations(lang).map.scheduledBusesCount), `${lang}: the bus count no longer says where the buses come from`);
  }
  assert(/name: 'buses'/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer measures the map with its buses on');
});

ok('every focusable thing shows its focus, in forced colours too', () => {
  // WCAG 2.4.7. The two search fields had outline-none and nothing in its place: the focus
  // rule set 2 px of accent and the utility set the style to none, so the keyboard reached
  // them invisibly. Three more drew their focus as a box-shadow ring, which forced colours
  // (Windows' contrast themes) take away; outline-hidden leaves a transparent outline that
  // those themes paint. audit:browser presses Tab through every state and compares.
  for (const file of sourcesUnder('src/components')) {
    const code = readFileSync(file, 'utf8');
    assert(!/\boutline-none\b/.test(code), `${relative(file)} takes the focus outline off with outline-none`);
    for (const [cls] of code.matchAll(/className=(?:"[^"]*|\{`[^`]*)\boutline-hidden\b[^"`]*/g)) {
      assert(/\bring-2\b/.test(cls) || /has-\[input:focus-visible\]:outline-2/.test(code), `${relative(file)} hides the outline with nothing in its place: ${cls.slice(0, 120)}`);
    }
  }
});

ok('a list laid over the page goes on Escape, on a lifted tap outside, and when the focus leaves it', () => {
  // The search results came back over the page each time the field took the focus, with no
  // Escape (1.4.13), and stayed when Tab moved on, so the next controls took the focus behind
  // them (2.4.11); the planner's suggestions did the same over the time and the calculate
  // button. Both closed on mousedown and touchstart, an action on the way down (2.5.2).
  for (const file of sourcesUnder('src')) {
    const code = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert(!/addEventListener\('(mousedown|touchstart|pointerdown)'|on(MouseDown|TouchStart|PointerDown)=/.test(code), `${relative(file)} acts on the way down of a tap (2.5.2)`);
  }
  const bar = read('src/components/TopBar.tsx');
  assert(/document\.addEventListener\('click', away\)/.test(bar) && /event\.key === 'Escape'\) setOpen\(false\)/.test(bar), 'the search results no longer go on a tap outside and on Escape');
  const leaves = /onBlur=\{\(event\) => \{\s*if \(event\.relatedTarget instanceof Node && !event\.currentTarget\.contains\(event\.relatedTarget\)\) (setOpen\(false\)|onLeave\(\));/;
  assert(leaves.test(bar), 'the search results stay over the page when the focus leaves them');
  assert(leaves.test(read('src/components/planner/PlaceField.tsx')) && /onLeave: \(\) => setActiveInput/.test(read('src/components/RoutePlannerView.tsx')), 'the planner’s suggestions stay over the form when the focus leaves the field');
});

ok('the QR code field has a name, and its errors are said and tied to it', () => {
  // A code nobody knows appeared as a red line under the field in silence (4.1.3), with
  // nothing on the field to say it was wrong or why (3.3.1), and the field's only name was
  // the example inside it, gone at the first letter. A refused camera was silent too.
  const qr = read('src/components/QrScannerModal.tsx');
  assert(/aria-label=\{t\.qr\.inputLabel\}/.test(qr), 'the code field is named only by the example in it again');
  assert(/aria-invalid=\{errorMsg \? true : undefined\}/.test(qr) && /aria-describedby=\{errorMsg \? 'qr-manual-error' : undefined\}/.test(qr), 'the code field no longer says it is wrong and why');
  assert(/<p id="qr-manual-error" role="alert"/.test(qr), 'a code that matches no stop is said in silence again');
  assert(/<p role="alert"[^>]*>\s*\{cameraError\}/.test(qr), 'a refused camera is said in silence again');
});

ok('a check of the notices that the reader asked for says it is checking, and what it found', () => {
  // The button's words changed to "Sincronizando" and the cards below changed, and a screen
  // reader was told about neither (4.1.3). A live region carries both, after a press only.
  const view = read('src/components/AlertsView.tsx');
  assert(/<span role="status" className="sr-only">\s*\{isSyncing \? t\.fares\.refreshing : asked \? \(snapshotAt \|\| unreachable \? t\.fares\.unknownStatusTitle : t\.fares\.checked\(liveAlerts\.length\)\) : ''\}/.test(view), 'checking the notices is said in silence again');
  assert(/setAsked\(true\);\s*refresh\(true\);/.test(view), 'the result is no longer said after a press');
  for (const lang of LANGS) {
    const said = [0, 1, 3].map((n) => translations(lang).fares.checked(n));
    assert(new Set(said).size === 3 && said.every((s, i) => i === 0 || s.includes(String([0, 1, 3][i]))), `${lang}: the check’s result does not say how many notices: ${said.join(' / ')}`);
  }
});

ok('the line page names its arrows, says which run is on show, and names a stop by what it shows', () => {
  // The run navigator's two buttons were read as "left arrow" and "right arrow" (4.1.2); the
  // departure on show was filled in and said nothing; a stop row carried a label with its name
  // and time only, so origin, destination, zone, code, "passed" and the bus the timetable puts
  // there never reached a screen reader (1.3.1) and "click Orixe" found nothing (2.5.3); and a
  // saved line was a star an icon cannot say.
  const lines = read('src/components/LinesView.tsx');
  assert(/aria-label=\{t\.lines\.previousRun\}/.test(lines) && /aria-label=\{t\.lines\.nextRun\}/.test(lines), 'the run arrows are read out as arrows again');
  assert(/aria-pressed=\{idx === runIndex\}/.test(lines), 'the departure on show is no longer said to be the one pressed');
  const at = lines.indexOf('role="button"');
  assert(at > 0 && !/aria-label=/.test(lines.slice(at, lines.indexOf('className=', at))), 'a stop row is named apart from what it shows again');
  assert(/<span className="sr-only">, \{t\.lines\.estimatedSr\}<\/span>/.test(lines), 'a stop row no longer says its worked-out time is estimated');
  assert(/<span className="sr-only">\{t\.lines\.savedSr\}<\/span>/.test(lines), 'a saved line is a star that says nothing to a screen reader again');
});

ok('a control named apart from its words still contains the words it shows', () => {
  // 2.5.3: a voice-control user says what they see. The map's line chips show "7" and were
  // named by the route alone; the chip that unfolds them shows "24" and was named without
  // it; the notices link read "servizo1" against a name of "servizo (1)". And a count in
  // brackets is no count at all to a checker, which drops a name's brackets before matching
  // it: the count goes after a colon. audit:browser compares every named control with its
  // visible words, in every state, and runs axe's rule for the same thing.
  const chips = read('src/components/Map/LineChips.tsx');
  assert(/aria-label=\{`\$\{t\.lines\.lineLabel\(branch \? `\$\{line\.number\} \$\{branch\}` : line\.number\)\}: \$\{line\.name\}`\}/.test(chips), 'a line chip is named without the number and the branch it shows again');
  assert(/aria-label=\{`\$\{expanded \? t\.map\.collapseLines : t\.map\.expandLines\}: \$\{listed\.length\}`\}/.test(chips), 'the unfold chip is named without the count it shows again');
  for (const file of ['MenuDrawer.tsx', 'SideNav.tsx']) {
    const code = read(`src/components/${file}`);
    assert(/\{label\}<\/span>\s*(\{\/\*[\s\S]*?\*\/\})?\{' '\}\s*\{badge > 0/.test(code), `${file}: the words and the count run together again`);
    assert(/aria-label=\{badge > 0 \? `\$\{label\}: \$\{badge\}` : undefined\}/.test(code), `${file}: the count in the name is in brackets again, where a checker drops it`);
  }
  assert(/`\$\{t\.menu\.open\}\. \$\{t\.menu\.alerts\}: \$\{alertCount\}`/.test(read('src/components/TopBar.tsx')), 'the menu button’s count is in brackets again');
  assert(/push\('label', el, 'shows "'/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer compares names with the words controls show');
});

ok('no words are cut off where 320 px, 200 % text or a reader’s text spacing needs them', () => {
  // 1.4.10, 1.4.4, 1.4.12. Eight places cut a name or a sentence with an ellipsis or a line
  // clamp, and each lost words under one of the three: the map's line list and branch names,
  // a saved line, the night banner, the planner's suggestions and its question, the map's
  // stop sheet. Three stay, each named here with its reason: the line card's three lines,
  // which no WCAG condition cut in audit:browser; the first half of a line's name, shown only
  // on a tablet as a hint beside the whole; and the operator's one-word line label.
  const allowed: Record<string, string[]> = {
    'LinesView.tsx': ['<span className="line-clamp-3 break-words">{parts[parts.length - 1]}', '<span className="hidden truncate text-ink-2 font-semibold sm:inline lg:hidden">'],
    'StopArrivalsView.tsx': ['<span className="min-w-0 flex-1 truncate text-body font-bold text-ink">{operatorLineLabel('],
  };
  for (const file of [...sourcesUnder('src/components'), join(root, 'src', 'App.tsx')]) {
    const code = readFileSync(file, 'utf8');
    const name = file.split(sep).pop()!;
    for (const m of code.matchAll(/\b(truncate|line-clamp-\d)\b/g)) {
      const line = code.slice(code.lastIndexOf('\n', m.index) + 1, code.indexOf('\n', m.index)).trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('{/*')) continue;
      assert((allowed[name] ?? []).some((snippet) => line.includes(snippet)), `${relative(file)} cuts words again: ${line.slice(0, 140)}`);
    }
  }
  assert(/cut by a line clamp/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer looks for text cut by a line clamp');
});

ok('a label a map shows on hover stays while the pointer moves onto it, and goes on Escape', () => {
  // 1.4.13. Leaflet closed a stop's name the moment the pointer left the dot, so a reader
  // who magnifies the screen could never move onto it to read it, and there was no key to put
  // it away. Every map is built in useLeafletMap, so the one change covers the three.
  const hook = read('src/hooks/useLeafletMap.ts');
  assert(/const unhover = hoverableTooltips\(instance\);/.test(hook) && /unhover\(\);/.test(hook), 'the maps no longer make their hover labels hoverable');
  assert(/owner\.off\('mouseout', owner\.closeTooltip\)/.test(hook) && /owner\.on\('mouseout', leave\)/.test(hook) && /label\.addEventListener\('mouseenter', stay\)/.test(hook) && /label\.style\.pointerEvents = 'auto'/.test(hook), 'a hover label closes again as the pointer leaves its marker for it');
  const grace = Number(/export const HOVER_GRACE_MS = (\d+);/.exec(hook)?.[1]);
  assert(grace >= 150 && grace <= 1000, `a hover label waits ${grace} ms for the pointer: too short to cross to it, or long enough to be in the way`);
  assert(/event\.key === 'Escape' && open\) map\.closeTooltip\(open\)/.test(hook), 'Escape no longer puts a hover label away');
  assert(/1\.4\.13: Escape does not put the hover label away/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer tries the map’s hover labels');
});

ok('a map moves without a drag: a tap brings that spot to the centre', () => {
  // 2.5.7. The view moved only by dragging, a gesture some hands cannot make. A single tap on
  // the map pans there; a stop's tap is the stop's, and a double click still zooms.
  const hook = read('src/hooks/useLeafletMap.ts');
  assert(/const unpan = panOnClick\(instance\);/.test(hook) && /unpan\(\);/.test(hook), 'the maps no longer pan on a tap');
  assert(/map\.on\('click', onClick\)/.test(hook) && /map\.panTo\(event\.latlng/.test(hook), 'a tap on the map no longer brings that spot to the centre');
  assert(/if \(original\?\._stopClaimed\) return;/.test(hook) && /map\.on\('dblclick', onDouble\)/.test(hook), 'a tap on a stop, or a double click, pans the map too');
  assert(/animate: !window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(hook), 'the pan animates under reduced motion');
  assert(/2\.5\.7: a click on the map does not move it/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer tries to move the map without a drag');
});

ok('the buses on the map are not Tab stops, and a screen reader still finds them', () => {
  // 2.4.11. Leaflet made every bus a Tab stop, and with the buses on, the focus went to buses
  // past the edge of the map and under the buttons that float on it. What a bus's popup says
  // the lines screen says, where the keyboard reaches it; the bus stays an image with a name.
  const buses = read('src/components/Map/VehicleLayer.tsx');
  assert(/L\.marker\([^)]*\{[^}]*keyboard: false[^}]*\}\)/.test(buses), 'the buses on the map are Tab stops again');
  assert(/setAttribute\('role', 'img'\)/.test(buses) && /setAttribute\('aria-label', label\)/.test(buses) && (buses.match(/\bname\((existing|marker), label\)/g) ?? []).length === 2, 'a bus on the map lost its name, or its name is not set again when its icon is rebuilt');
});

ok('in forced colours a pressed control, the current tab and the current line still look it', () => {
  // Windows' contrast themes repaint fills and tints in the system's few colours, and those
  // three said "this one" with a fill or a tint alone. audit:browser emulates the mode and
  // compares each pressed or current control with a neighbour.
  const css = read('src/index.css');
  const block = css.slice(css.indexOf('@media (forced-colors: active)'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert(/\[aria-pressed='true'\],\s*\[aria-current\]:not\(\[aria-current='false'\]\) \{\s*outline: 2px solid Highlight;/.test(block), 'a pressed or current control looks like its neighbours in forced colours again');
  assert(/:focus-visible \{\s*outline: 4px double Highlight;/.test(block), 'in forced colours a pressed control with the focus shows one of the two, not both');
  assert(/name: 'forced', desktop: false/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer looks at forced colours');
});

ok('the ride screen keeps its stop names whole, its bar on the screen, and the focus out from under the bar', () => {
  // At 200 % text a stop's name had 100 px beside "baixas aquí" and its longest word ran out
  // of the row; the bar at the foot took its side margin in plain rem and ran 11 px off the
  // screen. And the keep-awake switch took the focus entirely behind that bar (2.4.11).
  const ride = read('src/components/TripCompanionView.tsx');
  assert(/min-w-\[min\(6rem,100%\)\] flex-1 break-words text-body \$\{passed/.test(ride) && /flex min-h-11 flex-wrap items-center/.test(ride), 'a stop on the ride is squeezed beside its label again');
  assert(/trip-bar anim-sheet-up sticky bottom-0 z-10 -mx-\[min\(0\.875rem,4\.375vw\)\][^"]*px-\[min\(0\.875rem,4\.375vw\)\]/.test(ride), 'the ride’s bar grows past the page’s gutter with the type again');
  assert(/<main id="contido" className="[^"]*has-\[\.trip-bar\]:scroll-pb-20/.test(read('src/App.tsx')), 'the focus can go behind the ride’s bar again');
});

ok('a notice quoted from the operator or the council says the language it is written in', () => {
  // 3.1.2. Both write in Spanish (the council's feed is its /es/ edition), and their words are
  // quoted inside Galician and English pages with no lang: a screen reader read them with a
  // Galician or an English voice. Every place the quoted text reaches the screen carries it.
  assert(/const CONCELLO_FEED_URL = 'https:\/\/concellodelugo\.gal\/es\//.test(read('src/services/alertSyncService.ts')) && /export const NOTICE_LANG = 'es';/.test(read('src/utils/operatorNotices.ts')), 'the notices are read in a language NOTICE_LANG does not say');
  const view = read('src/components/AlertsView.tsx');
  assert(/const quoted = source \? NOTICE_LANG : undefined;/.test(view) && (view.match(/lang=\{quoted\}/g) ?? []).length === 3 && (view.match(/lang=\{NOTICE_LANG\}/g) ?? []).length === 2, 'a quoted notice on the notices screen lost its language');
  assert(/\{noticeDays && <p lang=\{NOTICE_LANG\}>\{noticeDays\}<\/p>\}/.test(read('src/components/StopArrivalsView.tsx')), 'the board’s notice strip quotes the operator without its language');
  const lines = read('src/components/LinesView.tsx');
  assert(/<span lang=\{NOTICE_LANG\}>\{alert\.description\}<\/span>/.test(lines) && /<p key=\{j\} lang=\{NOTICE_LANG\}/.test(lines), 'the line page quotes the operator without its language');
});

ok('nothing on screen is readable only in a hover tooltip', () => {
  // A notice naming more than three lines folded the rest into "+N", with their numbers only in
  // a title tooltip: no keyboard and no finger opens one, and a screen reader may not read it.
  // A title may repeat what is on screen; it may not be the only place something is.
  const view = read('src/components/AlertsView.tsx');
  assert(!/cursor-help/.test(view) && !/lines\.slice\(3\)/.test(view) && /\{lines\.map\(\(l\) => \(/.test(view), 'a notice’s lines past the third are only in a hover tooltip again');
  for (const file of sourcesUnder('src/components')) assert(!/cursor-help/.test(readFileSync(file, 'utf8')), `${relative(file)} keeps something in a hover tooltip again`);
});

ok('the planner says which destination is chosen, and reads "to" where the eye sees an arrow', () => {
  // The quick destination chosen was filled in and said nothing (4.1.2); "from → to" hid the
  // arrow from a screen reader and the two places ran together with no direction (1.3.1).
  const planner = read('src/components/RoutePlannerView.tsx');
  assert(/aria-pressed=\{chosen\}/.test(planner) && /chosen \? 'bg-accent text-on-accent'/.test(planner), 'the chosen quick destination is a fill and nothing else again');
  assert(/aria-hidden="true">\s*→\s*<\/span>\s*<span className="sr-only">\{t\.planner\.toSr\}<\/span>/.test(planner), 'a recent route’s two places run together for a screen reader again');
});

ok('every screen can be reached a second way: the search box finds it by its name', () => {
  // 2.4.5. The stops, the lines, the map and the planner were reached from the navigation and
  // from the search and the links between screens; the notices and the fares from the
  // navigation alone. The search box finds every screen by its name, in each language.
  const bar = read('src/components/TopBar.tsx');
  assert(/\[\.\.\.navSections\(t\), \.\.\.asideSections\(t, 0\)\]\.filter\(\(s\) => matchesQuery\(s\.label, dq\)\)/.test(bar) && /onClick=\{choose\(\(\) => onOpenTab\(id\)\)\}/.test(bar), 'the search box no longer finds the screens');
  assert(/onOpenTab=\{goToTab\}/.test(read('src/App.tsx')), 'a screen found in the search box no longer opens');
  for (const lang of LANGS) {
    const t = translations(lang);
    for (const label of [t.nav.stops, t.nav.lines, t.nav.map, t.nav.plan, t.menu.alerts, t.menu.fares]) assert(matchesQuery(label, label.split(' ')[0]), `${lang}: "${label}" is not found by its first word`);
  }
});

ok('the poles on the board’s map are a list too, which a keyboard reaches', () => {
  // 2.1.1. The other poles near a stop were dots on the map's canvas, taken by a tap and by
  // nothing else, and the map's own name said they were "in the list above", which they were
  // not. A folded list of them sits above the map, and the map's name points to it.
  const board = read('src/components/StopArrivalsView.tsx');
  assert(/\{polesNearby\.map\(\(pole\) => \([\s\S]{0,200}onClick=\{\(\) => onSelectStop\(pole\)\}/.test(board), 'the poles near a stop are reached only by a tap on the map again');
  for (const lang of LANGS) {
    const a = translations(lang).arrivals;
    assert(a.stopMapRegion.includes(a.polesNearby), `${lang}: the map's name points to a list that is not the poles' list: "${a.stopMapRegion}"`);
  }
});

ok('a map popup’s close button is readable, named in the reader’s language, and not under the map’s controls', () => {
  // A bus's popup opened under the notice that floats over the map and its close button was
  // covered (2.5.8); Leaflet paints that "×" #757575, 4.19:1 on the dark card (1.4.3), and names
  // it "Close popup" in English inside a Galician page (3.1.2).
  assert(/\.leaflet-container a\.leaflet-popup-close-button \{\s*color: var\(--c-ink-2\) !important;/.test(read('src/index.css')), 'the popup’s close button is Leaflet’s grey again');
  assert(/instance\.on\('popupopen', [^\n]*setAttribute\('aria-label', closeLabel\.current\)\)/.test(read('src/hooks/useLeafletMap.ts')), 'a popup’s close button is named in English again');
  const clear = /autoPanPaddingTopLeft: \[(\d+), (\d+)\]/.exec(read('src/components/Map/popupHtml.ts'));
  assert(clear && Number(clear[2]) >= 100, 'popups on the network map no longer keep clear of the controls over its top');
  assert(/bindPopup\(popupNode\(bus, onOpenLineRef\.current, lang\), POPUP_CLEAR_OF_CONTROLS\)/.test(read('src/components/Map/VehicleLayer.tsx')) && /\.\.\.POPUP_CLEAR_OF_CONTROLS/.test(read('src/components/Map/RouteLayer.tsx')) && /POPUP_CLEAR_OF_CONTROLS\)/.test(read('src/components/Map/useFollowMe.ts')), 'a popup on the network map can open under its controls again');
  for (const lang of LANGS) assert(translations(lang).map.closePopup.trim(), `${lang}: a popup’s close button has no name`);
});

ok('a bus’s popup is not rebuilt under the keyboard’s focus', () => {
  // The popup is rebuilt when its bus passes a stop, and the new content replaced the focused
  // button with the rest: the focus fell to the page (2.4.3). It waits while the focus is in it,
  // and keeps the old key so it is rebuilt once the focus has gone.
  const buses = read('src/components/Map/VehicleLayer.tsx');
  assert(/const holdsFocus = !!existing\?\.getPopup\(\)\?\.getElement\(\)\?\.contains\(document\.activeElement\);/.test(buses) && /drawn\?\.popup !== popupKey && !holdsFocus\) existing\.setPopupContent/.test(buses), 'a bus’s popup is rebuilt under the focus again');
  assert(/popup: holdsFocus \? \(drawnRef\.current\[bus\.id\]\?\.popup \?\? popupKey\) : popupKey/.test(buses), 'a popup skipped under the focus is never rebuilt after');
});

ok('an open dialog leaves the focus where the keyboard put it', () => {
  // useDialog listed onClose among its effect's dependencies, and every caller passes a new
  // arrow on each render: each re-render of the page behind an open dialog -- the map's clock
  // every 3 s, the app's every minute -- put the focus back on its first control (2.4.3).
  const hook = read('src/hooks/useDialog.ts');
  assert(/\}, \[open\]\);/.test(hook) && !/\}, \[open, onClose\]\);/.test(hook) && /onCloseRef\.current\(\);/.test(hook), 'an open dialog takes the focus back to its first control on every re-render again');
  assert(/2\.4\.3: with nothing pressed, the focus moved by itself/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer waits to see the focus stay put in a dialog');
});

ok('the map is read and tabbed in the order it is drawn, and the tab bar hides none of its sheet', () => {
  // 1.3.2 / 2.4.3. On a phone CSS order drew the quick filters first in the map's sheet, and
  // the focus went down past locate and centre and back up to them; over the map, the buses
  // notice came before the line chips drawn above it. And 2.4.11: the sheet sat under the tab
  // bar, which hid its last 67 px and the line rows the focus scrolled there. None of this was
  // seen: the audit's setup pressed the sheet's own hidden close button, so it never opened.
  const controls = read('src/components/Map/MapControls.tsx');
  assert((controls.match(/\border-first\b/g) ?? []).length <= 1, 'the map’s sheet moves a panel with CSS order again, away from where Tab meets it');
  const map = read('src/components/Map/TransitMap.tsx');
  assert(map.indexOf('<LineChips') < map.indexOf('busesEstimatedNotice'), 'the buses notice comes before the line chips drawn above it');
  const z = (source: string, pattern: RegExp) => Number(source.match(pattern)?.[1] ?? NaN);
  const chips = z(read('src/components/Map/LineChips.tsx'), /absolute inset-x-0 top-0 z-\[(\d+)\]/);
  assert(chips > z(map, /absolute inset-x-0 top-16 z-\[(\d+)\]/), 'the line chips no longer open over the buses notice that now follows them');
  assert(z(controls, /fixed inset-x-0 bottom-0 z-\[(\d+)\]/) > z(read('src/components/BottomNav.tsx'), /sticky bottom-0 z-\[(\d+)\]/), 'the tab bar covers the bottom of the map’s sheet again');
  const audit = read('tools/auditBrowser.ts');
  assert(/no dialog is open after the setup/.test(audit) && /getComputedStyle\(e\)\.visibility !== 'hidden'/.test(audit), 'a dialog state can pass the audit without its dialog open');
  assert(/which the focus reached before it, in the same column/.test(audit), 'the browser audit no longer compares the Tab order with where things are drawn');
});

ok('a map popup the keyboard goes into is brought inside the map first', () => {
  // 2.4.11: a popup half off the map, and the focus reached its close button past the edge of
  // the screen: the browser scrolled the map's box to it and Leaflet scrolled it back. Measured
  // scrolled, the first fix panned the wrong way. Only for the keyboard: a pressed button must
  // not slide from under a finger.
  const hook = read('src/hooks/useLeafletMap.ts');
  assert(/instance\.on\('popupopen', popupInViewOnFocus\)/.test(hook) && /addEventListener\('focusin'/.test(hook) && /map\.panBy\(\[dx, dy\]/.test(hook), 'a popup the keyboard enters is no longer brought into view');
  assert(/focus\.target\.matches\(':focus-visible'\)\) return;/.test(hook), 'the popup pans under a pointer’s press too');
  assert(/inViewOnFocus\.has\(el\)/.test(hook), 'each opening of a bound popup adds another focus listener, and another pan');
  assert(/seen\.left \+ container\.scrollLeft/.test(hook) && /seen\.top \+ container\.scrollTop/.test(hook), 'the popup is measured with the map’s box scrolled to the focus, and panned the wrong way');
  assert(/Three of the map's own arrow keys/.test(read('tools/auditBrowser.ts')), 'the browser audit no longer moves the map before the keyboard reaches a bus popup');
});

ok('the small "never"s in the comments hold', () => {
  // Five promises written as a comment beside the line that keeps them, and held by nothing
  // else: the stops screen never guesses where you are; the scanner never leaves the camera
  // on behind a closed dialog; a stop change never leaves the last stop's operator minutes on
  // screen; colour never carries provenance alone; checkFares reports and never applies.
  const home = read('src/components/StopHome.tsx');
  assert(!/LUGO_CENTER/.test(home) && /\(\) => \{\s*\/\/[^\n]*\n\s*setLocationError\(t\.stopHome\.denied\);/.test(home), 'the stops screen falls back to a position the phone never gave');
  const scanner = read('src/components/QrScannerModal.tsx');
  assert(/if \(!isOpen\) stopCamera\(\);/.test(scanner) && /streamRef\.current\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/.test(scanner), 'the scanner can leave the camera running behind a closed dialog');
  assert(/useEffect\(\(\) => \{\s*setTimes\(null\);/.test(read('src/hooks/useOperatorTimes.ts')), 'a stop change can leave the previous stop’s operator minutes on screen');
  const chip = read('src/components/ui/Provenance.tsx');
  assert((chip.match(/\{text\}/g) ?? []).length === 2 && /t\.common\.officialBadge/.test(chip) && /t\.common\.estimatedBadge/.test(chip) && /border-dashed/.test(chip), 'a provenance chip carries its meaning in colour alone: both say their label, the estimated one dashed');
  assert(!/\b(writeFile|writeJson|appendFile|createWriteStream)/.test(read('tools/checkFares.ts')), 'checkFares.ts writes a scraped fare somewhere; it reports a disagreement and applies nothing');
});

ok('no check reached the network', () => {
  // The other half of the refusal at the top: syncOfficialAlerts and the operator reader turn
  // a failed request into an answer, so a check that forgot its stub would pass on "unreachable".
  assert(reachedOut.length === 0, `checks tried to reach ${reachedOut.join(', ')}; every gate runs offline`);
});

// Last on purpose: it counts itself. The README quoted 141 while this file ran 143, which
// is the kind of figure the front-doors rule exists for and the one nobody re-reads.
ok('the README quotes the number of checks this file runs', () => {
  const readme = read('README.md');
  const quoted = readme.match(/^(\d+) comprobacións con asercións/m)?.[1];
  assert(quoted === String(checks + 1), `README says ${quoted ?? 'nothing'} checks; this file runs ${checks + 1}`);
});

console.log(`\n${checks} checks passed\n`);
