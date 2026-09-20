/**
 * Checks the shipped dataset against the pages it came from, one stop at a time.
 *
 *   npm run reconcile                    # re-reads the pages on disk
 *   npm run reconcile -- --fresh         # re-downloads the 24 line pages (~30 s)
 *   npm run reconcile -- --fresh-stops   # also the 1186 stop pages (~20 min)
 *
 * A scrape drifts: the operator moves a pole, renames a stop, changes a departure. So this
 * re-derives everything straight from the operator's HTML and from the survey in
 * OpenStreetMap, then reports every disagreement. It deliberately does NOT read
 * official-raw.json: that is this build's own output, and comparing it to the shipped
 * data would compare a thing to itself. Changes nothing; read the report, then decide.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUS_LINES, BUS_STOPS } from '../src/data/transitData';
import { metresBetween as distance } from '../src/utils/geo';
import { parseLine, stopsByPs } from './importOfficialData';
import { at, fold, percentile, readJson, sleep } from './lib';

const CACHE = at('.cache', 'official');
const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';
const FRESH_STOPS = process.argv.includes('--fresh-stops');
const FRESH = FRESH_STOPS || process.argv.includes('--fresh');
const PAGES = 30;

// `--fresh` is the 24 line pages. With an empty cache (CI never has one) the stop pass
// would fall through and read all 1186 stop pages: twenty minutes on somebody else's
// server, once a week. So without a cache the pass is skipped unless asked for by name.
const HAVE_STOP_CACHE = existsSync(CACHE) && readdirSync(CACHE).some((f) => f.startsWith('stop-'));
const CHECK_STOPS = FRESH_STOPS || HAVE_STOP_CACHE;

const osmStops: any[] = existsSync(at('.cache', 'osm-stops.json')) ? Object.values(readJson(at('.cache', 'osm-stops.json'))) : [];

/**
 * Poles nobody has surveyed in OpenStreetMap. Our coordinate matches the operator's own
 * page, so the gap is OSM's, and failing on it made the weekly run red for something no
 * edit here can fix. Named rather than tolerated by raising the threshold, so a pole that
 * becomes distant still fails. Drop a name once somebody maps it.
 */
const UNSURVEYED = new Set(['A Brea']);

async function page(url: string, key: string, refetch = FRESH): Promise<string | null> {
  const file = join(CACHE, key + '.html');
  if (!refetch && existsSync(file)) return readFileSync(file, 'utf8');
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const text = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, text);
    await sleep(1100);
    return text;
  } catch {
    return null;
  }
}

let problems = 0;
let shown = 0;
const MAX_SHOWN = 12;
function flag(message: string): void {
  problems++;
  if (shown < MAX_SHOWN) console.log(`  ! ${message}`);
  else if (shown === MAX_SHOWN) console.log('  ! ...');
  shown++;
}

/** Section headings are what reconcileSelfTest.ts matches: keep them as they are. */
const rule = (title: string) => {
  shown = 0;
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
};

