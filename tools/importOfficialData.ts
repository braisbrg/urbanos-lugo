/**
 * Rebuilds the transit dataset from the operator's own public pages
 * (buslugo.com, AULUSA / Grupo Monbus) and snaps each itinerary to the real
 * street network with OSRM.
 *
 *   npx tsx tools/importOfficialData.ts
 *
 * Writes data/official-raw.json + data/routes.json, which buildDataset.ts then
 * turns into stops.json / lines.json. The app never calls these sources at runtime.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '../src/data');
/** Build inputs, outside src/ because the application never imports them. */
const RAW = join(HERE, '../data');
const CACHE = join(HERE, '../.cache/official');
const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';
const PAUSE_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, String.fromCharCode(39))
    .replace(/&ordm;/g, 'o')
    .replace(/&([aeiou])acute;/g, (_m, v) => ({ a: 'a', e: 'e', i: 'i', o: 'o', u: 'u' } as any)[v]);
}

interface RawStop {
  ps: number;
  name: string;
  token?: string;
  lines: string[];
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
  /** Published timetable, one entry per day type the operator distinguishes. */
  services: ServicePattern[];
  directions: { stops: number[]; origin: string; destination: string }[];
}

export const stopsByPs = new Map<number, RawStop>();

/** "7:15" -> "07:15" so every time sorts and parses the same way. */
const pad = (s: string) => (s.length === 4 ? '0' + s : s);

type DayType = 'laborable' | 'sabado' | 'domingo';

interface ServicePattern {
  /** Which kinds of day this pattern applies to. */
  days: DayType[];
  /** Minutes between departures, when the operator states a fixed cadence. */
  headwayMinutes: number | null;
  /** Timing points with their published times (a full grid, or just first and last). */
  rows: { timingPoint: string; times: string[] }[];
}

function dayTypesFor(label: string): DayType[] {
  // Strip accents first. JS word boundaries are ASCII-only, so in "todos los días" the
  // "d" counts as a whole word (í is not a word character) and \bd\b matched it,
  // filing every all-week line as Sunday-only service.
  const l = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  // "L-D" is Monday to Sunday, not Sunday: match the ranges before the single letters.
  if (/todos los dias|todos os dias|diario|l-d|luns a domingo|lunes a domingo/.test(l)) {
    return ['laborable', 'sabado', 'domingo'];
  }
  if (/l-s|luns a sabado|lunes a sabado/.test(l)) return ['laborable', 'sabado'];

  const out: DayType[] = [];
  if (/l-v|laborai|laborable|lunes a viernes|luns a venres/.test(l)) out.push('laborable');
  if (/\bs\b|sabado/.test(l)) out.push('sabado');
  if (/\bd\b|domingo|festiv/.test(l)) out.push('domingo');
  return out.length ? out : ['laborable', 'sabado', 'domingo'];
}

/**
 * The operator publishes two shapes of timetable:
 *
 *  - a full grid, one column per departure (used where there is no fixed cadence);
 *  - "primeira saída / última saída" per day type, with the cadence in the header
 *    (used for the frequent lines), which also carries Saturday and Sunday service.
 *
 * Reading only the first shape made a "cada 30 min" line look like it ran twice a day.
 */
