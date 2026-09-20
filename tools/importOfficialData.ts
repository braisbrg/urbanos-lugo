/**
 * Rebuilds the transit dataset from the operator's own public pages (buslugo.com) and
 * snaps each itinerary to the street network with OSRM. Writes data/official-raw.json
 * and data/routes.json, which buildDataset.ts turns into what ships. Never run by the app.
 *
 *   npx tsx tools/importOfficialData.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { plainText } from '../src/utils/html';
import { at, readJson, sleep, writeJson } from './lib';

const CACHE = at('.cache', 'official');
const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';
const PAUSE_MS = 700;

/** Fetch with an on-disk cache so re-runs are cheap and stay polite to the source. */
async function get(url: string, key: string): Promise<string> {
  const file = join(CACHE, key + '.html');
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, text);
  await sleep(PAUSE_MS);
  return text;
}

const strip = (s: string) => plainText(s.replace(/&nbsp;/g, ' '), '');

/** `&amp;` last: decoding it first turns `&amp;quot;` into a quote the source never wrote. */
const decode = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, String.fromCharCode(39))
    .replace(/&ordm;/g, 'o')
    .replace(/&([aeiou])acute;/g, (_m, v) => v)
    .replace(/&amp;/g, '&');

interface RawStop {
  ps: number;
  name: string;
  token?: string;
  lines: string[];
}

type DayType = 'laborable' | 'sabado' | 'domingo';

interface ServicePattern {
  days: DayType[];
  /** Minutes between departures, when the operator states a fixed cadence. */
  headwayMinutes: number | null;
  /** Timing points with their published times (a full grid, or just first and last). */
  rows: { timingPoint: string; times: string[] }[];
}

interface RawLine {
  /** Unique key. Branches of the same number get a suffix, e.g. "11-Bóveda". */
  id: string;
  /** What the operator prints on the bus, e.g. "11". */
  number: string;
  name: string;
  days: string;
  frequency: string;
  firstDeparture: string;
  lastDeparture: string;
  services: ServicePattern[];
  directions: { stops: number[]; origin: string; destination: string }[];
}

export const stopsByPs = new Map<number, RawStop>();

/** "7:15" -> "07:15" so every time sorts and parses the same way. */
const pad = (s: string) => (s.length === 4 ? '0' + s : s);

function dayTypesFor(label: string): DayType[] {
  // Accents off first: JS word boundaries are ASCII-only, so in "todos los días" the "d"
  // counted as a whole word and every all-week line was filed as Sunday-only.
  const l = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // "L-D" is Monday to Sunday, not Sunday: ranges before single letters.
  if (/todos los dias|todos os dias|diario|l-d|luns a domingo|lunes a domingo/.test(l)) return ['laborable', 'sabado', 'domingo'];
  if (/l-s|luns a sabado|lunes a sabado/.test(l)) return ['laborable', 'sabado'];
  const out: DayType[] = [];
  if (/l-v|laborai|laborable|lunes a viernes|luns a venres/.test(l)) out.push('laborable');
  if (/\bs\b|sabado/.test(l)) out.push('sabado');
  if (/\bd\b|domingo|festiv/.test(l)) out.push('domingo');
  return out.length ? out : ['laborable', 'sabado', 'domingo'];
}

/**
 * The operator publishes two shapes of timetable: a full grid, one column per departure,
 * or "primeira / última saída" per day type with the cadence in the header. Reading only
 * the first made a "cada 30 min" line look like it ran twice a day.
 */