/** The coordinate the operator publishes on a stop's own page, which is the QR target. */
function publishedCoords(html: string): [number, number] | null {
  const m = html.match(/(4[23]\.\d{4,})\s*,\s*(-[78]\.\d{4,})/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const stopById = new Map(BUS_STOPS.map((s) => [s.id, s]));
const nameOf = (id: string) => stopById.get(id)?.name ?? id;
const lineOf = (parsed: any) => BUS_LINES.find((l) => l.id === parsed.id);
const km = (order: string[]) => {
  let total = 0;
  for (let k = 1; k < order.length; k++) {
    const a = stopById.get(order[k - 1]);
    const b = stopById.get(order[k]);
    if (a && b) total += distance(a.lat, a.lng, b.lat, b.lng);
  }
  return total / 1000;
};

async function main(): Promise<void> {
  console.log(`Reconciling ${BUS_STOPS.length} stops and ${BUS_LINES.length} lines against ` + (FRESH ? 'a fresh read of buslugo.com' : 'the operator pages on disk'));
  if (FRESH) console.log('  downloading; the operator gets a second between requests');

  const reparsed: any[] = [];
  for (let id = 1; id <= PAGES; id++) {
    const html = await page(`https://buslugo.com/linea?id=${id}`, `line-${id}`);
    if (!html) continue;
    let parsed: any = null;
    try {
      parsed = parseLine(html);
    } catch {
      flag(`line page ${id} could not be parsed at all`);
      continue;
    }
    if (!parsed) continue;
    // Line 11 is four rural branches sharing one number, suffixed by destination as the
    // importer does; without that every branch was compared to the one line called "11".
    if (reparsed.some((l) => l.number === parsed.number)) {
      parsed.id = `${parsed.number}-${parsed.directions[0].destination.replace(/\s*\(.*$/, '').trim()}`;
      if (reparsed.some((l) => l.id === parsed.id)) continue; // the importer drops these too
    }
    reparsed.push(parsed);
  }
  console.log(`  re-read ${reparsed.length} line pages and ${stopsByPs.size} stop entries from them`);
  if (reparsed.length < 20) {
    console.log('\n  Too few pages parsed to judge anything. Aborting rather than reporting a clean run.');
    process.exit(1);
  }

  const canonicalOf = new Map<number, string>();
  for (const stop of BUS_STOPS) for (const ps of (stop as any).officialIds ?? []) canonicalOf.set(ps, stop.id);

  rule('Stop position vs the coordinate on its own buslugo page');
  const drift: number[] = [];
  let missingPage = 0;
  for (const [ps, canonical] of CHECK_STOPS ? canonicalOf : []) {
    const html = await page(`https://buslugo.com/mapa/?ps=${ps}`, `stop-${ps}`, FRESH_STOPS);
    const coords = html ? publishedCoords(html) : null;
    if (!coords) {
      missingPage++;
      continue;
    }
    const stop = stopById.get(canonical)!;
    const d = distance(stop.lat, stop.lng, coords[0], coords[1]);
    // The one stop placed away from the operator's pin on purpose (buildDataset.ts) is
    // expected to disagree with its page: reported, not flagged.
    if ((stop as any).positionSource === 'osm') {
      console.log(`  ${stop.name}: ${Math.round(d)} m from its page for ps=${ps}, by design (positionSource: osm)`);
      continue;
    }
    drift.push(d);
    if (d > 60) flag(`${stop.name} sits ${Math.round(d)} m from what its page publishes for ps=${ps}`);
  }
  if (!CHECK_STOPS) {
    console.log(
      `  skipped: nothing cached, and reading ${canonicalOf.size} stop pages is twenty-odd\n` +
        "  minutes on the operator's server. Run with --fresh-stops when a pole is suspected\n" +
        '  of having moved; the itineraries and timetables below are what actually drift.',
    );
  } else {
    console.log(`  ${drift.length} stop pages checked; drift p50 ${Math.round(percentile(drift, 50))} m, p99 ${Math.round(percentile(drift, 99))} m, worst ${Math.round(Math.max(0, ...drift))} m`);
    if (missingPage) console.log(`  ${missingPage} operator ids publish no coordinate`);
  }

  rule('Poles that merge several operator ids');
  let merged = 0;
  let worstSpread = 0;
  // Reads the same cached pages as the pass above: with nothing cached "0 poles merge"
  // would not be the same as zero.
  for (const stop of CHECK_STOPS ? BUS_STOPS : []) {
    const points: [number, number][] = [];
    for (const ps of (stop as any).officialIds ?? []) {
      const file = join(CACHE, `stop-${ps}.html`);
      const coords = existsSync(file) ? publishedCoords(readFileSync(file, 'utf8')) : null;
      if (coords) points.push(coords);
    }
    if (points.length < 2) continue;
    merged++;
    let spread = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) spread = Math.max(spread, distance(points[i][0], points[i][1], points[j][0], points[j][1]));
    }
    worstSpread = Math.max(worstSpread, spread);
    // Two poles more than a street apart are two stops, and merging them moves both.
    if (spread > 80) flag(`${stop.name} merges ids ${Math.round(spread)} m apart — likely two different stops`);
  }
  console.log(CHECK_STOPS ? `  ${merged} poles merge 2+ ids; widest spread ${Math.round(worstSpread)} m` : '  NOT CHECKED: needs the same cached stop pages as the pass above.');

  rule('Stop position vs the survey in OpenStreetMap');
  if (!osmStops.length) {
    // A check that did not run, said plainly: in CI it prints inside a green log.
    console.log('  NOT CHECKED: no .cache/osm-stops.json here. Run `pnpm data:amenities` to fetch it.');
  } else {
    const offsets: number[] = [];
    let unmatched = 0;
    for (const stop of BUS_STOPS) {
      const best = Math.min(...osmStops.map((node) => distance(stop.lat, stop.lng, node.lat, node.lon)));
      if (best <= 120) {
        offsets.push(best);
        continue;
      }
      unmatched++;
      if (best > 500 && !UNSURVEYED.has(stop.name)) flag(`${stop.name} has no surveyed stop within ${Math.round(best)} m`);
    }
    console.log(`  ${offsets.length}/${BUS_STOPS.length} within 120 m of a surveyed stop (p50 ${Math.round(percentile(offsets, 50))} m, p90 ${Math.round(percentile(offsets, 90))} m)`);
    console.log(`  ${unmatched} with nothing surveyed nearby — expected for rural poles nobody has mapped`);
  }

  rule('Itineraries vs the operator pages');
  for (const parsed of reparsed) {
    const line = lineOf(parsed);
    if (!line) {
      flag(`the site publishes line ${parsed.number}, the app does not have it`);
      continue;
    }
    parsed.directions.forEach((rawDir: any, i: number) => {
      const dir = line.directions[i];
      if (!dir) return flag(`line ${line.number} is missing direction ${i}`);
      // Compared as sets: the order is repaired on purpose where the page contradicts the
      // surveyed route, and checked against OSM instead.
      const published = new Set(rawDir.stops.map((ps: number) => canonicalOf.get(ps)).filter(Boolean) as string[]);
      const shipped = new Set(dir.stops);
      for (const id of published) if (!shipped.has(id)) flag(`line ${line.number}/${dir.id}: the site lists "${nameOf(id)}", we do not`);
      for (const id of shipped) if (!published.has(id)) flag(`line ${line.number}/${dir.id}: we list "${nameOf(id)}", the site does not`);
    });
  }
  for (const line of BUS_LINES) {
    if (!reparsed.some((p) => p.id === line.id)) flag(`the app has line ${line.id}, the site no longer publishes it`);
  }

  rule('Stop names vs the operator');
  const strip = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');
  // Compared per POLE, not per operator id: the site prints more than one name for the
  // same pole across its own ids, and the build shows the majority.
  const namesOfPole = new Map<string, Set<string>>();
  for (const [ps, canonical] of canonicalOf) {
    const name = stopsByPs.get(ps)?.name;
    if (name) namesOfPole.set(canonical, (namesOfPole.get(canonical) ?? new Set()).add(name));
  }
  let renamed = 0;
  let ambiguous = 0;
  for (const stop of BUS_STOPS) {
    const names = namesOfPole.get(stop.id);
    if (!names?.size) continue;
    if (names.size > 1) ambiguous++;
    if (![...names].some((n) => strip(n) === strip(stop.name))) {
      renamed++;
      flag(`"${stop.name}" is a name the site never prints; it uses ${[...names].map((n) => `"${n}"`).join(' / ')}`);
    }
  }
  console.log(`  ${BUS_STOPS.length - renamed}/${BUS_STOPS.length} poles show a name the site actually prints`);
  console.log(`  ${ambiguous} poles are printed under more than one name by the operator itself`);

  // Reported, not failed: where the page order contradicts the itinerary surveyed in OSM
  // the build deliberately replaces it (read literally, one page order is a 28 km crossing
  // of the city for a 10 km trip). Shown with the evidence beside it.
  rule('Stop order vs the operator (informational)');
  let reordered = 0;
  for (const parsed of reparsed) {
    const line = lineOf(parsed);
    if (!line) continue;
    parsed.directions.forEach((rawDir: any, i: number) => {
      const dir = line.directions[i];
      if (!dir) return;
      const published = [...new Set(rawDir.stops.map((ps: number) => canonicalOf.get(ps)).filter(Boolean) as string[])];
      const shipped = dir.stops;
      if (published.length !== shipped.length) return; // a set difference, already flagged

      // How many stops changed hands, not how many indices shifted: the length less the
      // longest run that keeps its relative order in both lists.
      const position = new Map(shipped.map((id, k) => [id, k]));
      const runs: number[][] = [];
      for (const id of published) {
        const k = position.get(id);
        if (k === undefined) continue;
        let best: number[] = [];
        for (const run of runs) if (run[run.length - 1] < k && run.length > best.length) best = run;
        runs.push([...best, k]);
      }
      const kept = runs.reduce((a, b) => (b.length > a.length ? b : a), []);
      const moved = published.length - kept.length;
      if (!moved) return;

      reordered++;
      const theirs = km(published);
      const ours = km(shipped);
      console.log(`  ${line.number}/${dir.id}: ${moved} of ${shipped.length} stops moved — page order ${theirs.toFixed(1)} km, ours ${ours.toFixed(1)} km (${ours < theirs ? 'ours is shorter' : 'THEIRS IS SHORTER — look at this'})`);
      const keptSet = new Set(kept);
      console.log(`      moved: ${published.filter((id) => !keptSet.has(position.get(id)!)).map(nameOf).join(', ')}`);
      if (ours >= theirs) problems++;
    });
  }
  console.log(reordered ? `  ${reordered} of 48 directions differ in order; the rest match the page exactly` : '  every itinerary is shipped in exactly the order the operator prints');

  rule('Lines serving each stop');
  const serves = new Map<string, Set<string>>();
  for (const line of BUS_LINES) {
    for (const id of line.directions.flatMap((d) => d.stops)) serves.set(id, (serves.get(id) ?? new Set()).add(line.id));
  }
  let mismatched = 0;
  for (const stop of BUS_STOPS) {
    const actual = serves.get(stop.id) ?? new Set<string>();
    const claimed = new Set(stop.lines);
    const ghost = [...claimed].filter((l) => !actual.has(l));
    const absent = [...actual].filter((l) => !claimed.has(l));
    if (ghost.length || absent.length) {
      mismatched++;
      flag(`${stop.name}: badges ${ghost.join(',') || '-'} that never call, missing ${absent.join(',') || '-'}`);
    }
  }
  console.log(`  ${BUS_STOPS.length - mismatched}/${BUS_STOPS.length} stops badge exactly the lines whose itineraries call there`);

  rule('Timetables vs the operator pages');
  let changed = 0;
  for (const parsed of reparsed) {
    const line = lineOf(parsed);
    if (line && JSON.stringify(parsed.services ?? []) !== JSON.stringify((line as any).services ?? [])) {
      changed++;
      flag(`line ${line.number}: the timetable on the page differs from the one we ship`);
    }
  }
  console.log(`  ${reparsed.length - changed}/${reparsed.length} lines ship the timetable the page prints`);

  console.log(`\n${problems === 0 ? 'No disagreements found.' : `${problems} disagreements to look at.`}`);
  // A scheduled job needs this to fail, not to print quietly into a log nobody reads.
  if (problems > 0) process.exitCode = 1;
  if (!FRESH) console.log('(run with --fresh to re-download the line pages and catch a stale snapshot)');
  else if (!FRESH_STOPS) console.log('(stop coordinates came from disk; --fresh-stops re-reads all 1186 pages)');
  console.log('');
}

main();