function parseSchedule(html: string, pageDays: string): ServicePattern[] {
  const table = html.match(/<table class="table table-striped[\s\S]*?<\/table>/);
  if (!table) return [];

  const rows = [...table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const headerText = rows.slice(0, 2).map(strip).join(' ');
  const isFirstLast = /primeira sa[íi]da|primera salida/i.test(headerText);

  const dataRows = rows
    .map((row) => ({
      timingPoint: decode(strip((row.match(/<th[^>]*>([\s\S]*?)<\/th>/) || [, ''])[1])),
      // Keep empty cells so column positions stay aligned with the header.
      cells: [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => {
        const t = strip(c[1]).match(/(\d{1,2}:\d{2})/);
        return t ? pad(t[1]) : '';
      }),
    }))
    .filter((r) => r.timingPoint && r.cells.some(Boolean));

  if (!dataRows.length) return [];

  if (!isFirstLast) {
    return [
      {
        days: dayTypesFor(pageDays),
        headwayMinutes: null,
        rows: dataRows.map((r) => ({ timingPoint: r.timingPoint, times: r.cells.filter(Boolean) })),
      },
    ];
  }

  // Column labels sit in the second header row: "L-V laborais (cada 30 min.)" etc.
  // The header carries a leading empty <td> where the data rows use <th>, so the two
  // are offset by one; without accounting for that a last departure of 21:15 was read
  // as the first departure of the next column.
  const labelCells = [...(rows[1] || '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
  const offset = labelCells.findIndex(Boolean);
  if (offset < 0) return [];
  const labels = labelCells.slice(offset);
  if (labels.length < 2) return [];

  // The labels repeat: first half of them head the first-departure columns, second half
  // the last-departure ones. Each data row is laid out the same way, so its cells split
  // down the middle into firsts and lasts.
  const half = Math.floor(labels.length / 2);
  const cellsPerRow = Math.max(...dataRows.map((r) => r.cells.length));
  const perHalf = Math.floor(cellsPerRow / 2);

  // A line worked by two buses prints a column per vehicle under one label — "Bus 1
  // 7:15 | Bus 2 7:45" both sit under "L-V laborais (cada 30 min.)". That leaves more
  // cells than labels, and indexing by label position then paired a weekday first
  // departure with a weekend one: line 2 came out running 7:15, 7:45, 8:15 and stopping
  // for the day, instead of every 30 minutes until 21:45. Give the surplus columns to
  // the earlier labels, which is where the extra vehicles run.
  const sizes = labels.slice(0, half).map(() => 1);
  for (let extra = perHalf - half, j = 0; extra > 0; extra--, j = (j + 1) % half) sizes[j]++;
  const starts = sizes.map((_, j) => sizes.slice(0, j).reduce((n, x) => n + x, 0));

  const patterns: ServicePattern[] = [];
  for (let k = 0; k < half; k++) {
    const label = labels[k] || pageDays;
    const headway = Number((label.match(/cada\s+(\d+)/i) || [])[1]) || null;
    const patternRows = dataRows
      .map((r) => {
        // Always the same vehicle's column in every row: mixing them produced a run
        // that reached a later stop before it had left the earlier one. The headway
        // fills the other vehicles back in.
        const pair = [r.cells[starts[k]], r.cells[perHalf + starts[k]]].filter(Boolean).sort();
        return { timingPoint: r.timingPoint, times: pair };
      })
      .filter((r) => r.times.length);
    if (patternRows.length) {
      // A first and last departure less than two headways apart means the columns were
      // paired wrong — that is what a weekday first mated to a weekend first looks like,
      // and it silently shortened line 2's day to one hour. Loud, not fatal: the page
      // could genuinely print a two-run service.
      const [first, last] = patternRows[0].times;
      if (headway && first && last) {
        const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        const span = at(last) - at(first);
        if (span < headway * 2) {
          console.warn(
            `     ! ${label}: ${first} to ${last} is only ${span} min at a ${headway} min headway — check the column layout`,
          );
        }
      }
      patterns.push({ days: dayTypesFor(label), headwayMinutes: headway, rows: patternRows });
    }
  }

  return patterns;
}

export function parseLine(html: string): RawLine | null {
  const idMatch =
    html.match(/L[ií]nea\s*<\/?[^>]*>?\s*([0-9]+(?:\.[0-9]+)?(?:[A-Z]{2})?)/i) ||
    html.match(/>\s*L[ií]nea\s+([0-9]+(?:\.[0-9]+)?(?:[A-Z]{2})?)\s*</i);
  if (!idMatch) return null;
  const number = idMatch[1];

  const text = strip(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' '));
  const freq = text.match(/Cada\s+(\d+)\s*min/i);
  const days =
    (text.match(/De lunes a viernes \(laborables\)|Todos los d[ií]as|S[aá]bados[^|]{0,24}|Domingos y festivos/i) || [])[0] ||
    'De lunes a viernes (laborables)';

  const blocks = html.split(/<ul class="list-unstyled timeline">/).slice(1);
  const directions: RawLine['directions'] = [];

  for (const block of blocks) {
    // One <div class="block"> per stop. The live-panel token sits in the "tags" div
    // BEFORE the stop's own <h2>, so anything keyed off the text after the heading
    // picks up the next stop's token instead.
    const entries = block
      .split('<div class="block">')
      .slice(1)
      .map((chunk) => chunk.match(/<h2 class="title"><a href="\/mapa\/\?ps=(\d+)">([^<]*)<\/a>/) && chunk)
      .filter((c): c is string => Boolean(c));

    const seq: number[] = [];
    const names: string[] = [];
    for (const chunk of entries) {
      const head = chunk.match(/<h2 class="title"><a href="\/mapa\/\?ps=(\d+)">([^<]*)<\/a>/)!;
      const ps = Number(head[1]);
      const name = decode(head[2].trim());
      const tail = chunk;
      const token = (tail.match(/id="p\d+-([A-Za-z0-9]{4})"/) || [])[1];
      // "Correspondencias" list the other lines calling at this stop.
      const corr = [...tail.matchAll(/fa-bus"><\/i>\s*([0-9]+(?:\.[0-9]+)?(?:[A-Z]{2})?)\s*</g)].map((c) => c[1]);

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
    if (seq.length > 1) {
      directions.push({ stops: seq, origin: names[0], destination: names[names.length - 1] });
    }
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

async function snap(coords: [number, number][]): Promise<SnappedRoute | null> {
  // OSRM caps a request at 100 waypoints, so long itineraries go out in chunks.
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
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${q}?overview=full&geometries=geojson&continue_straight=false`,
    );
    if (!res.ok) return null;
    const j: any = await res.json();
    if (j.code !== 'Ok') return null;

    const offset = path.length;
    const pts: [number, number][] = j.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
    path.push(...pts);
    total += j.routes[0].distance;
    legMeters.push(...j.routes[0].legs.map((l: any) => Math.round(l.distance)));
    legSeconds.push(...j.routes[0].legs.map((l: any) => Math.round(l.duration)));

    // Which vertex of the drawn route each stop sits on. The search only ever moves
    // forward: scanning the whole chunk let a stop on a street the route uses twice
    // match the other pass, and the index went backwards. A bus interpolating across
    // that pair then flew right across the city, off its own line.
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
      // Line 11 is published as four separate rural branches sharing one number.
      // They are distinct services, so keep them all under suffixed ids.
      if (lines.some((l) => l.number === parsed.number)) {
        parsed.id = `${parsed.number}-${parsed.directions[0].destination.replace(/\s*\(.*$/, '').trim()}`;
        if (lines.some((l) => l.id === parsed.id)) {
          console.log(`     page ${page}: identical to ${parsed.id}, skipped`);
          continue;
        }
      }
      lines.push(parsed);
      console.log(
        `     ${parsed.id.padEnd(5)} ${parsed.frequency.padEnd(14)} ${parsed.directions
          .map((d) => d.stops.length)
          .join('/')
          .padEnd(8)} ${parsed.name.slice(0, 46)}`,
      );
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
      /* stop page unreachable; reported in the summary below */
    }
    if (++done % 50 === 0) console.log(`     ${done}/${stopsByPs.size}`);
  }
  console.log(`     located ${located.size}/${stopsByPs.size}`);

  console.log('\n3/4  Snapping itineraries to the street network');
  // Geometry only changes when an itinerary changes, so reuse what is already on disk
  // instead of re-hitting the public router on every timetable tweak.
  const existingPath = join(RAW, 'routes.json');
  const previous: any[] = existsSync(existingPath) ? JSON.parse(readFileSync(existingPath, 'utf8')) : [];
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
        console.log(
          `     ${line.id.padEnd(5)} ${dirId.padEnd(6)} ${String(geo.path.length).padStart(5)} pts  ${(geo.totalMeters / 1000).toFixed(1).padStart(5)} km`,
        );
      } else {
        console.log(`     ${line.id.padEnd(5)} ${dirId.padEnd(6)} FAILED`);
      }
    }
  }

  console.log('\n4/4  Writing raw dataset');
  writeFileSync(
    join(RAW, 'official-raw.json'),
    JSON.stringify(
      {
        source: 'https://buslugo.com',
        lines,
        stops: [...stopsByPs.values()].map((s) => ({ ...s, coords: located.get(s.ps) || null })),
      },
      null,
      2,
    ),
  );
  writeFileSync(join(RAW, 'routes.json'), JSON.stringify(routes) + '\n');
  console.log(`     ${lines.length} lines, ${stopsByPs.size} stops, ${routes.length} routes`);
}

// Importing this file should not start a scrape: the parser is unit-tested from `npm test`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