function parseSchedule(html: string, pageDays: string): ServicePattern[] {
  const table = html.match(/<table class="table table-striped[\s\S]*?<\/table>/);
  if (!table) return [];

  const rows = [...table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const isFirstLast = /primeira sa[íi]da|primera salida/i.test(rows.slice(0, 2).map(strip).join(' '));
  const dataRows = rows
    .map((row) => ({
      timingPoint: decode(strip((row.match(/<th[^>]*>([\s\S]*?)<\/th>/) || [, ''])[1])),
      // Empty cells kept, so column positions stay aligned with the header.
      cells: [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => {
        const t = strip(c[1]).match(/(\d{1,2}:\d{2})/);
        return t ? pad(t[1]) : '';
      }),
    }))
    .filter((r) => r.timingPoint && r.cells.some(Boolean));
  if (!dataRows.length) return [];

  if (!isFirstLast) {
    return [{ days: dayTypesFor(pageDays), headwayMinutes: null, rows: dataRows.map((r) => ({ timingPoint: r.timingPoint, times: r.cells.filter(Boolean) })) }];
  }

  // Column labels sit in the second header row ("L-V laborais (cada 30 min.)"), offset by
  // one from the data rows, which use <th> where the header uses an empty <td>.
  const labelCells = [...(rows[1] || '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
  const offset = labelCells.findIndex(Boolean);
  if (offset < 0) return [];
  const labels = labelCells.slice(offset);
  if (labels.length < 2) return [];

  // The first half of the labels head the first-departure columns, the second half the
  // last-departure ones; each row's cells split the same way. A line worked by two buses
  // prints a column per vehicle under one label, so the surplus columns go to the earlier
  // labels — indexing by label position once paired a weekday first with a weekend one.
  const half = Math.floor(labels.length / 2);
  const perHalf = Math.floor(Math.max(...dataRows.map((r) => r.cells.length)) / 2);
  const sizes = labels.slice(0, half).map(() => 1);
  for (let extra = perHalf - half, j = 0; extra > 0; extra--, j = (j + 1) % half) sizes[j]++;
  const starts = sizes.map((_, j) => sizes.slice(0, j).reduce((n, x) => n + x, 0));

  const patterns: ServicePattern[] = [];
  for (let k = 0; k < half; k++) {
    const label = labels[k] || pageDays;
    const headway = Number((label.match(/cada\s+(\d+)/i) || [])[1]) || null;
    // Always the same vehicle's column in every row; the headway fills the other vehicles in.
    const patternRows = dataRows
      .map((r) => ({ timingPoint: r.timingPoint, times: [r.cells[starts[k]], r.cells[perHalf + starts[k]]].filter(Boolean).sort() }))
      .filter((r) => r.times.length);
    if (!patternRows.length) continue;
    // A first and last departure under two headways apart is what a weekday first mated
    // to a weekend first looks like. Loud, not fatal: a page could print a two-run service.
    const [first, last] = patternRows[0].times;
    if (headway && first && last) {
      const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      const span = at(last) - at(first);
      if (span < headway * 2) console.warn(`     ! ${label}: ${first} to ${last} is only ${span} min at a ${headway} min headway — check the column layout`);
    }
    patterns.push({ days: dayTypesFor(label), headwayMinutes: headway, rows: patternRows });
  }
  return patterns;
}

const STOP_HEAD = /<h2 class="title"><a href="\/mapa\/\?ps=(\d+)">([^<]*)<\/a>/;

export function parseLine(html: string): RawLine | null {
  const idMatch = html.match(/L[ií]nea\s*<\/?[^>]*>?\s*([0-9]+(?:\.[0-9]+)?(?:[A-Z]{2})?)/i) || html.match(/>\s*L[ií]nea\s+([0-9]+(?:\.[0-9]+)?(?:[A-Z]{2})?)\s*</i);
  if (!idMatch) return null;
  const number = idMatch[1];

  const text = strip(html);
  const freq = text.match(/Cada\s+(\d+)\s*min/i);
  const days = (text.match(/De lunes a viernes \(laborables\)|Todos los d[ií]as|S[aá]bados[^|]{0,24}|Domingos y festivos/i) || [])[0] || 'De lunes a viernes (laborables)';

  const directions: RawLine['directions'] = [];
  for (const block of html.split(/<ul class="list-unstyled timeline">/).slice(1)) {
    // One <div class="block"> per stop. The live-panel token sits BEFORE the stop's own
    // <h2>, so anything keyed off the text after the heading picks up the next stop's.
    const entries = block.split('<div class="block">').slice(1).filter((chunk) => STOP_HEAD.test(chunk));
    const seq: number[] = [];
    const names: string[] = [];
    for (const chunk of entries) {
      const head = chunk.match(STOP_HEAD)!;
      const ps = Number(head[1]);
      const name = decode(head[2].trim());
      const token = (chunk.match(/id="p\d+-([A-Za-z0-9]{4})"/) || [])[1];
      // "Correspondencias" list the other lines calling at this stop.
      const corr = [...chunk.matchAll(/fa-bus"><\/i>\s*([0-9]+(?:\.[0-9]+)?(?:[A-Z]{2})?)\s*</g)].map((c) => c[1]);
      const existing = stopsByPs.get(ps);
      if (existing) {
        if (token && !existing.token) existing.token = token;
        for (const l of [number, ...corr]) if (!existing.lines.includes(l)) existing.lines.push(l);
      } else {
        stopsByPs.set(ps, { ps, name, token, lines: [...new Set([number, ...corr])] });
      }
      seq.push(ps);
      names.push(name);
    }
    if (seq.length > 1) directions.push({ stops: seq, origin: names[0], destination: names[names.length - 1] });
  }
  if (!directions.length) return null;

  const services = parseSchedule(html, days);
  const allTimes = services.flatMap((p) => p.rows.flatMap((r) => r.times)).sort();
  return {
    id: number,
    number,
    name: `${directions[0].origin} - ${directions[0].destination}`,
    days,
    frequency: freq ? `Cada ${freq[1]} min` : 'Consultar horario',
    firstDeparture: allTimes[0] || '07:00',
    lastDeparture: allTimes[allTimes.length - 1] || '22:00',
    services,
    directions,
  };
}

async function stopCoords(ps: number): Promise<[number, number] | null> {
  const html = await get(`https://buslugo.com/mapa/?ps=${ps}`, `stop-${ps}`);
  const m = html.match(/(4[23]\.\d{4,})\s*,\s*(-[78]\.\d{4,})/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

interface SnappedRoute {
  path: [number, number][];
  legMeters: number[];
  legSeconds: number[];
  stopIndices: number[];
  totalMeters: number;
}

/** OSRM caps a request at 100 waypoints, so long itineraries go out in chunks. */
async function snap(coords: [number, number][]): Promise<SnappedRoute | null> {
  const CHUNK = 90;
  const path: [number, number][] = [];
  const legMeters: number[] = [];
  const legSeconds: number[] = [];
  const stopIndices: number[] = [];
  let total = 0;

  for (let start = 0; start < coords.length - 1; start += CHUNK - 1) {
    const slice = coords.slice(start, start + CHUNK);
    if (slice.length < 2) break;
    const q = slice.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${q}?overview=full&geometries=geojson&continue_straight=false`);
    if (!res.ok) return null;
    const j: any = await res.json();
    if (j.code !== 'Ok') return null;

    const offset = path.length;
    const pts: [number, number][] = j.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
    path.push(...pts);
    total += j.routes[0].distance;
    legMeters.push(...j.routes[0].legs.map((l: any) => Math.round(l.distance)));
    legSeconds.push(...j.routes[0].legs.map((l: any) => Math.round(l.duration)));

    // Which vertex each stop sits on; the search only moves forward, or a stop on a street
    // the route uses twice matches the other pass and the bus flies across the city.
    let cursor = 0;
    j.waypoints.forEach((w: any, i: number) => {
      const [wLng, wLat] = w.location;
      let best = cursor;
      let bestD = Infinity;
      for (let k = cursor; k < pts.length; k++) {
        const d = (pts[k][0] - wLat) ** 2 + (pts[k][1] - wLng) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      cursor = best;
      if (start > 0 && i === 0) return; // waypoint shared with the previous chunk
      stopIndices.push(offset + best);
    });
    await sleep(1100);
  }
  return { path, legMeters, legSeconds, stopIndices, totalMeters: Math.round(total) };
}

async function main() {
  console.log('1/4  Reading official line pages');
  const lines: RawLine[] = [];
  for (let page = 1; page <= 30; page++) {
    try {
      const parsed = parseLine(await get(`https://buslugo.com/linea?id=${page}`, `line-${page}`));
      if (!parsed) {
        console.log(`     page ${page}: no itinerary, skipped`);
        continue;
      }
      // Line 11 is published as four rural branches sharing one number: distinct services, suffixed ids.
      if (lines.some((l) => l.number === parsed.number)) {
        parsed.id = `${parsed.number}-${parsed.directions[0].destination.replace(/\s*\(.*$/, '').trim()}`;
        if (lines.some((l) => l.id === parsed.id)) {
          console.log(`     page ${page}: identical to ${parsed.id}, skipped`);
          continue;
        }
      }
      lines.push(parsed);
      console.log(`     ${parsed.id.padEnd(5)} ${parsed.frequency.padEnd(14)} ${parsed.directions.map((d) => d.stops.length).join('/').padEnd(8)} ${parsed.name.slice(0, 46)}`);
    } catch (err) {
      console.log(`     page ${page}: ${(err as Error).message}`);
    }
  }

  console.log(`\n2/4  Geolocating ${stopsByPs.size} stops`);
  const located = new Map<number, [number, number]>();
  let done = 0;
  for (const ps of stopsByPs.keys()) {
    try {
      const c = await stopCoords(ps);
      if (c) located.set(ps, c);
    } catch {
      // stop page unreachable; reported in the summary below
    }
    if (++done % 50 === 0) console.log(`     ${done}/${stopsByPs.size}`);
  }
  console.log(`     located ${located.size}/${stopsByPs.size}`);

  console.log('\n3/4  Snapping itineraries to the street network');
  // Geometry only changes when an itinerary changes, so what is on disk is reused.
  const routesPath = at('data', 'routes.json');
  const previous: any[] = existsSync(routesPath) ? readJson(routesPath) : [];
  const cachedRoute = new Map<string, any>(previous.map((r: any) => [`${r.lineId}|${r.direction}`, r]));
  const routes: ({ lineId: string; direction: string } & SnappedRoute)[] = [];
  for (const line of lines) {
    for (let d = 0; d < line.directions.length; d++) {
      const coords = line.directions[d].stops.map((ps) => located.get(ps)).filter(Boolean) as [number, number][];
      if (coords.length < 2) continue;
      const dirId = d === 0 ? 'ida' : 'volta';
      const reuse = cachedRoute.get(`${line.id}|${dirId}`);
      if (reuse && reuse.stopIndices?.length === coords.length) {
        routes.push(reuse);
        console.log(`     ${line.id.padEnd(5)} ${dirId.padEnd(6)} reused`);
        continue;
      }
      const geo = await snap(coords);
      if (geo) {
        routes.push({ lineId: line.id, direction: dirId, ...geo });
        console.log(`     ${line.id.padEnd(5)} ${dirId.padEnd(6)} ${String(geo.path.length).padStart(5)} pts  ${(geo.totalMeters / 1000).toFixed(1).padStart(5)} km`);
      } else {
        console.log(`     ${line.id.padEnd(5)} ${dirId.padEnd(6)} FAILED`);
      }
    }
  }

  console.log('\n4/4  Writing raw dataset');
  const stops = [...stopsByPs.values()].map((s) => ({ ...s, coords: located.get(s.ps) || null }));
  writeFileSync(at('data', 'official-raw.json'), JSON.stringify({ source: 'https://buslugo.com', lines, stops }, null, 2));
  writeJson(at('data', 'routes.json'), routes, false);
  console.log(`     ${lines.length} lines, ${stopsByPs.size} stops, ${routes.length} routes`);
}

// Importing this file should not start a scrape: the parser is unit-tested from `npm test`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
