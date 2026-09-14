/**
 * One runnable check for the logic that used to be wrong.
 *
 *   npm test
 *
 * Every case below corresponds to a bug found in the audit, so a regression fails here
 * rather than in the browser.
 */
import assert from 'assert';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { BUS_STOPS, BUS_LINES } from '../src/data/transitData';
import { scheduledDuration } from '../src/utils/schedule';
import { operatorTimesForStop, parseOperatorTimes } from '../src/services/operatorTimes';
import { operatorTimesResponse } from '../src/services/operatorTimesRoute';
import { daysLabel, frequencyLabel } from '../src/utils/serviceLabels';
import { CSP_HEADER, CSP_META, THEME_INIT_HASH } from '../src/security/csp';
import { THEME_INIT_SOURCE, THEME_STORAGE_KEY } from '../src/security/themeInit';
import { createHash } from 'node:crypto';
import { REPO_URL } from '../src/project';
import { SITE_PATHS, robotsTxt, siteUrl, sitemapXml, structuredData } from '../src/seo';
import { extractAlertsFromHtml, extractConcelloNotices } from '../src/services/alertSyncService';
import { clockDriftFromTimetable } from '../src/utils/clock';
import { MAX_QUERY_LENGTH, calculateRelevanceScore, matchesQuery, normalizeText, withinEditDistance } from '../src/utils/searchUtils';
import { LANGS, translations } from '../src/i18n';
import type { RoutePlanResult } from '../src/types';
import {
  tripProgress,
  rememberPassed,
  AT_STOP_RADIUS_M,
  MISSED_AFTER_MIN,
  BOARDING_SOON_MIN,
  boardingIsNow,
  startTrip,
  advanceTrip,
  tripPhase,
  currentLeg,
  legTimes,
  shouldAskIfMissed,
  confirmBoarded,
  missedBus,
  packTrip,
  unpackTrip,
} from '../src/utils/tripProgress';
import { ALARM_RADIUS_M } from '../src/services/stopAlarm';
import { poleCode, FARES } from '../src/data/transitData';
import { isSnapshotStale } from '../src/utils/snapshotAge';
import { plainText } from '../src/utils/html';
import { PATHS } from '../src/routes';
import { fetchWalkingPath, walkHopsOf } from '../src/services/walkingPath';
import { routeOnFoot } from '../src/utils/walkRouter';
import { metresBetween } from '../src/utils/geo';
import { syncOfficialAlerts } from '../src/services/alertSyncService';
import {
  buildRuns,
  handoverMinutes,
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
  NEARBY_STOP_LIMIT_METRES,
  timingPointStopCount,
  getNearestStopToCoords,
  findStop,
  planSmartTrip,
  resolveLocationQuery,
  QUICK_DESTINATIONS,
  LUGO_LANDMARKS,
  TRANSFER_BUFFER_ESTIMATED_MIN,
  WALK_MUST_BEAT_BUS_BY_MIN,
} from '../src/utils/transitEngine';
import { hydrateGeometry } from './hydrateGeometry';


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

ok('a leg that drives far further than the crow flies is the route, not a bad snap', () => {
  // The audit flags legs whose road distance is more than four times the straight line,
  // and calls them "two opposite poles of the same street". That is a guess unless the
  // stops are shown to sit on the drawn line: a stop snapped to the wrong vertex invents
  // exactly the same shape, and it would be a real defect rather than a real detour.
  //
  // Both survivors were measured, and both are detours:
  //   3.1/volta  A Tolda (UNED) -> A Tolda (Cruce pista Bosende)   360 m for 70 m,
  //     osm-surveyed, at vertices 0 -> 37, i.e. the loop out of the terminus, with the two
  //     stops 6.1 m and 1.4 m off the line.
  //   3.2/volta  Pza. Conde Fontao (Estda. FFCC) -> Rúa Castelao 53   765 m for 137 m,
  //     one of the three directions with no surveyed itinerary, so OSRM's way round a
  //     one-way system, with the stops 4.3 m and 3.6 m off the line.
  //
  // So the count is pinned, and each survivor has to keep proving it is a detour.
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
          assert(
            off <= SNAP_M,
            `${line.number}/${dir.id}: ${stop.name} is ${Math.round(off)} m off the line, so its ${road} m leg is a mis-snap and not a detour`,
          );
        }
      });
    }
  }
  assert(far.length === 2, `${far.length} legs drive over four times the straight line, not 2:\n    ${far.join('\n    ')}`);
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

/** The four 11s share a number; the id tells them apart. */
const fleetOf = (now: Date, number: string, lineId = number) =>
  getScheduledBuses(now).filter((b) => b.lineNumber === number && b.lineId === lineId);

ok('a bus turning around is drawn once, not as its outbound and its return', () => {
  // Every minute of the three service days was swept: the 7 drew its 07:30 outbound
  // still 1.3 minutes short of A Ponte while its 07:45 return had already left it -- one
  // vehicle, 139 m apart, 58 minutes a day. The 11 to Bóveda ran its outbound eight
  // minutes past Barbaín, its last timing point, while the return had left Bóveda on
  // that very minute.
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 7, 45, 30), '7').length, 1, 'line 7 at 07:45:30');
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 8, 22, 0), '11', '11-Igrexa de Bóveda').length, 1, 'line 11 Bóveda at 08:22');
  // And it is the return that stays, because that is where the bus is now.
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 7, 45, 30), '7')[0].direction, 'volta');
});

ok('the handover never takes the second bus off a line that runs two', () => {
  // A departure of the other direction inside a run is not always this bus turning: on
  // the 2 and the 6 the round trip is longer than the headway, so it is the other
  // vehicle. The rail is the run's last printed timing point -- the 6's return is pinned
  // through Sindicatos, and the outbound that leaves ten minutes earlier falls before it.
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 9, 15, 0), '2').length, 2, 'line 2 at 09:15');
  assert.strictEqual(fleetOf(new Date(2026, 7, 19, 17, 15, 0), '6').length, 2, 'line 6 at 17:15');
  // The same rail keeps the last run of the day whole: without it the 6's 21:05 return
  // was cut at 21:10 against the 21:10 outbound, which is the other bus leaving.
  const lastReturn = fleetOf(new Date(2026, 7, 19, 21, 25, 0), '6').filter((b) => b.direction === 'volta');
  assert.strictEqual(lastReturn.length, 1, 'the 6 has its last return on the road at 21:25');
});

ok('a handover never loses a bus, cuts a printed stretch, or lands outside its run', () => {
  // The contract of handoverMinutes, over every run of every line on every day: the
  // marker stops strictly after departure and no later than arrival, never before the
  // run's last timing point, and at no minute does a line the timetable has on the
  // road go dark -- when a marker stops, the leg it handed over to is already drawn.
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

ok('no two landmarks are written at the same point', () => {
  // "Parque da Milagrosa" and "Avenida da Coruña" both carried 43.0205,-7.5606, so two
  // places a reader can ask for were one place. The quick-destination check above only
  // covers the eight on the chips; these 28 are the whole list the search offers, and
  // they are typed by hand. `pnpm check:landmarks` measures them against OSM, which
  // needs the network; this only asks that no two of them are literally the same point.
  const seen = new Map<string, string>();
  for (const landmark of LUGO_LANDMARKS) {
    const point = `${landmark.lat},${landmark.lng}`;
    const already = seen.get(point);
    assert(!already, `"${landmark.name}" and "${already}" are both at ${point}`);
    seen.set(point, landmark.name);
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

ok('the price a trip shows is the one anybody pays', () => {
  // The planner showed 0,45 € as the cost of the trip. That is the Tarxeta Cidadá price,
  // and it assumes the reader holds a card issued by Lugo city council -- somebody visiting
  // pays 0,64 € and the only number on the summary said otherwise. Worse, the detail put
  // the ordinary fare beside it with a line through it, which is the idiom of a shop sale:
  // "this price no longer applies". It applies to everyone without the card.
  //
  // Same rule as the times. The default is the figure that is true for whoever is reading,
  // and the better one is offered rather than assumed.
  assert(
    FARES.singleTicket > FARES.citizenCard,
    'the ordinary fare is no longer the dearer one, so this check is about the wrong number',
  );

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const view = readFileSync(join(root, 'src/components/RoutePlannerView.tsx'), 'utf8');

  // The summary line -- the one figure you see without opening anything -- has to be the
  // ordinary fare. Take the first fare rendered in the file: it is the summary's.
  const firstFare = view.search(/fare\.(singleTicket|citizenCard)Euros/);
  assert(firstFare > 0, 'the planner no longer shows a fare at all');
  assert(
    /^fare\.singleTicketEuros/.test(view.slice(firstFare)),
    'the first fare the planner shows is the discounted one; it should be the ordinary ticket',
  );

  // And no fare is ever struck through.
  assert(
    !/line-through/.test(view),
    'a fare is crossed out again, which reads as a price that no longer applies',
  );
});

ok('the Galician card is called what its own issuer calls it', () => {
  // The app named one card two ways. The fare cards, transitData.ts, the README and the
  // source URL all said TMG; the transfer reminder and the FAQ said TPG, in all three
  // languages -- six strings for a card that does not exist under that name.
  //
  // And the expansion disagreed with the acronym it was expanding: "Tarxeta do transporte
  // público de Galicia (TMG)". Read at tmg.xunta.gal, the issuer writes "Tarxeta TMG" and
  // "tarxeta do Transporte Metropolitano de Galicia" -- metropolitano, which is where the
  // M comes from. A price is never inferred here; neither is the name on the card.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = ['src/i18n/gl.ts', 'src/i18n/es.ts', 'src/i18n/en.ts', 'src/data/transitData.ts', 'README.md'];
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    assert(!/\bTPG\b/.test(source), `${file} still calls the card TPG; the issuer calls it TMG`);
    assert(
      !/transporte p[úu]blico de Galicia|public transport card \(TMG\)/i.test(source),
      `${file} expands TMG as "public transport"; the M is for Metropolitano`,
    );
  }

  // And the fare card itself still names it, in every language.
  for (const lang of LANGS) {
    const title = translations(lang).fares.cards.tmg.title;
    assert(/TMG/.test(title), `${lang}: the metropolitan fare card no longer says TMG`);
  }
});

ok('every map gets its chrome from the one place that has it', () => {
  // Three maps draw the same basemap -- the big one, the route map and the stop mini map --
  // and each built its own furniture. So the "Leaflet |" prefix was dropped in TransitMap
  // and nowhere else, and the route map and the mini map printed a line the big map had
  // already decided was too long for a 375 px screen. The same drift gave the route map
  // scroll-wheel zoom, which on a small map inside a scrolling itinerary means flicking
  // past it zooms the city instead.
  //
  // The prefix now goes in createBasemap, where all three arrive. This is the check that a
  // fourth map cannot be born with the old line, and that nobody puts it back in a view.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const mapDir = join(root, 'src/components/Map');

  const basemap = readFileSync(join(mapDir, 'basemap.ts'), 'utf8');
  assert(
    /attributionControl\?\.setPrefix\(false\)/.test(basemap),
    'createBasemap no longer drops the "Leaflet" prefix, so every map prints it again',
  );

  for (const file of readdirSync(mapDir).filter((f) => f.endsWith('.tsx'))) {
    const source = readFileSync(join(mapDir, file), 'utf8');
    if (!/\bL\.map\(/.test(source)) continue;

    assert(
      /createBasemap\(/.test(source),
      `${file} builds a map without createBasemap, so it gets neither the basemap nor its attribution`,
    );
    assert(
      !/setPrefix\(/.test(source),
      `${file} sets the attribution prefix itself; that belongs in basemap.ts for all of them`,
    );
    // And its name and control titles in the reader's language. The route map was born
    // after the other two got theirs, and said "Zoom in" under a Galician itinerary.
    assert(
      /useMapChrome\(/.test(source),
      `${file} builds a map without useMapChrome, so it is an unnamed tab stop with English zoom buttons`,
    );
  }

  // The two maps that live inside something the reader scrolls have to let them scroll.
  for (const file of ['RouteMap.tsx', 'NearbyMiniMap.tsx']) {
    const source = readFileSync(join(mapDir, file), 'utf8');
    assert(
      /scrollWheelZoom:\s*false/.test(source),
      `${file} zooms on the scroll wheel, and it sits inside a page that scrolls`,
    );
  }

  // The route map has to still be showing the route after its box changes size. It is
  // built inside a column that is display:none on a phone until the reader asks for a
  // plan, and Leaflet's invalidateSize restores the size while leaving the view alone —
  // so the map kept a zoom worked out for a box that no longer existed. Caught at 375x812
  // with the trip drawn 118x288 inside a 297x240 map: three of its twenty-nine pieces
  // were still on screen, and the reader got two streets and a stub of red line.
  const routeMap = readFileSync(join(mapDir, 'RouteMap.tsx'), 'utf8');
  assert(
    /getBounds\(\)\.contains\(/.test(routeMap),
    'RouteMap no longer checks that the trip is still on the map after a resize',
  );

  // And the zoom these maps fit to. `fitBounds` rounds down to a whole zoom level unless
  // told otherwise, which on the 297x240 route map drew the trip at 46% of the box and
  // then jumped to 67% when the reader tapped an unrelated option. The basemap is vector,
  // so it draws at any zoom; the reason belongs to the basemap and so does the setting.
  assert(
    /map\.options\.zoomSnap = 0/.test(basemap),
    'the basemap no longer turns off whole-level zoom snapping, so fitBounds wastes up to half of every map',
  );
  for (const file of readdirSync(mapDir).filter((f) => f.endsWith('.tsx'))) {
    const source = readFileSync(join(mapDir, file), 'utf8');
    assert(
      !/zoomSnap/.test(source),
      `${file} sets zoomSnap itself; it comes from the basemap, like the attribution prefix`,
    );
  }
});

ok('the out-of-service banner still fits on two lines', () => {
  // It was a panel: measured at 162 px on a 375x812, a fifth of the screen, on every tab.
  // With the search bar and the bottom nav that left 513 px for the screen itself, and the
  // route planner's form needs 762. It is two truncating lines now, 55 px, and 619 px left
  // over — but "truncating" is the catch: a longer translation does not wrap and make the
  // banner taller, it silently cuts the sentence off, which is the failure this app is
  // least willing to ship on a stop name or on a service notice.
  //
  // So the budget is in characters, because that is what a Node test can see. It is not a
  // guess: measured in the browser at 375 px, the text column is 279 px wide and the small
  // line renders at about 5.16 px per character, so 54 characters is the edge. The chevron
  // the component appends costs two of them.
  //
  // The bold line carries a time, so it is measured with one in place.
  const SMALL_LINE = 52; // 54 minus the " ›" appended in App.tsx
  const BOLD_LINE = 42;

  for (const lang of LANGS) {
    const t = translations(lang);
    const closed = t.nightBanner.closed('07:00');
    assert(
      closed.length <= BOLD_LINE,
      `${lang}: "${closed}" is ${closed.length} characters and the banner's first line fits ${BOLD_LINE}`,
    );
    assert(
      t.nightBanner.festivals.length <= SMALL_LINE,
      `${lang}: "${t.nightBanner.festivals}" is ${t.nightBanner.festivals.length} characters and the second line fits ${SMALL_LINE}`,
    );
    // The festival sentence is what keeps "no service" from being a lie on the night of
    // San Froilán -- the operator runs extra buses and only ever announces them as a
    // notice. Shortening it is fine; dropping it is not.
    assert(
      /festa|fiesta|festival/i.test(t.nightBanner.festivals),
      `${lang}: the banner no longer mentions the festival reinforcements`,
    );
  }

  // And the row is the link: "see notices" survives as the accessible name of the whole
  // bar rather than as a 44 px row of its own.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  assert(
    /nightBanner\.seeNotices/.test(app) && /sr-only[^>]*>\s*\{t\.nightBanner\.seeNotices\}/.test(app),
    'the notices link is no longer the accessible name of the banner row',
  );
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

ok('PRIVACY.md lists every key this app writes to the device', () => {
  // PRIVACY.md is a promise, and the promise is specific: it names the keys and says what
  // each one holds. A key that gets added without a row here is the document quietly
  // becoming false — and the row that matters most is the new one, because a saved trip
  // is text somebody typed and can be their street, where a stop id is meaningless
  // without the dataset it indexes into.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const privacy = readFileSync(join(root, 'PRIVACY.md'), 'utf8');

  const written = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(full, 'utf8');
        // sessionStorage too: it dies with the tab, but it is still the device keeping
        // something, and the trip it keeps is where somebody is going.
        for (const m of source.matchAll(/(?:local|session)Storage\.(?:setItem|removeItem)\(\s*(?:KEY|storageKey|'([^']+)')/g)) {
          if (m[1]) written.add(m[1]);
        }
        // Keys held in a module constant, which is the shape the hooks use.
        for (const m of source.matchAll(/^const (?:KEY|storageKey) = '([^']+)';/gm)) written.add(m[1]);
      }
    }
  };
  walk(join(root, 'src'));

  assert(written.size >= 4, `only found ${written.size} storage keys; the scan has stopped working`);
  for (const key of written) {
    assert(
      privacy.includes(`\`${key}\``),
      `${key} is written to the device and PRIVACY.md does not mention it`,
    );
  }
});

ok('the trip companion counts stops against the list, and never backwards', () => {
  // The one piece of the "vou no bus" mode with no equivalent anywhere else, and the one
  // that can be wrong without looking wrong: a stop counter that slips does not throw, it
  // shows a plausible number of stops that is not yours. Nothing here is a bus position —
  // the network publishes none — so this is counting a GPS fix against the plan's own
  // stop list, and that is exactly what has to be pinned down.
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
  assert(
    half.stopsRemaining < start.stopsRemaining,
    `the count did not move between stop 0 and stop ${middle}`,
  );
  assert(half.stops[0].passed && half.stops[middle].passed, 'the stops behind are not marked');
  assert(!half.stops[half.stops.length - 1].passed, 'the alighting stop is marked before arriving');

  /*
   * A fix in the middle of nowhere must not walk the count backwards.
   *
   * The bus does not stop at every pole and a phone does not report at every one either,
   * so between stops there is no stop within range. Without carrying what was already
   * reached, the list would un-tick itself while somebody watched it.
   */
  seen = rememberPassed(half, seen);
  const nowhere = tripProgress(plan, { lat: 43.05, lng: -7.65 }, seen);
  assert(
    nowhere.stopsRemaining === half.stopsRemaining,
    `the count moved from ${half.stopsRemaining} to ${nowhere.stopsRemaining} on a fix between stops`,
  );

  // At the alighting pole: nothing left, and it says so.
  const end = tripProgress(plan, at(ride[ride.length - 1]), seen);
  assert(end.arrived, 'standing at the alighting stop and the mode has not noticed');
  assert(end.stopsRemaining === 0, `${end.stopsRemaining} stops left while standing at the last one`);
  assert(end.metresToAlighting !== null && end.metresToAlighting < AT_STOP_RADIUS_M, 'the distance is wrong at the pole');

  /*
   * The radius is wider than some of the published gaps, and that is known rather than
   * tuned away. Ten of the 1,136 consecutive pairs are closer than sixty metres; the
   * tightest reads five, and that five is a coordinate the operator publishes at a
   * junction rather than a gap between two poles — see the note on AT_STOP_RADIUS_M.
   * What must not happen is the count growing quietly, which is what widening the radius,
   * or a re-import that moves a stop, would do.
   */
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
  assert(tight <= 10, `${tight} consecutive pairs are closer than the ${AT_STOP_RADIUS_M} m radius, up from 10`);

  /*
   * And the pairs that are NOT consecutive, which the note above never counted.
   *
   * Six of the 48 directions double back along their own avenue, so two stops far apart
   * in the list sit within the radius of each other on the ground: the 4.1 outbound has
   * stop 20 and stop 29 thirty-eight metres apart, its return has the two Pista Muxa
   * poles fifteen apart, the 5.2 and 5DS do it on Ramón Ferreiro. The first counter took
   * the furthest stop in range, so standing at stop 20 ticked 21 to 29 in one go -- and
   * because a stop once passed stays passed, it never came back: nine stops gone from the
   * count and the alert nine stops early, on a line people ride every day.
   *
   * Every such pair in the dataset is tried here, and at each one the earlier pole must
   * be the one counted.
   */
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
  // The mode is a cursor over plan.segments driven by GPS fixes. What must hold: nobody
  // is "on the bus" until the phone has seen them past the pole they boarded at; the
  // alert rings once per leg and never for the leg being waited for; reaching the end of
  // the first ride hands the cursor to the second, and walking from one pole to the other
  // does not hand it back -- judged on distance alone, a fix 70 m from the alighting pole
  // put the reader back on the bus they had just left.
  const now = new Date(2026, 8, 8, 9, 0, 0);
  const plan = planTrips('Intercentros Campus Universitario USC', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to follow');
  const legs = plan.segments.flatMap((seg, i) => (seg.type === 'bus' ? [i] : []));
  assert(legs.length === 2, `this check needs a transfer and the plan has ${legs.length} bus legs`);
  const [first, second] = legs.map((i) => plan.segments[i]);
  assert(
    first.toStop && second.fromStop && first.toStop.id !== second.fromStop.id,
    'this check needs a transfer that walks between two poles',
  );
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
  // A missed bus is not guessed from the GPS, it is asked: three minutes past the printed
  // departure with nobody seen moving, and only then. "Yes" ends the question; "no" reads
  // the next run of that line from that pole -- not a new plan -- and the times on screen
  // become that run's. When the timetable has nothing left today, the mode says so
  // instead of printing tomorrow's first departure as if it were tonight's.
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
  // The button is always there, and what changes is where.
  // Ten minutes before the first bus it leads the answer; after the printed time it does
  // not, because the plan is stale and the replan speaks. The planner's fix is a one-shot
  // the reader asked for, possibly from home, so it is trusted to say "not at the pole"
  // and never to say "at the pole" -- and with no fix at all the clock decides alone.
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
  // The trip lives in sessionStorage so a locked phone does not end it. A BusLine is the
  // whole timetable plus both geometries, so the copy carries ids; what comes back has to
  // be the same plan. And a copy that names a line the dataset no longer has is a trip
  // from before a rebuild: dropped, not half-rebuilt.
  const now = new Date(2026, 8, 8, 9, 0, 0);
  const plan = planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now })[0];
  assert(plan, 'no plan to follow');
  const state = { ...startTrip(plan, { name: 'A', lat: 43, lng: -7.5 }, null), seen: ['s1'], boardedLeg: 1 };

  const text = packTrip(state);
  assert(!/"directions"/.test(text), 'the copy carries whole lines, not ids');
  const back = unpackTrip(text);
  assert(back, 'the copy could not be read back');
  assert(
    back.plan.segments.every((seg, i) => (seg.line?.id ?? null) === (plan.segments[i].line?.id ?? null)),
    'lines did not come back by id',
  );
  assert(back.plan.arrivalTime === plan.arrivalTime && back.seen[0] === 's1' && back.boardedLeg === 1, 'state lost on the way back');
  assert(back.origin?.name === 'A', 'the origin was lost');

  assert(unpackTrip('not json') === null, 'garbage came back as a trip');
  assert(unpackTrip(null) === null, 'nothing came back as a trip');
  assert(unpackTrip(text.replace(/"lineId":"[^"]+"/, '"lineId":"gone"')) === null, 'a line the dataset lacks was rebuilt');
});

ok('one alert radius, shared by the board and the trip companion', () => {
  // The board's alarm and the ride's alert are the
  // same alarm, so there is one radius, one ring and one permission prompt. A second
  // constant creeping in is the two drifting apart.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = join(root, 'src');
  const radii: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && /RADIUS_M\s*=/.test(readFileSync(full, 'utf8'))) {
        for (const m of readFileSync(full, 'utf8').matchAll(/export const (\w*RADIUS_M) = (\d+)/g)) radii.push(`${m[1]}=${m[2]}`);
      }
    }
  };
  walk(src);
  assert(radii.includes(`ALARM_RADIUS_M=${ALARM_RADIUS_M}`), 'the alarm radius moved out of stopAlarm.ts');
  assert(radii.filter((r) => r.startsWith('ALARM_RADIUS_M')).length === 1, `${radii.join(', ')}: the alert radius is declared more than once`);
  const companion = readFileSync(join(src, 'components/TripCompanionView.tsx'), 'utf8');
  const hook = readFileSync(join(src, 'hooks/useTripCompanion.ts'), 'utf8');
  assert(!/watchPosition\(/.test(companion + hook), 'the companion opened its own GPS watch instead of the shared one');
  assert(/subscribePosition\(/.test(hook) && /ringAlarm\(\)/.test(hook), 'the companion does not ring the board\'s alarm');
});

ok('the answer column spaces its blocks in one place', () => {
  // Measured down the Ruta result column on a 375x812, the gaps between the six blocks
  // ran 20, 0, 20, 20, 24 px. Each block carried its own margin -- mb-4 on the notice,
  // mb-5 on the headline, mt-3 on the folded box, mb-5 twice more, mt-6 on the footer --
  // and six numbers kept by hand do not stay in step. The alternatives ended up flush
  // against the box above them, which is the one gap a reader notices.
  //
  // The column owns the rhythm now, the way AlertsView and FaresView already do. A block
  // that brings its own vertical margin back will look right in isolation and put the
  // column out again, so the class names are what is checked.
  // Líneas had the same fault and worse: 10, 12, 16, 16 and 20 px between the blocks of
  // three cards. Both screens are 16 between blocks and 8 from a heading to its content.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['RoutePlannerView.tsx', 'LinesView.tsx']) {
    const view = readFileSync(join(root, 'src/components', file), 'utf8');
    assert(
      /className="space-y-4 bg-bg/.test(view),
      `${file}: no card declares the rhythm its blocks depend on`,
    );
    // mb-1, mb-2 and mb-1.5 sit inside a block -- a heading above its own content -- and
    // are left alone. These were only ever used between blocks.
    for (const stray of ['mb-4', 'mb-5', 'mt-6', 'mt-5', 'mt-4', 'mb-2.5']) {
      const found = new RegExp(`className="[^"]*\\b${stray.replace('.', '\\.')}\\b`).exec(view);
      assert(!found, `${file}: ${stray} is back — "${found?.[0]}" — the column spaces its blocks`);
    }
  }
});

ok('nobody is sent to stand at a pole, and the soonest arrival leads', () => {
  // Two faults, one cause: the plan used to start at `now` whatever the timetable said.
  // Asking at 09:00 for a bus at 09:28 produced a 7-minute walk and 21 minutes of
  // standing, called it a 50-minute journey, and then offered five such journeys that
  // all arrived at 09:50 — five ways of catching the same 4.2.
  //
  // With the departure free to slide, ranking on duration broke the other way: the
  // shortest ride from Fonte dos Ranchos to HULA is a 22-minute 5ES that leaves at
  // 14:08, and at 09:00 it led the list. What is compared now is when you get there.
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
        assert(
          departed === plan.slackMinutes,
          `${from} -> ${to} at ${hour}: leaves ${plan.departureTime}, ${departed} min after the question, but claims ${plan.slackMinutes}`,
        );

        // Standing before the first bus is capped at the margin that exists because the
        // buses here have no GPS and have been seen running early. Waits *between* buses
        // are not: once you are in the system you cannot choose to set off later.
        const firstBus = plan.segments.findIndex((seg) => seg.type === 'bus');
        if (firstBus > 0 && plan.segments[firstBus - 1].type === 'wait') {
          assert(
            plan.segments[firstBus - 1].durationMinutes <= TRANSFER_BUFFER_ESTIMATED_MIN,
            `${from} -> ${to} at ${hour}: ${plan.segments[firstBus - 1].durationMinutes} min standing at the pole before the first bus`,
          );
        }
      }

      // The option on top has to be the one that gets there first, and the only thing
      // allowed to arrive before it is a walk that does not beat it by the documented
      // margin — bus times here are interpolated, so three minutes is not a real lead.
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
  // Every step of the itinerary is drawn with a header carrying the clock ("12:18 →
  // 12:22"), the duration ("4 min") and, for a walk, the distance ("Camiñar ~535 m").
  // The sentence under it used to say all three again, so one 173 px row showed the
  // same time twice and the same minutes twice, and the stop name landed three times
  // across three consecutive rows. Nothing here is a style preference: a figure printed
  // twice is a figure that can disagree with itself once somebody edits one of them.
  //
  // Two rules, both narrow enough that no place name can trip them. No stop name or
  // pole code contains a clock, and none is followed by a metre word.
  const now = new Date(2026, 7, 20, 9, 30);
  for (const lang of LANGS) {
    for (const plan of planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { now, lang })) {
      for (const seg of plan.segments) {
        // The bus step draws its own fields and never renders `instruction`.
        if (seg.type === 'bus') continue;
        const clock = seg.instruction.match(/\d{1,2}:\d{2}/);
        assert(
          !clock,
          `${lang}: "${clock?.[0]}" is in the header already — "${seg.instruction}"`,
        );
        if (seg.walkMeters) {
          const metres = new RegExp(`\\b${seg.walkMeters}\\s*(m\\b|metros|metres)`);
          assert(
            !metres.test(seg.instruction),
            `${lang}: ${seg.walkMeters} m is in the header already — "${seg.instruction}"`,
          );
        }
      }
    }
  }
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

  // Ends on a word boundary, because `includes` answered this before and a key that is
  // the prefix of another key was shielded by it: `yourPositionAccurate` contains
  // `yourPosition`, so the dead one read as used and outlived its screen in all three
  // languages. Both namespace and key are `[a-zA-Z]+` by the parser above, so neither
  // can carry a regex metacharacter into here.
  const used = (haystack: string, namespace: string, key: string) =>
    new RegExp(`\\.${namespace}\\.${key}\\b`).test(haystack) ||
    new RegExp(`\\bt\\.${key}\\b`).test(haystack);

  assert(
    !used('t.map.yourPositionAccurate(3)', 'map', 'yourPosition'),
    'a key that only appears as another key’s prefix is still counting as used',
  );

  const dead = keys.filter(({ ns: namespace, key }) => !used(sources, namespace, key));

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
    // So is seo.ts: the structured data a crawler reads is build-time metadata in one
    // language, not an interface string, and putting it through the dictionary would
    // imply it changes with the reader's choice. It does not.
    if (file.endsWith(`${sep}seo.ts`)) continue;
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

await okAsync('a walking route asks nobody for anything', async () => {
  // This used to guard a rate limit. The router it queued for was FOSSGIS's, asked once a
  // second because that is what they request of anyone using their server, and it was the
  // reason a walking route had to be a button at all: one end of the first leg is the
  // reader's own GPS fix, and it went to a third party with their IP attached.
  //
  // The app carries the pedestrian network now and routes on the device, so the rate
  // limit, the queue and the button are all gone with it. What replaces this check is
  // stronger than what it replaced -- not "asked politely" but "not asked at all". The
  // regression it guards against is somebody reaching for fetch again, and the file it
  // defends is PRIVACY.md, which now says your location does not leave the phone even to
  // draw the walk.
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

ok('a pole with no coordinates is recovered only when its token says which pole it is', () => {
  // Twelve of the operator's 1198 listings arrive with no coordinates, and dropping all
  // twelve cost line 13's return direction Rda. Muralla 56 (Sindicatos) — fourteen lines
  // call there. tools/buildDataset.ts puts one of them back, and only one: a live-panel
  // token is the pole's own identity, so a listing carrying a token that a located pole
  // already has is that pole listed again, not a new one. The other eleven have either no
  // token or one nobody shares, and a listing with neither a position nor a known identity
  // cannot be placed from this source at all.
  //
  // Pinned here so a thirteenth is noticed: a scrape that starts dropping coordinates is
  // a route quietly losing stops, which is the failure this dataset has.
  const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data/official-raw.json'), 'utf8'));
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
    assert(
      stop.officialIds?.includes(listing.ps),
      `${stop.name} does not carry the recovered operator number ${listing.ps}`,
    );
  }

  // The eleven that stay out must stay out: none of them may have reached a stop.
  const numbers = new Set(BUS_STOPS.flatMap((s) => s.officialIds ?? []));
  for (const listing of unplaced) {
    if (recovered.includes(listing)) continue;
    assert(!numbers.has(listing.ps), `${listing.ps} was placed with neither coordinates nor a known token`);
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
  // Scripts are the ones that matter: the build has no inline script and no wasm, and
  // the QR scanner uses the browser's own BarcodeDetector, so 'self' is enough and
  // anything looser means something got added without noticing.
  // script-src is 'self' plus exactly one SHA-256, and that hash is the theme script the
  // page inlines. It used to be 'self' alone, with the theme script as a file — which cost
  // a round trip on the critical path, because the browser would not ask for the entry
  // chunk until it came back (3760 ms to first paint as a file, 3516 ms inlined, at 6x CPU
  // on Slow 4G).
  //
  // A hash is not a relaxation: it admits one byte sequence and nothing else, which is
  // narrower than the 'self' beside it, and an injected <script> cannot match it. What it
  // is vulnerable to is drift, so this does not take the policy's word for the digest — it
  // recomputes it from the script actually inlined in the built page. A hash that no longer
  // matches the bytes is a page whose theme script is silently refused.
  const script = CSP_HEADER.match(/script-src ([^;]+)/)?.[1] ?? '';
  const hashes = [...script.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
  assert(hashes.length === 1, `script-src carries ${hashes.length} hashes, not exactly 1: "${script.trim()}"`);
  assert(
    script.trim() === `'self' '${hashes[0]}'`,
    `script-src is "${script.trim()}", not 'self' plus exactly one hash`,
  );
  assert(hashes[0] === THEME_INIT_HASH, 'the policy hash is not the one computed from the theme script');
  // Spelled out rather than left to the exact match above: a hash and `'unsafe-inline'` are
  // opposite things, and a browser that sees both ignores the second. Saying so by name
  // means the failure reads as what it is.
  assert(!/unsafe-inline/.test(script), "script-src has taken 'unsafe-inline', which is not what a hash is for");
  assert(
    THEME_INIT_HASH === `sha256-${createHash('sha256').update(THEME_INIT_SOURCE, 'utf8').digest('base64')}`,
    'THEME_INIT_HASH is not the digest of THEME_INIT_SOURCE',
  );

  // And against the page that ships, when there is one to look at. CI runs the suite
  // before the build, so a missing dist is skipped rather than failed.
  const built = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');
  if (existsSync(built)) {
    const html = readFileSync(built, 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert(inline.length === 1, `the built page has ${inline.length} inline scripts, not exactly 1`);
    const digest = `sha256-${createHash('sha256').update(inline[0], 'utf8').digest('base64')}`;
    assert(
      digest === hashes[0],
      `the built page inlines a script whose digest is ${digest}, which the policy does not allow`,
    );
    assert(
      html.includes(`'${hashes[0]}'`),
      'the meta policy in the built page does not carry the hash of its own inline script',
    );
  }

  // The map renderer does run a worker, and it is bundled as a same-origin module on
  // purpose: handed a cross-origin worker URL it wraps the thing in a blob instead, and
  // the fix for the resulting error looks like adding blob: here. It is not. The fix is
  // to make the bundler emit the worker again -- see src/components/Map/basemap.ts.
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
  // The app is read standing at a pole, most often after dark. Two things have to agree on
  // this: the hook, and the script that runs before the first paint — which used to be
  // public/theme-init.js and is now inlined from src/security/themeInit.ts, because as a
  // file it cost a network round trip before the entry chunk was even requested.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hook = readFileSync(join(root, 'src/hooks/useTheme.ts'), 'utf8');
  const html = readFileSync(join(root, 'index.html'), 'utf8');

  assert(/return 'dark';/.test(hook), 'useTheme no longer falls back to dark');
  assert(
    /if \(next === 'dark'\) localStorage.removeItem/.test(hook),
    'the default is being written to storage, so clearing site data would not return to it',
  );
  assert(/class="dark"/.test(html), 'index.html no longer ships the dark class');

  // Both read the same key, and nothing catches it if one of them changes.
  const key = hook.match(/const KEY = '([^']+)'/)?.[1];
  assert(key, 'useTheme has no storage key');
  assert(THEME_INIT_SOURCE.includes(`'${key}'`), `the pre-paint theme script does not read ${key}`);
  assert(key === THEME_STORAGE_KEY, `useTheme reads ${key} and themeInit.ts names ${THEME_STORAGE_KEY}`);

  // The script has to survive into the page it is meant to run in, and it only gets there
  // if the build's replacement still finds its tag.
  const built = join(root, 'dist', 'index.html');
  if (!existsSync(built)) return;
  const page = readFileSync(built, 'utf8');
  assert(page.includes(THEME_INIT_SOURCE), 'the built page does not carry the pre-paint theme script');
  assert(!/src="[^"]*theme-init\.js"/.test(page), 'the built page still fetches the theme script as a file');
});

ok('the repository URL is written in one place', () => {
  // Two things break quietly if this is renamed: the "wrong place" link a reader opens
  // from a stop, and the User-Agent buslugo.com sees. SECURITY.md and the issue config
  // are prose and may spell it out; shipped code may not.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (full.endsWith(join('src', 'project.ts'))) continue;
      if (/github\.com\/braisbrg/.test(readFileSync(full, 'utf8'))) {
        offenders.push(full.slice(root.length + 1));
      }
    }
  };
  walk(join(root, 'src'));
  assert(
    offenders.length === 0,
    `hardcodes the repository URL instead of importing REPO_URL: ${offenders.join(', ')}`,
  );
  assert(REPO_URL.startsWith('https://github.com/'), 'REPO_URL is not a GitHub URL');
});

ok('the install-script setting uses the name the pinned pnpm reads', () => {
  // This has been wrong twice, and both times it failed at install rather than here.
  //
  // The setting decides which dependency may run a postinstall -- where a compromised
  // package runs first, before anything is built or tested. pnpm 9 read it from
  // package.json's "pnpm" field; pnpm 10 moved it to pnpm-workspace.yaml as
  // `onlyBuiltDependencies`, a list; pnpm 11 renamed it to `allowBuilds`, a map with an
  // explicit true or false per package. Writing an older name is neither an error nor a
  // warning -- the install just stops with ERR_PNPM_IGNORED_BUILDS, which is how the
  // second one was found: in the repository's first deployment.
  //
  // So this asserts the name matches the pinned major, not merely that some name is
  // present. Parsed by hand rather than with a YAML dependency: both shapes are one flat
  // block, and an unreadable file fails here instead of passing blind.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  const pinned = String(pkg.packageManager ?? '');
  assert(/^pnpm@\d/.test(pinned), `packageManager is "${pinned}", not a pinned pnpm`);
  const major = Number(pinned.slice('pnpm@'.length).split('.')[0]);

  const workspaceFile = join(root, 'pnpm-workspace.yaml');
  const workspace = existsSync(workspaceFile) ? readFileSync(workspaceFile, 'utf8') : '';

  /** Every package named, with what was decided about it. */
  const decided = new Map<string, string>();
  if (major >= 11) {
    const block = workspace.match(/^allowBuilds:\n((?:[ \t]+\S+:.*\n)+)/m);
    assert(
      block,
      'pnpm 11 reads `allowBuilds` from pnpm-workspace.yaml and it is not there, so the ' +
        'install stops on any dependency that has a build script',
    );
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

  // Every package with a build script must be named. esbuild is the only one in this
  // tree, and the answer for it is `false`: since 0.25 its platform binary arrives as an
  // optional dependency and the script only verifies what is already there.
  assert(decided.has('esbuild'), 'esbuild has an install script and no decision recorded for it');
  for (const [name, value] of decided) {
    assert(
      value === 'true' || value === 'false',
      `${name} is set to "${value}"; pnpm writes that placeholder itself and then fails the install`,
    );
  }
  assert(decided.size <= 3, `${decided.size} packages named here; that list should stay short enough to read`);

  // And the settings live in exactly one place: leaving the old copy behind is how the
  // two disagree, and the one pnpm no longer reads is the one that looks reassuring.
  if (major >= 10) {
    assert(
      pkg.pnpm === undefined,
      'package.json still has a "pnpm" field, which this pnpm ignores — move it or drop it',
    );
  }
});

ok('the policy is not sent in development, where it serves a blank page', () => {
  // Sending the CSP from the dev server blocked Vite's inline React preamble and its
  // HMR websocket: `pnpm dev` rendered nothing at all and the console said
  // "@vitejs/plugin-react can't detect preamble". It survived a first look because the
  // browser had the pre-fix response cached, which is worth remembering next time a fix
  // appears not to work.
  //
  // The header still goes out for `pnpm start`, which is what anybody self-hosting runs.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const server = readFileSync(join(root, 'server.ts'), 'utf8');

  const line = server.split('\n').find((l) => l.includes("setHeader('Content-Security-Policy'"));
  assert(line, 'the server no longer sends a Content-Security-Policy at all');
  assert(
    /if \(!isDev\)/.test(line!),
    `the CSP header is sent unconditionally, which breaks \`pnpm dev\`: ${line!.trim()}`,
  );

  // The page carries its own copy for GitHub Pages, and that one must not reach dev
  // either -- it is injected when building, never written into the source HTML.
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert(
    !/Content-Security-Policy/.test(html),
    'index.html has a CSP meta tag again; it applies to `vite dev` and blocks HMR',
  );
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  assert(/apply: 'build'/.test(vite), 'the CSP injector no longer limits itself to builds');
});

ok('no comment quotes a stop count the dataset no longer has', () => {
  // Merging nine duplicated poles moved the total from 429 to 417 and left five
  // comments asserting the old one. Prose in a comment ages exactly like prose in a
  // README, and nothing was watching this kind.
  //
  // Only counts stated about stops are checked, and only in src/: an HTTP 429 in a
  // retry comment is not a stop count, and a sentence about what a line "used to read"
  // is history and allowed to quote the old number.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const total = BUS_STOPS.length;
  const wrong: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // Split on either ending: this repository checks out CRLF on Windows, and a
      // stray carriage return at the end of a line is enough to break "used to" across
      // the join below and defeat the filter.
      const lines = readFileSync(full, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
          if (!/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          // A sentence wraps, so the marker that makes a quotation history sits a line
          // or two above the number it introduces — and "used to" can be split across
          // the wrap, with a comment asterisk landing between the two words.
          const sentence = lines
            .slice(Math.max(0, i - 2), i + 1)
            .map((l) => l.replace(/^\s*(\/\/|\*|\/\*\*?)\s?/, ''))
            .join(' ');
          if (/used to|antes|adoitaba|read "/.test(sentence)) return;
          for (const m of line.matchAll(/\b(\d{3})\s+(stops|paradas|dots|poles|postes)\b/g)) {
            if (Number(m[1]) !== total) {
              wrong.push(`${full.slice(root.length + 1)}:${i + 1} says "${m[0]}", the dataset has ${total}`);
            }
          }
          for (const m of line.matchAll(/\bof the (\d{3})\b/g)) {
            if (Number(m[1]) !== total) {
              wrong.push(`${full.slice(root.length + 1)}:${i + 1} says "of the ${m[1]}", the dataset has ${total}`);
            }
          }
      });
    }
  };
  walk(join(root, 'src'));

  assert(wrong.length === 0, wrong.join('; '));
});

ok('a device on the wrong timezone is told, and one on the right one is not', () => {
  // Every hour on the board comes from Date.getHours(), which is the device's, and every
  // hour in the timetable is Lugo's. A device an hour out shifts the entire board with
  // nothing on screen admitting it -- the one failure this app is built not to have.
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
  // findStop used to fall back to a ranked search when the exact match failed, so a
  // damaged sticker or a mistyped link produced a real arrival board for the wrong
  // pole: "../" and "." both came back as As Pedreiras, "-1" as Rda. Muralla 163-164,
  // "NaN" as Rúa Dinán. Every caller is resolving an identifier, not searching, and a
  // board that is confidently wrong is worse than one that says it does not know.
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
    // Three names belong to two poles each -- opposite sides of the same road -- so a
    // name can only ever resolve to one of them. Any stop with that name will do; a
    // reader who needs a specific pole has its code.
    assert(
      findStop(stop.name)?.name === stop.name,
      `name "${stop.name}" no longer resolves`,
    );
    for (const official of stop.officialIds ?? []) {
      assert(findStop(String(official)), `operator number ${official} no longer resolves`);
    }
  }
});

ok('a query with nothing left in it matches nothing', () => {
  // Normalising strips punctuation, so "." and "../" reached the matchers as the empty
  // string -- and every name in Lugo contains the empty string, and prefix-matches it
  // at 800 points. A single dot resolved to a real stop with real coordinates.
  //
  // The guard fires only when the normalised query is empty, so anything a person
  // actually types is scored exactly as before. The second half of this test is what
  // says so: partial names, accents both ways and expanded abbreviations all still find
  // what they found.
  // Only the ones that really do normalise to nothing. A hyphen survives, and it
  // genuinely appears in "N-VI", so it is a substring match and not this bug.
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
  // This repository checks out CRLF on Windows. An edit that inserts a bare "\n" leaves
  // one LF among hundreds of CRLFs: invisible in an editor, and then a whole-file diff
  // the next time anything touches it. It has also broken a check in this very suite,
  // where splitting on "\n" left a carriage return in the middle of a phrase.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const mixed: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/node_modules|dist|\.git/.test(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|css|html)$/.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8');
      const crlf = (text.match(/\r\n/g) ?? []).length;
      const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
      if (crlf > 0 && lf > 0) {
        mixed.push(`${full.slice(root.length + 1)} (${crlf} CRLF, ${lf} LF)`);
      }
    }
  };
  walk(join(root, 'src'));
  walk(join(root, 'tools'));

  assert(mixed.length === 0, `mixed line endings in ${mixed.join(', ')}`);
});

ok('the search-engine tags are omitted rather than guessed', () => {
  // A canonical or a sitemap carrying the wrong origin is worse than having neither: it
  // sends crawlers to pages that do not exist. So a build with no SITE_URL emits none of
  // it, and anything that is not a plain https origin is treated as no URL at all.
  for (const bad of [undefined, '', 'not a url', 'ftp://example.com', 'http://example.com', 'javascript:alert(1)']) {
    assert(siteUrl(bad) === null, `"${bad}" was accepted as a site URL`);
  }
  assert(siteUrl('http://localhost:3001') === 'http://localhost:3001/', 'localhost is refused, so a local build cannot be checked');
  assert(
    siteUrl('https://braisbrg.github.io/urbanos-lugo') === 'https://braisbrg.github.io/urbanos-lugo/',
    'the trailing slash is not added, so every generated URL would be joined wrong',
  );
});

ok('the structured data does not pass this off as the operator', () => {
  // A crawler reading this should not come away thinking AULUSA or the Concello
  // publishes it. The app says so on every screen; the machine-readable copy has to
  // as well, and it is the one nobody looks at.
  const site = 'https://example.org/';
  const data = JSON.parse(structuredData(site));

  assert(data['@type'] === 'WebApplication', `@type is ${data['@type']}`);
  assert(data.url === site, 'the url field does not match the site');
  assert(
    /non oficial/i.test(String(data.disambiguatingDescription)),
    'the structured data no longer says the project is unofficial',
  );
  assert(data.isAccessibleForFree === true, 'it is free and should say so');

  // robots.txt has to point at a sitemap that is actually emitted beside it.
  const robots = robotsTxt(site);
  assert(robots.includes(`Sitemap: ${site}sitemap.xml`), `robots.txt does not name the sitemap: ${robots}`);
  assert(/^User-agent: \*/m.test(robots), 'robots.txt has no user-agent line');

  const map = sitemapXml(site, ['', 'paradas']);
  assert(map.includes(`<loc>${site}</loc>`), 'the sitemap is missing the site root');
  assert(map.includes(`<loc>${site}paradas</loc>`), 'a path passed to the sitemap did not come out');
  assert(!map.includes('//paradas'), 'joining the site URL to a path doubled the slash');
});

ok('every tab has a path, and the sitemap lists exactly those', () => {
  // The tab routes exist so the back gesture moves between screens instead of leaving
  // the site. Two things have to stay in step with the hook: the sitemap, which would
  // otherwise advertise a path that 404s or miss one that works, and the GitHub Pages
  // fallback, since none of these paths exist as a file on disk.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hook = readFileSync(join(root, 'src/hooks/useTabRoute.ts'), 'utf8');

  // The slugs used to be written out twice, here and in the sitemap, and this check
  // compared the two copies by parsing the hook's source. They are one record now, in
  // src/routes.ts, so what is left to check is that it still covers every tab and that
  // the hook reads it rather than growing its own list again.
  const slugs = Object.values(PATHS);
  assert(slugs.length === 6, `${slugs.length} tabs have a path, expected 6: ${slugs.join(', ')}`);
  assert(new Set(slugs).size === slugs.length, `two tabs share a path: ${slugs.join(', ')}`);
  assert(
    /from '\.\.\/routes'/.test(hook),
    'useTabRoute no longer reads the shared route record, so the sitemap can drift from it',
  );
  for (const slug of slugs) {
    assert(SITE_PATHS.includes(slug), `"${slug}" is a tab route but is not in the sitemap`);
  }

  // A side effect inside a state updater is not guaranteed to run once -- React calls
  // updaters twice in development -- and doing it there pushed the history entry twice,
  // which cost a back press that appeared to do nothing.
  const go = hook.slice(hook.indexOf('const go ='));
  const updater = go.slice(go.indexOf('setTab('));
  assert(
    !/pushState/.test(updater),
    'history.pushState is back inside the state updater, which double-pushes in development',
  );

  // Vite is told to copy the built page to 404.html, and to write one at each tab's own
  // address. Without the first, a mistyped or old link lands on GitHub's own 404 page
  // instead of the app; without the second, every path in sitemap.xml answers 404 --
  // rendering the app, but telling a crawler the page is not there and stopping the
  // link previews the og: tags exist for.
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  assert(/404\.html/.test(vite), 'the SPA fallback copy is gone, so tab paths break on GitHub Pages');
  assert(
    /SITE_PATHS/.test(vite),
    'the build no longer writes a page per route, so every path in the sitemap answers 404',
  );
});

ok('the hand-written notices are dated, not declared current', () => {
  // Three notices about the city are written into this repository rather than fetched:
  // the intermodal works, the pedestrianised old town, the fare discounts. They used to
  // carry the words "obras actuais", "vixente" and "activo" -- a claim about today, made
  // by a file that cannot know, sitting directly under a block that really is checked
  // hourly. A review date replaced them, because a date cannot go out of date.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const view = readFileSync(join(root, 'src/components/AlertsView.tsx'), 'utf8');

  const stamp = view.match(/NOTICES_REVIEWED_ON = '(\d{4}-\d{2}-\d{2})'/);
  assert(stamp, 'the hand-written notices no longer carry a review date');
  const reviewed = new Date(stamp![1]);
  assert(!Number.isNaN(reviewed.getTime()), `"${stamp![1]}" is not a date`);
  assert(reviewed.getTime() <= Date.now(), 'the notices claim to have been reviewed in the future');

  // And nothing puts a claim back where the component spreads the dictionary in.
  for (const lang of ['gl', 'es', 'en']) {
    const dict = readFileSync(join(root, `src/i18n/${lang}.ts`), 'utf8');
    const block = dict.slice(dict.indexOf('notices: ['), dict.indexOf('],', dict.indexOf('notices: [')));
    assert(
      !/\bdate:/.test(block),
      `${lang}.ts gives the hand-written notices a date of their own again; the review date is the only one that is true`,
    );
  }
});

ok("a notice in the operator’s navigation bar is still a notice", () => {
  // buslugo.com does not publish incidents as articles or as a feed. It publishes them as
  // a bell in its top navigation: a red badge with the count, and a msg_list dropdown with
  // one item each. This is the real markup, taken from the page on 28 Aug 2026, the day it
  // was carrying "Retenciones en zona Estación Tren" while this app was telling everybody
  // the network was running normally.
  //
  // That is the worst direction for this to fail in. A notice we cannot parse is a missing
  // warning; silence reported as "todo normal" is a wrong one.
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
  assert(
    /Retenciones/.test(found[0].title),
    `the notice came back as "${found[0].title}" rather than what the page said`,
  );
  assert(
    found[0].severity === 'warning',
    'traffic being held up is a warning, not a note',
  );

  // A page with no notices at all must stay empty rather than inventing one.
  assert(
    extractAlertsFromHtml('<html><body><p>Nada que declarar</p></body></html>').length === 0,
    'a page with no notice list produced a notice anyway',
  );
});

ok("the city's press feed is read for buses and not for everything else", () => {
  // The Concello publishes nothing an app can read about roadworks. What it has is a press
  // feed running at about one item every two months, and now and then one of them is
  // exactly what a passenger needs — free buses for the start of Arde Lucus was in it. So
  // it is read, and filtered hard, because the alternative is a bus app announcing a
  // speech about sustainable architecture.
  const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toUTCString();
  const ancient = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toUTCString();
  const feed = (items: string) => `<rss><channel>${items}</channel></rss>`;
  const item = (title: string, when: string, description = 'corpo da nova') =>
    `<item><title>${title}</title><description>${description}</description>` +
    `<pubDate>${when}</pubDate><link>https://concellodelugo.gal/x</link></item>`;

  const wanted = extractConcelloNotices(feed(item('AUTOBUSES GRATUÍTOS PARA O ARDE LUCUS', recent)));
  assert(wanted.length === 1, `a headline about buses yielded ${wanted.length} notices, expected 1`);
  assert(wanted[0].source === 'concello', 'a city notice has to say it came from the city');

  // Matching the body as well as the headline let two of these through when it was first
  // written: a police communiqué and a speech, both of which mention the streets.
  const aside = extractConcelloNotices(
    feed(item('Comunicado de prensa da Policía Local', recent, 'houbo cortes de tráfico e obras na rúa')),
  );
  assert(aside.length === 0, `a headline that is not about getting around yielded ${aside.length} notices`);

  // Real, and it reached the screen: the traffic tag carries the council signing an
  // agreement with the *Jefatura Provincial de Tráfico* about road-safety courses for
  // schoolchildren. "Tráfico" was in the vocabulary, so a body with the word in its name
  // read as a condition on the street. Topic words match any council story; only an event
  // word means something changed for somebody trying to get around.
  const institution = extractConcelloNotices(
    feed(
      item(
        'El Ayuntamiento y la Jefatura Provincial de Tráfico de Lugo firmarán un acuerdo ' +
          'para impulsar los cursos de educación vial',
        recent,
      ),
    ),
  );
  assert(
    institution.length === 0,
    `an agreement about road-safety courses yielded ${institution.length} notices`,
  );

  // And the one from the same feed that genuinely matters still comes through: a street
  // the buses use, shut by someone else's works, being demanded back.
  const reopening = extractConcelloNotices(
    feed(item('El Ayuntamiento exige a Adif la apertura inmediata al tráfico de la calle Conde Fontao', recent)),
  );
  assert(reopening.length === 1, `the Conde Fontao reopening yielded ${reopening.length} notices, expected 1`);

  // The feed runs at one item every couple of months, so with no cutoff the app would put
  // last spring beside an incident happening now.
  const stale = extractConcelloNotices(feed(item('AUTOBUSES GRATUÍTOS PARA O ARDE LUCUS', ancient)));
  assert(stale.length === 0, 'a press release from months ago is history, not news');

  // Their body arrives as entity-encoded markup. Stripping tags does nothing to it,
  // because at that point there are no tags — there is text that looks like tags, and the
  // reader was shown `&lt;div class=&quot;field field-name-field-entradilla&quot;&gt;` in
  // a line long enough to push the card off the side of the screen.
  const encoded = extractConcelloNotices(
    feed(
      item(
        'Corte de tráfico na rúa Nova',
        recent,
        '&lt;div class=&quot;field&quot;&gt;&lt;p&gt;A rúa estará cortada&lt;/p&gt;&lt;/div&gt;',
      ),
    ),
  );
  assert(encoded.length === 1, 'the encoded item did not come through at all');
  assert(
    !/[<>]|&[a-z]+;/i.test(encoded[0].description),
    `markup survived into the description: "${encoded[0].description}"`,
  );
  assert(
    encoded[0].description === 'A rúa estará cortada',
    `expected the prose alone, got "${encoded[0].description}"`,
  );
});

ok('the Bolaño notice still describes the lines it names', () => {
  // This is the one hand-written notice that makes a checkable claim: that lines 7, 8, 9
  // and 12 have their head at Bolaño Ribadeneira. It used to make an unfalsifiable one
  // beside it -- why the old town was reordered -- with no source recorded anywhere, and
  // both halves read as equally solid. The half that survived is the half the pipeline
  // can prove, so prove it: reroute any of the four and this notice becomes a lie that
  // nothing else in the suite would notice.
  for (const id of ['7', '8', '9', '12']) {
    const line = BUS_LINES.find((l) => l.id === id);
    assert(line, `line ${id} is named in the Bolaño notice but is not in the data`);
    assert(
      /^Bolaño Ribadeneira/.test(line!.name),
      `the notice says line ${id} starts at Bolaño Ribadeneira; the operator calls it "${line!.name}"`,
    );
  }
  assert(
    BUS_STOPS.some((s) => s.name === 'Bolaño Ribadeneira 1'),
    'the stop the notice names is gone from the dataset',
  );
});

ok('a bus whose time has passed stays on the board, marked', () => {
  // Measured against the operator's tracker at Rda. Muralla 118: a line 1.3 due at 19:18
  // arrived at 19:23. The board kept it for sixty seconds and then advertised the next
  // 1.3, ninety minutes out -- so while the bus was three, two and one minute away, the
  // screen said 88, 87, 86. Whoever was waiting had been told to go home.
  //
  // A fixed weekday morning, not the wall clock. The first version of this check asked
  // for a stop with arrivals "right now", which is true while the buses run and false
  // after the last one -- and this suite's own weekly job starts at 05:23, before the
  // first departure, so it would have failed every Monday from the day it was written.
  const probe = new Date(2026, 7, 19, 9, 0, 0); // a Wednesday, as the rest of this suite uses

  const subject = BUS_STOPS.map((s) => ({ stop: s, board: getArrivalsForStop(s.id, probe).arrivals }))
    .find((s) => s.board.length > 0);
  assert(subject, 'no stop anywhere has a departure at nine on a weekday');
  const stop = subject!.stop;

  const [first] = subject!.board;
  const [hh, mm] = first.etaTime.split(':').map(Number);
  const fourLate = new Date(probe);
  fourLate.setHours(hh, mm + 4, 0, 0);

  const after = getArrivalsForStop(stop.id, fourLate).arrivals;
  const kept = after.find((a) => a.etaTime === first.etaTime);
  assert(kept, `the ${first.lineNumber} due at ${first.etaTime} was dropped four minutes later`);
  assert(
    kept!.overdueMinutes === 4,
    `it is on the board but says overdueMinutes ${kept!.overdueMinutes}, expected 4`,
  );

  // And it is not still being called "arriving": that is the most confident label on the
  // screen and this is the least certain row on it.
  assert(kept!.etaMinutes === 0, 'an overdue departure should sit at zero minutes');

  // Past the window it does go, rather than lingering all day.
  const wayLate = new Date(probe);
  wayLate.setHours(hh, mm + 20, 0, 0);
  const gone = getArrivalsForStop(stop.id, wayLate).arrivals.find((a) => a.etaTime === first.etaTime);
  assert(!gone, `the ${first.lineNumber} due at ${first.etaTime} was still listed twenty minutes on`);
});

ok('a line\u2019s trip time comes from the timetable, not from a road model', () => {
  // The card showed the sum of `legSeconds` -- free-flow driving between consecutive
  // stops -- under a heading a reader took for the length of the journey: the 1.1 stop
  // list ran 06:58 to 07:36 and the card beside it said 25 min.
  //
  // The property that was broken is simple and does not depend on any particular number:
  // a bus that stops 39 times cannot do the route faster than a car that never stops.
  // Measured across all 48 directions the schedule runs 2 to 15 minutes longer, median 7.
  for (const line of BUS_LINES) {
    for (const [i, direction] of line.directions.entries()) {
      const scheduled = scheduledDuration(line, i, BUS_STOPS);
      assert(
        scheduled !== undefined,
        `${line.id} direction ${i} has a timetable this app cannot build a run from`,
      );
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
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const view = readFileSync(join(root, 'src/components/LinesView.tsx'), 'utf8');
  assert(
    /scheduledDuration\(/.test(view),
    'the line card no longer asks the timetable how long the trip takes',
  );
  assert(
    !/legSeconds\.reduce/.test(view),
    'the line card is summing legSeconds again, which is driving time with no stops in it',
  );
});

ok('the API is matched case-sensitively, so the rate limiter cannot be walked round', () => {
  // Express matches routes case-insensitively unless told otherwise, and every path
  // comparison in the server is written in lower case. That let /api/PLAN reach the
  // planner while `req.path.startsWith('/plan')` in the limiter saw '/PLAN' and returned
  // false: measured at 35 of 35 requests served with no 429, against a cut-off at 30 for
  // the same endpoint spelled in lower case. Four times the CPU an anonymous client can
  // take on the one endpoint measured at ~24 ms a call.
  //
  // The fix is one setting rather than a .toLowerCase() at each comparison, because the
  // bug was two layers disagreeing about what the path is. Remove the setting and the
  // disagreement comes back everywhere at once, so this is what is guarded.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const server = readFileSync(join(root, 'server.ts'), 'utf8');
  assert(
    /app\.set\(\s*'case sensitive routing'\s*,\s*true\s*\)/.test(server),
    'case-sensitive routing is off again, so /api/PLAN reaches the planner unlimited',
  );

  // And the setting only helps while the comparisons stay lower case; a mixed-case
  // literal would miss the very requests routing now lets through.
  const limiter = readFileSync(join(root, 'src/security/rateLimit.ts'), 'utf8');
  for (const [, literal] of limiter.matchAll(/req\.path\.startsWith\('([^']+)'\)/g)) {
    assert(
      literal === literal.toLowerCase(),
      `the limiter compares req.path against "${literal}", which routing will never produce`,
    );
  }
});

ok('the operator’s own stop page is read by class, not by position', () => {
  // Real markup, taken from info.urbanoslugo.com/qr-demo-paradas/jELq (HULA) at 22:50 on
  // 30 Aug 2026, with the decorative <svg> paths collapsed and nothing else touched. This
  // parser had no test at all, and it is the whole of the QR block on the stop board.
  //
  // Three things about the real page that a hand-written fixture would not have taught:
  // an <svg> sits between the classed div and its <p>, so the field cannot be read as the
  // first child; the line arrives as "L4.2" with a prefix that has to come off; and the
  // time arrives as "20 min" rather than a bare number.
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

  // Malformed markup must not hang. The scan was measured at 1.6 s for a megabyte of
  // unclosed blocks, which is why readCapped exists; this only pins that a quarter of the
  // ceiling stays well inside a second.
  const started = Date.now();
  parseOperatorTimes('<div class="sae-content-info">'.repeat(4000));
  const spent = Date.now() - started;
  assert(spent < 1000, `unclosed blocks took ${spent} ms, which is heading for a stall`);
});

ok('nothing scraped reaches a Leaflet tooltip unescaped', () => {
  // Leaflet takes HTML, not text. Verified in a browser rather than assumed: binding
  // 'Rda. <b id="x">Muralla</b>' to a tooltip puts a real <b> element in the DOM.
  //
  // escapeHtml exists in the map folder for this, and its own comment says stop names come
  // from a scrape -- but RouteMap and NearbyMiniMap never imported it, and carried eight
  // tooltips of scraped names and line numbers straight into innerHTML between them. Three
  // files had the control and two did not, which is the shape of a control that drifts.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

  assert(
    offenders.length === 0,
    `scraped text reaches a Leaflet tooltip without escapeHtml:\n    ${offenders.join('\n    ')}`,
  );
});

ok('the build compresses its assets and the server hands them over', () => {
  // Self-hosting put 544 KB of entry chunk on the wire where 116 KB of brotli would do --
  // four times over, to a phone on mobile data at a bus stop. GitHub Pages compresses on
  // its own so the published site never had it; `npm start` is the documented way to
  // self-host and it did.
  //
  // The fix is two halves that are useless apart: a build plugin that writes the .br and
  // .gz, and a middleware that picks one. Either half alone silently does nothing, which
  // is why they are checked together.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  assert(/emitCompressedAssets/.test(vite), 'the build no longer writes compressed assets');
  assert(
    /brotliCompressSync/.test(vite) && /gzipSync/.test(vite),
    'the build writes only one encoding; a client that takes the other pays full price',
  );

  const server = readFileSync(join(root, 'server.ts'), 'utf8');
  assert(/Content-Encoding/.test(server), 'the server no longer serves the compressed copy');
  assert(
    /'Vary', 'Accept-Encoding'/.test(server),
    'Vary is gone, so a shared cache could hand a brotli body to a client that cannot read it',
  );

  // And if there is a build to look at, the files really are there. Skipped rather than
  // failed when there is not, because the suite runs before the build in CI.
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) return;
  const entry = readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
  if (!entry) return;
  assert(
    existsSync(join(assets, entry + '.br')) && existsSync(join(assets, entry + '.gz')),
    `dist has ${entry} but no compressed copy beside it`,
  );
});

ok('nothing on the critical path waits for a script over the network', () => {
  // The theme script has to run before the first paint, so it blocks the parser wherever it
  // sits. While it was a file that meant a whole round trip of nothing: traced on a
  // throttled phone, the document finished at 890 ms, theme-init.js ran 954 -> 1538, and
  // only then was the entry chunk asked for, at 1548.
  //
  // Two preload tags ahead of it were the first fix and are gone: once the script is inlined
  // there is nothing to preload past, and measured against this same build they were 288 ms
  // *worse* than not having them (3804 ms to first paint with, 3516 ms without, median of
  // three at 6x CPU on Slow 4G). What replaced both is simply having no external script on
  // the critical path at all.
  //
  // So the property is not "the preloads are above the script" any more. It is that the
  // browser can reach the entry chunk without waiting for a network round trip first.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
  assert(
    blocking.length === 0,
    `${blocking.length} external script(s) block the parser before the entry chunk: ${blocking.join(' | ')}`,
  );
});

ok('the mini map is deferred once, where it cannot be forgotten', () => {
  // `lazy()` alone defers the chunk until the component renders, which is not the same as
  // being seen: below lg the stops tab keeps the board mounted behind `hidden`, so on a
  // phone the board's map was built inside `display: none` on every cold start -- 255 KB
  // over the wire and about 700 ms of blocked main thread at 6x CPU on Slow 4G, for a
  // canvas nobody could see, plus a tile request for a map nobody had opened.
  //
  // Both screens used to declare their own `lazy()`. A third call site that imported the
  // map directly would undo all of it and look perfectly ordinary, so the rule is that
  // only the wrapper names it.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const wrapper = join('src', 'components', 'Map', 'LazyNearbyMiniMap.tsx');
  const itself = join('src', 'components', 'Map', 'NearbyMiniMap.tsx');

  const lazy = readFileSync(join(root, wrapper), 'utf8');
  assert(/IntersectionObserver/.test(lazy), 'the map no longer waits until it is on screen');
  assert(/h-\[240px\]/.test(lazy), 'the placeholder no longer holds the height the map takes');

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const relative = full.slice(root.length + 1);
      if (relative === wrapper || relative === itself) continue;
      const source = readFileSync(full, 'utf8');
      // A type-only import costs nothing at runtime; a value import is the whole map.
      if (/^\s*import\s+(?!type\b)[^;]*['"][^'"]*\/NearbyMiniMap['"]/m.test(source)) offenders.push(relative);
    }
  };
  walk(join(root, 'src'));
  assert(
    offenders.length === 0,
    `imports the mini map directly instead of LazyNearbyMiniMap: ${offenders.join(', ')}`,
  );
});

ok('src/data holds only what ships, and the build inputs stay out of it', () => {
  // Four files in src/data were build scaffolding the app never imported: the scrape and
  // three intermediates, 1.4 MB between them. They cost nothing at runtime, which is why
  // nobody noticed, but a reader could not tell which of the ten files ship and one
  // distracted import would have put half a megabyte in the bundle with nothing to catch
  // it. They live in data/ now.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  const BUILD_ONLY = ['official-raw.json', 'osm-routes.json', 'routes.json', 'stop-amenities.json'];
  for (const name of BUILD_ONLY) {
    assert(
      !existsSync(join(root, 'src', 'data', name)),
      `${name} is back in src/data; it is a build input and the app never reads it`,
    );
    assert(existsSync(join(root, 'data', name)), `data/${name} is missing, so the build cannot run`);
  }

  // And nothing under src/ may import one of them, whatever directory it sits in.
  const offenders: string[] = [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const name of BUILD_ONLY) {
      if (text.includes(name)) offenders.push(`${file.slice(root.length + 1)} names ${name}`);
    }
  }
  assert(offenders.length === 0, `a build input reached the app:\n    ${offenders.join('\n    ')}`);

  // The other half of the same rule: everything left in src/data is either imported by the
  // app or is the loader that imports it.
  const shipped = readdirSync(join(root, 'src', 'data'));
  assert(shipped.length > 0, 'src/data is empty, which cannot be right');
});

ok('the address the app calls for /api is the one the policy admits', () => {
  // Two files decide whether a static build can reach a Worker, and they have to agree:
  // src/services/apiUrl.ts builds the request URL, src/security/csp.ts adds that origin to
  // connect-src. Name the variable differently in one of them and the build still
  // succeeds -- it just fails in the browser, silently on Pages, where nobody is looking
  // at a console.
  //
  // This does not prove the policy is right, only that both halves read the same setting;
  // proving the rest means building twice, which `pnpm build` does anyway.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['src/services/apiUrl.ts', 'src/security/csp.ts']) {
    assert(
      readFileSync(join(root, file), 'utf8').includes('VITE_API_ORIGIN'),
      `${file} no longer reads VITE_API_ORIGIN, so the request and the policy can disagree`,
    );
  }

  // And csp.ts runs in Node, where import.meta.env does not exist. Reading it there would
  // throw during the build config's own load, before anything else could report it.
  // Comments stripped first: this file explains that rule in prose, and the first draft
  // of the check failed on its own explanation.
  const csp = readFileSync(join(root, 'src/security/csp.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert(!csp.includes('import.meta.env'), 'csp.ts reads import.meta.env, which is undefined in Node');
});

ok('a hidden HTML comment does not come out as visible text', () => {
  // The same `replace(/<[^>]+>/g, '')` lived in five files, and a comment ends at its
  // first `>` rather than at `-->` — so everything a page author deliberately hid was
  // being read out as text. Found by code scanning, then reproduced before believing it:
  // one pass leaves "x --> visible" where this leaves "visible".
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
  // getNearbyStops ranks every stop and returns them all, which is what the planner and
  // the line lists want. Read as an answer to a person it is nonsense outside Lugo: from
  // Madrid the first result is Santa Comba, 423 km away, and a list of five stops reads
  // as five options to anybody who does not check the units.
  const madrid = getNearbyStops(40.4168, -3.7038).filter((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES);
  assert.strictEqual(madrid.length, 0, 'a phone in Madrid is being offered stops in Lugo');

  const coruna = getNearbyStops(43.3623, -8.4115).filter((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES);
  assert.strictEqual(coruna.length, 0, 'a phone in A Coruña is being offered stops in Lugo');

  // And the limit has to leave the network itself intact, including its loneliest corner.
  // The widest gap between a stop and its nearest neighbour is about 3.5 km, so standing
  // at any stop must still find that stop and standing between two must find one of them.
  for (const stop of BUS_STOPS) {
    const here = getNearbyStops(stop.lat, stop.lng).filter((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES);
    assert(here.length > 0, `standing at ${stop.name} finds no stop within the limit`);
  }
});

await okAsync('fifty people at one pole are one request to the operator, not fifty', async () => {
  // The twenty-second cache only helps once a read has come back. Everything that arrives
  // while one is still in flight used to miss and open its own connection: measured with
  // tools/stressHttp.ts, fifty at once on a cold cache were fifty outbound requests, eight
  // seconds, and a 502 for every one of them.
  //
  // That is somebody else's server, and the comment above the cache promises them "one
  // outbound request a minute however many people are looking". This is that promise.
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
    assert(
      answers.every((a) => a === answers[0]),
      'the concurrent readers did not all get the same answer',
    );
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
  // Express and the Deno worker share one decision (src/services/operatorTimesRoute.ts)
  // so the same code cannot get a 404 from one deployment and a 502 from the other. It
  // was the one piece of services/ the suite never called; this walks its four answers
  // with the operator stubbed, and makes sure no request leaves for a code we cannot
  // resolve -- that is what keeps either server from being a relay for arbitrary codes.
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
  // Two thirds of the network's passing times are modelled rather than printed, and the
  // reason is the source, not the code. The operator publishes one table per line for the
  // whole loop, with two to five timing points in it. So:
  //
  //   48 directions have a weekday pattern
  //   38 of them have two or more printed rows that land on distinct stops of that direction
  //   18 survive chaining, because the rest pair an outbound row with a return one
  //
  // 45 printed rows name no stop of the direction they were printed for, and 43 of those
  // are genuine -- 1.1/volta runs Rúa Mercadorías to As Pedreiras and never passes
  // Sindicatos, so the "Sindicatos" row is not its row. A one-edit fuzzy tier on the name
  // matcher was tried against exactly this measurement and moved 18/48 to 18/48, so it was
  // reverted rather than kept for the two spellings it did resolve.
  //
  // Nothing here can be raised by trying harder; it can only be lowered by a mistake. The
  // numbers are pinned so that losing an anchor -- which silently turns printed times into
  // estimates all along a route -- shows up as a failure and not as a quieter app.
  let directions = 0;
  let anchored = 0;
  let bracketed = 0;
  let extrapolated = 0;

  for (const line of BUS_LINES) {
    line.directions.forEach((direction, di) => {
      const runs = buildRuns(line, di, BUS_STOPS, 'laborable');
      if (!runs.length) return;
      directions++;
      const anchors = runs.reduce<number[]>(
        (best, r) => (r.publishedStopIndices.length > best.length ? r.publishedStopIndices : best),
        [],
      );
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
  // Sixteen directions produce no expeditions on a Sunday -- 1.1, 1.3, 3.1, 5.1 and the
  // four variants of the 11, both ways -- and an audit run on a Sunday cannot tell that
  // apart from buildRuns quietly dropping them. The operator's own sentence settles it:
  // those eight lines say "De lunes a viernes (laborables)" and the other sixteen say
  // "Todos los días". So the question is not how many ran, it is whether what we build
  // matches what the source says, line by line.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const raw = JSON.parse(readFileSync(join(root, 'data/official-raw.json'), 'utf8'));
  const source = new Map<string, { days: string }>(
    (raw.lines as { id: string; days: string }[]).map((l) => [l.id, l]),
  );

  let weekdayOnly = 0;
  let everyDay = 0;
  for (const line of BUS_LINES) {
    const said = source.get(line.id)?.days;
    assert(said, `${line.number} is in the dataset but not in the scrape`);

    const built = new Set((line.services ?? []).flatMap((s) => s.days));
    const sundayRuns = line.directions.reduce(
      (n, _, i) => n + buildRuns(line, i, BUS_STOPS, 'domingo').length,
      0,
    );
    const weekdayRuns = line.directions.reduce(
      (n, _, i) => n + buildRuns(line, i, BUS_STOPS, 'laborable').length,
      0,
    );
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
  // The audit reported directions whose two halves differ -- 3.1 33/23, 13 15/7 -- with no
  // way to tell a genuinely one-way itinerary from stops the build had lost. Rebuilding the
  // itinerary from the scrape answers it: every stop the operator lists is either kept, or
  // dropped for one of exactly two reasons, and both are countable.
  //
  // It found a real loss. Twelve of the 1198 scraped entries carry no coordinates, and one
  // of them -- ps 1200, token uilP -- is Rda. Muralla 56 (Sindicatos), where fourteen lines
  // call. Line 13's return direction had it in the operator's itinerary and not in ours.
  // buildDataset now recovers a tokened pole; the other eleven have no position and no
  // token any located pole shares, so they cannot be placed from this source at all.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const raw = JSON.parse(readFileSync(join(root, 'data/official-raw.json'), 'utf8'));
  const source = new Map<string, { directions: { stops: number[] }[] }>(
    (raw.lines as { id: string; directions: { stops: number[] }[] }[]).map((l) => [l.id, l]),
  );

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

      // 5.1's return has its order repaired against the surveyed itinerary, so the built
      // sequence is a permutation of this one rather than this one. Everywhere else the
      // two must agree exactly, order included.
      const sameSet = kept.length === direction.stops.length && kept.every((id) => direction.stops.includes(id));
      assert(
        sameSet,
        `${line.number}/${direction.id}: the scrape gives ${kept.length} stops, the dataset has ${direction.stops.length}`,
      );
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
  assert(
    thirteen.directions[1].stops.includes(sindicatos.id),
    'line 13 no longer calls at Rda. Muralla 56 (Sindicatos) on the way back',
  );
});

ok('the bounded edit distance agrees with the matrix it replaced', () => {
  // The fuzzy tier of the search stopped computing a distance and started answering
  // "within this many edits", which let it skip a pair on a length difference alone and
  // give up on a row that is already over budget. Both shortcuts are exact, and both are
  // the kind of exact that is easy to get subtly wrong -- a bound that is one too tight
  // is a search that quietly stops finding the typo it was written for.
  //
  // So: the plain matrix, kept here and nowhere else, checked against the shipped
  // version over every word of every stop name in the network.
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
        assert(
          bounded === plain,
          `withinEditDistance("${word}", "${query}", ${max}) said ${bounded}, the matrix says ${plain}`,
        );
      }
    }
  }
  assert(pairs > 100_000, `only ${pairs} pairs compared, which is not a corpus`);

  // And that it is still answering the bounded question rather than computing a distance.
  //
  // A ratio against the matrix above, not a stopwatch: a threshold in milliseconds says
  // more about the machine running it than about the code, while both halves here do the
  // same work on the same pairs. The pairs are the shape the app actually asks about --
  // short words out of stop names against a query somebody has been typing for a while --
  // because that is where the shortcuts pay: a word cannot be two edits from something
  // three times its length, and the rows say so within three of them.
  //
  // Go back to computing the whole distance and this drops to about one.
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
  assert(
    slow > fast * 10,
    `the bounded check is only ${(slow / fast).toFixed(1)}x the matrix (${fast.toFixed(1)} vs ${slow.toFixed(1)} ms); it is computing distances again`,
  );
});

ok('a street can be found by any of the names people give it', () => {
  // The operator writes "Avda. Américas 36". A reader types "Avenida das Américas", or
  // "Avenida de las Américas", and used to get nothing: the abbreviation was expanded,
  // the linking words were not, and neither spelling of them is in the data.
  //
  // The street types come from counting the dataset, not from guessing. 60 of the 417
  // stops start with "Avda.", 36 with "Estda." and 10 with "Czda." — and the last two
  // were missing from the expansion table, so forty-six stops could not be found by
  // their street type at all. "Rúa" leads 107, more than any other word in the network,
  // and a Spanish speaker in Lugo types "calle" for it.
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
  assert(
    /Fonte dos Ranchos/.test(best('Fonte dos Ranchos')?.s.name ?? ''),
    'a name made mostly of linking words stopped resolving to itself',
  );

  // A query of nothing but dropped words used to leave the empty string, and every name
  // contains the empty string: "de" scored all 417 at the word-boundary tier and handed
  // back six of them at random.
  for (const nothing of ['de', 'da', 'de la', 'do', 'linea']) {
    const hit = best(nothing);
    assert(
      !hit || normalizeText(hit.s.name).includes(normalizeText(nothing)),
      `"${nothing}" resolves to ${hit?.s.name}, which does not contain it`,
    );
  }

  // A neighbourhood is how people say where they are, and the stop names do not carry
  // it: none of the 28 stops in A Piringalla has the word in its name. The stop's zone
  // is scored below every match on the name itself, so a name still wins.
  for (const [area, least] of [['Piringalla', 20], ['O Ceao', 30], ['Campus USC', 20]] as const) {
    const found = BUS_STOPS.filter((s) => calculateRelevanceScore(s.name, s.code, s.id, area, s.zone) > 0);
    assert(found.length >= least, `"${area}" finds ${found.length} stops, expected at least ${least}`);
  }
});

ok('a line answers to the words people put in front of its number', () => {
  // A line is stored as a number and its two termini. Nobody types it that way: "linea
  // 12", "liña 12", "L12" and "bus 12" all returned nothing, because the exact-code test
  // compares the raw query against "12" and the name has no such word in it. Only the
  // bare number worked, which is not how anyone asks.
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
  // Built by tools/buildWalkGraph.ts from what OSM calls a way. The thing that makes it a
  // graph rather than a drawing is that two ways sharing a node id are joined, and the
  // way to know that has gone wrong is that the network falls into pieces: a router on a
  // shattered graph does not fail, it quietly answers "no route" for half the city.
  const raw = readFileSync(new URL('../src/data/walk-network.json', import.meta.url), 'utf8');
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

  // The measured figure when this was written was 98.7% in one piece; the rest are
  // rural tracks and ends clipped by the bounding box. Well under that means the node
  // ids stopped joining anything and every route would be a straight line again.
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
  // A* over the graph above. The failure that matters is not "no answer" -- that is
  // visible -- but a confident answer that is wrong, so these check the shape of it
  // rather than trusting a single distance.
  const muralla = BUS_STOPS.find((s) => s.name.startsWith('Rda. Muralla 56'))!;
  const ponte = BUS_STOPS.find((s) => s.name.startsWith('A Ponte (cruce'))!;
  const from: [number, number] = [muralla.lat, muralla.lng];
  const to: [number, number] = [ponte.lat, ponte.lng];

  const route = await routeOnFoot(from, to);
  assert(route, 'no route between two stops in the middle of Lugo');

  // Nothing on the ground is shorter than the line through it. A route that beats the
  // crow means the walk was measured over a shortcut that does not exist -- a slice
  // taken backwards, or an edge counted from the wrong end.
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
  assert(
    Math.abs(drawn - route!.meters) < route!.meters * 0.02 + 5,
    `the polyline is ${Math.round(drawn)} m but the route claims ${route!.meters} m`,
  );

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

  // One route is not enough. Checked over a spread of real pairs, because the failure
  // this catches only showed on endpoints that sit well back from the network -- a stop
  // in a lay-by on the N-VI is 50 m from the nearest walkable way. The distance left that
  // ground out of its total while the drawn line included it, so 125 of 2.631 measured
  // legs reported less than they drew, by up to 101 m, and one answered 55 m for two
  // points 72 m apart. A walk shorter than the line through it is not a walk.
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
      assert(
        Math.abs(drew - leg.meters) <= leg.meters * 0.02 + 8,
        `${a.name} -> ${b.name}: draws ${Math.round(drew)} m, reports ${leg.meters} m`,
      );
      const asTheCrowFlies = metresBetween(a.lat, a.lng, b.lat, b.lng);
      assert(
        leg.meters >= asTheCrowFlies - 1,
        `${a.name} -> ${b.name}: ${leg.meters} m over a ${Math.round(asTheCrowFlies)} m straight line`,
      );
      assert(leg.minutes >= 1, `${a.name} -> ${b.name}: a walk of ${leg.minutes} min`);
    }
  }
  assert(sampled > 50, `only ${sampled} pairs routed; the sweep is not sweeping`);
});

ok('the three front doors say the same true things', () => {
  // The Galician README is the whole documentation, near fifteen hundred lines of
  // measured figures. The Castilian and English ones are deliberately a single screen
  // each: three copies of every number would be three places for a measurement to go
  // stale, and this project's whole claim is that its figures are checkable.
  //
  // What cannot be in one language only is the honest labelling. So this checks that the
  // summaries carry the two things a reader is owed whatever they read in — that the app
  // is not official, and that no time in it is a measurement — and that the counts they
  // do quote still match the dataset.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const doors = ['README.md', 'README.es.md', 'README.en.md'];

  for (const door of doors) {
    const text = readFileSync(join(root, door), 'utf8');

    assert(/Monbus/.test(text) && /Concello de Lugo/.test(text), `${door} does not say who it is not`);
    assert(
      /HORARIO OFICIAL/.test(text) && /ESTIMADO/.test(text),
      `${door} does not show the two labels every time carries`,
    );

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
    const text = readFileSync(join(root, door), 'utf8');
    assert(/\(README\.md\)/.test(text), `${door} does not link to the full README`);
    assert(/\(PRIVACY\.md\)/.test(text), `${door} does not link to the privacy page`);
  }
  const gl = readFileSync(join(root, 'README.md'), 'utf8');
  assert(/README\.es\.md/.test(gl) && /README\.en\.md/.test(gl), 'README.md does not offer the other two');
});

ok('the surfaces seen before the README say "non oficial" first', () => {
  // A search result, a link preview and the install prompt each show one line, and none
  // of them shows the README. The meta description opened with "Horarios oficiais" and
  // the manifest called the app "Bus Lugo" -- the operator's domain -- so the one line a
  // reader saw was the one the whole README exists to deny. The rule README.md states,
  // that "non oficial" goes in the description, is held here for the three lines that
  // carry it; and the meta description stays under 160 characters, past which a search
  // result cuts it and the word could fall off the end.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
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
  // The plan is built from the estimated walk -- the straight line times 1.35 -- and the
  // router then measures the pavement. When the walk to the first stop turns out longer
  // than the cushion the plan handed back as a later departure, setting off in time would
  // mean setting off before now: the bus is gone, and the arrival on screen is a time
  // nobody can reach. Measured over 1,015 options with a bus in them, 180 were doing
  // exactly that and nothing on screen said which.
  //
  // Two things answer it, and both are checked here. The planner can be told the walks
  // that have been measured, so a stop that is really twelve minutes away stops passing
  // for five *before* the candidates are ranked rather than after -- over 312 questions
  // that took the unreachable answers from 47 to 5. And whatever survives that is
  // labelled instead of repaired, because the alternative is printing a time that exists
  // nowhere.
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
    // What the plan itself allowed. Once a measured walk has been handed to planTrips the
    // plan is already built on it, and charging the difference again would move a
    // departure that is already right.
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
  assert(
    after < before,
    `telling the planner the measured walks fixed none of the ${before} unreachable answers`,
  );

  // The other half of the contract: what the retry cannot fix is said, not smoothed over.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const view = readFileSync(join(root, 'src/components/RoutePlannerView.tsx'), 'utf8');
  assert(
    /arrival: shiftClock\(plan\.arrivalTime, fix\.after\)/.test(view),
    'the walk correction is moving the arrival again; a bus you cannot reach does not arrive later, it leaves without you',
  );
  assert(
    (view.match(/unreachableWalk/g) ?? []).length >= 2,
    'nothing on the row or the headline says the measured walk does not reach that bus',
  );
  assert(
    /replannedRef\.current = true;/.test(view),
    'the replan is no longer capped at one; plan -> measure -> plan can oscillate forever',
  );
  for (const lang of LANGS) {
    assert(translations(lang).planner.unreachableWalk.trim().length > 0, `${lang}: nothing to say it with`);
  }
});

await okAsync('walking up a hill costs more than walking down it', async () => {
  // OpenStreetMap has no elevation, so until the IGN's 5 m model was added to the graph
  // every walk cost the same in both directions -- and Lugo has the Miño at the bottom of
  // it and a walled town on top. The climb from the Ponte Romana up to the Praza Maior is
  // about ninety metres of ascent over the same pavement in either direction.
  const graph = JSON.parse(
    readFileSync(new URL('../src/data/walk-network.json', import.meta.url), 'utf8'),
  ) as { junctions: number[]; heights?: number[] };

  const junctionCount = graph.junctions.length / 2;
  assert(graph.heights, 'the graph carries no heights; run pnpm run data:elevation');
  assert(
    graph.heights!.length === junctionCount,
    `${graph.heights!.length} heights for ${junctionCount} junctions`,
  );

  // Delta-coded, like the coordinates. Lugo's lowest ground is the river at about 357 m
  // and the hills out towards Bóveda reach a little over 700; anything outside that is
  // not this city, and a height map read wrong puts hills in the wrong places silently.
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

  // The climb charged is the one along the street, not the difference between its ends.
  // A street that rises and falls between two junctions used to read as flat, and the
  // edges where that happens are the long ones: 3.169 of the 29.489 hide some climb and
  // 287 hide ten metres or more. If `up` and `down` ever went back to being derivable
  // from the two heights, every one of those would silently go flat again.
  const withAscent = JSON.parse(
    readFileSync(new URL('../src/data/walk-network.json', import.meta.url), 'utf8'),
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
    // A street that ends higher than it starts has to cost more going up it than coming
    // down. The two are not exactly the height difference apart -- the profile is filtered
    // to keep a metre of LiDAR noise from becoming a metre of hill, and filtering forwards
    // and backwards are not the same operation -- so what is checked is the direction,
    // over rises big enough for the filter not to be the whole story.
    if (Math.abs(rise) >= 5) {
      assert(
        Math.sign(climbsUp - climbsDown) === Math.sign(rise),
        `edge ${edgeIndex} rises ${rise} m but costs ${climbsUp} m up against ${climbsDown} m down`,
      );
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

  // Not quite the same pavement, and that is the point. Once a climb costs something, the
  // cheapest way up a hill is not always the cheapest way down it: the router will take a
  // longer, gentler street uphill, which is what a person does. What would be wrong is a
  // different trip -- so the two are held within a few per cent of each other rather than
  // pinned to the metre, which is what this asserted while every edge cost the same in
  // both directions.
  const spread = Math.abs(up!.meters - down!.meters) / Math.max(up!.meters, down!.meters);
  assert(spread < 0.1, `${up!.meters} m up against ${down!.meters} m down is a different trip, not a different way up`);
  assert(
    up!.minutes > down!.minutes,
    `${up!.minutes} min up the hill against ${down!.minutes} min down it`,
  );
});

ok('an itinerary has no minutes belonging to nothing', () => {
  // A transfer carries a safety buffer -- two minutes on a published connecting time, four
  // on an estimated one -- so a slightly late bus does not cost the connection. That buffer
  // is time spent standing at the stop, and it was in the clock but in no segment: a bus
  // arriving at 16:52 above a wait starting at 16:56, with four minutes belonging to
  // nothing. 857 of 1.550 planned options had exactly that gap.
  //
  // It hid a worse thing. Starting the wait at the buffered minute put its two ends in the
  // wrong order -- 09:06 to 09:00 -- and the check that walks a plan's timeline reads a
  // step backwards as midnight, so a transfer whose connecting bus left the NEXT MORNING
  // came out as a 1.441 minute gap and passed, while the itinerary printed it as a
  // one-minute change. `buildTransfer` now refuses a wait longer than LONG_WAIT_MIN.
  const points = [...BUS_STOPS.slice(0, 60).map((s) => s.name), ...LUGO_LANDMARKS.map((l) => l.name)];
  let seed = 987654321;
  const roll = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // Two fixed clocks rather than whatever time the suite happens to run at.
  //
  // This used to call planTrips with the real one, and the third defect it found only
  // exists in the few minutes before certain departures: measured on one pair, 40 of its
  // 4.320 options across a day had it. So the check was green almost always and red for
  // somebody else later, at a minute they could not reproduce. A test that finds a real
  // bug one run in a hundred is a test that teaches people to re-run it.
  const CLOCKS = [7 * 60 + 32, 13 * 60 + 40];

  // The pair that had it, kept by name: two poles on Rúa Industria where the operator's
  // timetable puts the bus at both of them in the same minute, so the leg printed
  // "07:36 -> 07:36" above "1 min" -- a minute in the segment and in no part of the clock.
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
        assert(
          span >= 0 || span + 1440 === (s.durationMinutes ?? 0),
          `${trip}: a ${s.type} leg runs ${s.departureTime} to ${s.arrivalTime}`,
        );
      }
    }
    }
  }
  assert(options > 400, `only ${options} options planned; the check is not checking`);
});

console.log('\nbasemap style');

/**
 * The two style files in src/data are generated by tools/buildMapStyle.ts and are the
 * whole design of the map underneath everything else. What follows is the set of claims
 * they make, each of which has been false at some point.
 */
const mapStyles = () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  return {
    light: JSON.parse(readFileSync(join(root, 'src/data/map-style-light.json'), 'utf8')),
    dark: JSON.parse(readFileSync(join(root, 'src/data/map-style-dark.json'), 'utf8')),
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
      assert(
        url.startsWith('https://tiles.openfreemap.org/'),
        `${theme}: ${url} is not served by OpenFreeMap, so the policy would block it`,
      );
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
  // The published dark style paints woodland with `fill-pattern: "wood-pattern"` and the
  // sprite it names has 264 icons and no pattern among them, so every load of the dark
  // map logged "Image 'wood-pattern' could not be loaded" and the woods came out
  // unpainted. The generator deletes the property; this is the check that it stays gone,
  // and that nobody adds a second one by hand.
  for (const [theme, style] of Object.entries(mapStyles())) {
    for (const layer of style.layers) {
      assert(
        !('fill-pattern' in (layer.paint ?? {})),
        `${theme}: ${layer.id} paints with a fill-pattern, which this sprite cannot supply`,
      );
    }
  }
});

ok('the street names fade in both themes, not just the dark one', () => {
  // The two published styles are not one design with two palettes: dark names its layers
  // with underscores and positron with hyphens. The adjustment that hides street names
  // where our own stop labels arrive named only dark's three, so it never once applied to
  // the light map -- and the runtime `try`/`catch` that forgave a rename upstream forgave
  // an id that had never existed, in silence, for as long as it shipped.
  const styles = mapStyles();
  const fades = (theme: string, ids: string[]) => {
    const byId = new Map(styles[theme].layers.map((l) => [l.id, l]));
    for (const id of ids) {
      const layer = byId.get(id);
      assert(layer, `${theme}: there is no layer called ${id} to fade`);
      const opacity = layer!.paint?.['text-opacity'];
      assert(
        Array.isArray(opacity) && JSON.stringify(opacity).includes('16.5'),
        `${theme}: ${id} does not fade out where the stop labels take over`,
      );
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

  /*
   * The routes are 6 px polylines with no casing, drawn straight onto whatever the
   * basemap put there, so the only thing keeping a line visible is the gap between its
   * colour and the street underneath it.
   *
   * There used to be no gap. `filter: brightness(2.8)` on the tile pane -- written for
   * CARTO raster and left behind when the basemap became vector -- multiplied every
   * colour in the style and not the routes drawn on the overlay pane above it. The
   * faintest line, the 11, came out at 1,15 against the street it ran along.
   *
   * 1,45 is the floor rather than 1,5 because the 11 sits at 1,46 over a minor street and
   * minor streets are 2,3 px wide at zoom 14. It is dark for a reason of its own -- the
   * badge is white text at 10 px on that colour and had to clear 4,5:1 -- so the two
   * requirements pull against each other and this is where they were balanced. If the
   * basemap ever has to be brighter than this, the lever is a hairline casing under the
   * route line, not another step here.
   */
  for (const street of ['highway_minor', 'highway_major_inner', 'highway_motorway_inner']) {
    const under = colour(street, 'line-color');
    for (const line of BUS_LINES) {
      const ratio = contrast(line.color, under);
      assert(
        ratio >= 1.45,
        `line ${line.number} (${line.color}) is ${ratio.toFixed(2)} against ${street} (${under})`,
      );
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
  /*
   * The light style shipped for one commit as published, on the strength of having
   * measured the route ink over the streets -- 4,04 at worst, which is fine -- and
   * nothing else. The ground and the things standing on it had never been compared.
   *
   * Published, a building's fill was 1,08 over the ground and its outline 1,24: the
   * outline separated almost twice as well as the mass did, so every footprint was drawn
   * as a wireframe and the built-up part of Lugo was the same colour as the fields around
   * it. Both halves of that are checked here, because the dark map had the identical pair
   * of defects and only the dark one was fixed.
   */
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
  assert(
    paint('building', 'fill-outline-color') === fill,
    'a light building is outlined in a different colour from its fill, so a block reads as linework',
  );
  const step = contrast(fill, ground);
  assert(step >= 1.15, `a light building is ${step.toFixed(2)} over the ground, which reads as the ground`);

  // And the ink still clears the bar non-text contrast asks for over that heavier mass.
  for (const line of BUS_LINES) {
    const ratio = contrast(line.color, fill);
    assert(ratio >= 3, `line ${line.number} (${line.color}) is ${ratio.toFixed(2)} over a light building`);
  }
});

ok('the basemap is not being amplified behind the palette', () => {
  // For months the dark map was painted through `filter: brightness(2.8)` on the tile
  // pane, so the ground the style set to #171a1f reached the screen as #404850 and every
  // value in the style meant something else. Any filter on that pane puts the palette
  // back out of reach of the measurements above.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(join(root, 'src/index.css'), 'utf8');
  const rule = css.match(/\.leaflet-tile-pane\s*\{[^}]*\}/);
  assert(
    !rule || !/filter\s*:/.test(rule[0]),
    `the tile pane is filtered again: ${rule?.[0].replace(/\s+/g, ' ')}`,
  );
});

ok('an open dialog keeps the keyboard, the board keeps quiet, and an answer takes the focus', () => {
  // Three things a screen reader or a keyboard found on 14 September 2026 that no
  // contrast or target measurement could see.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  // With the menu open, fourteen Tab presses put focus on the QR button behind the
  // drawer: `aria-modal` hides the page from a screen reader, not from the Tab key. Every
  // overlay goes through one hook, so the wrap lives there and only there.
  const dialog = read('src/hooks/useDialog.ts');
  assert(/event\.key !== 'Tab'/.test(dialog) && /event\.shiftKey/.test(dialog), 'useDialog no longer wraps Tab inside the overlay');

  // The arrivals lists were `aria-live`: the minute tick changed every row at once, so
  // each minute announced up to fifteen bare numbers with no line and no way to stop it.
  const board = read('src/components/StopArrivalsView.tsx');
  assert(!/<ul[^>]*aria-live/.test(board), 'an arrivals list is a live region again');

  // "Calcular ruta" unmounted the button under the focus, which fell to the top of the
  // document; and with no route the sentence saying so sat in a column hidden behind the
  // form on a phone. The answer column takes focus after every question, found or not.
  const planner = read('src/components/RoutePlannerView.tsx');
  assert(/ref=\{answerRef\}\s+tabIndex=\{-1\}/.test(planner), 'the answer column can no longer take focus');
  assert(/setAnswered\(\(n\) => n \+ 1\);\s+setFormOpen\(false\);/.test(planner), 'a question without an answer leaves the form covering the sentence that says so');
});

ok('the map opens on nobody’s line, and a zoom step rebuilds only what the zoom changes', () => {
  // measure:browser had four zoom steps at 2,133-4,055 ms of blocked main thread against
  // a budget of 900. Three things, each of which would come back quietly.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

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

ok('the letter paints before the search rows do', () => {
  // The first keystroke scored the whole network and drew the rows in the same render as
  // the character: 400 ms from key to paint at 6x CPU, 219 of them blocked. The rows are
  // built from a deferred copy of the query and kept until it changes.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const topBar = readFileSync(join(root, 'src/components/TopBar.tsx'), 'utf8');
  assert(/useDeferredValue\(q\)/.test(topBar) && /useMemo\(\(\) => searchAll\(dq\), \[dq\]\)/.test(topBar), 'the search rows render in the same task as the keystroke again');
});

// Last on purpose: it counts itself. The README quoted 141 while this file ran 143, which
// is the kind of figure the front-doors rule exists for and the one nobody re-reads.
ok('the README quotes the number of checks this file runs', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const quoted = readme.match(/^(\d+) comprobacións con asercións/m)?.[1];
  assert(quoted === String(checks + 1), `README says ${quoted ?? 'nothing'} checks; this file runs ${checks + 1}`);
});

console.log(`\n${checks} checks passed\n`);
