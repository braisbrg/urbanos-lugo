/**
 * Checks the shipped dataset against the pages it came from, one stop at a time.
 *
 *   npm run reconcile                    # re-reads the pages on disk
 *   npm run reconcile -- --fresh         # re-downloads the 24 line pages (~30 s)
 *   npm run reconcile -- --fresh-stops   # also the 1186 stop pages (~20 min)
 *
 * `--fresh` covers what actually drifts: itineraries and timetables. Stop coordinates
 * move so rarely that re-reading a page per stop is not worth twenty minutes, so that is
 * a separate flag for when a pole is suspected of having moved.
 *
 * The generated files are only as good as the pass that made them, and a scrape drifts:
 * the operator moves a pole, renames a stop, changes a departure. So this re-derives
 * everything straight from the operator's HTML — the same pages a passenger reads — and
 * from the independent survey in OpenStreetMap, then reports every disagreement.
 *
 * It deliberately does NOT read official-raw.json. That file is this build's own working
 * output; comparing it against the shipped data would compare a thing to itself and
 * always pass. The point is to go back to the source.
 *
 * Changes nothing. Read the report, then decide whether to regenerate.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BUS_LINES, BUS_STOPS } from '../src/data/transitData';
import { parseLine, stopsByPs } from './importOfficialData';
import { metresBetween as distance } from '../src/utils/geo';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '../.cache/official');
const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';
const FRESH_STOPS = process.argv.includes('--fresh-stops');
const FRESH = FRESH_STOPS || process.argv.includes('--fresh');
const PAGES = 30;

const osmStops: any[] = existsSync(join(HERE, '../.cache/osm-stops.json'))
  ? Object.values(JSON.parse(readFileSync(join(HERE, '../.cache/osm-stops.json'), 'utf8')))
  : [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


const percentile = (xs: number[], p: number): number =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))] : 0;

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
  if (shown < MAX_SHOWN) {
    shown++;
    console.log(`  ! ${message}`);
  } else if (shown === MAX_SHOWN) {
    shown++;
    console.log('  ! ...');
  }
}

const rule = (title: string) => {
  shown = 0;
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
};

/** The coordinate the operator publishes on a stop's own page, which is the QR target. */
function publishedCoords(html: string): [number, number] | null {
  const m = html.match(/(4[23]\.\d{4,})\s*,\s*(-[78]\.\d{4,})/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function main(): Promise<void> {
  console.log(
    `Reconciling ${BUS_STOPS.length} stops and ${BUS_LINES.length} lines against ` +
      (FRESH ? 'a fresh read of buslugo.com' : 'the operator pages on disk'),
  );
  if (FRESH) console.log('  downloading; the operator gets a second between requests');

  // ---- re-derive the operator's itineraries from the HTML ------------------------
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

    // Line 11 is four rural branches sharing one number, and the importer suffixes them
    // by destination. Skipping that here compared every branch against the one shipped
    // line called "11" and invented ~180 differences that were this reader's fault.
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
  for (const stop of BUS_STOPS) {
    for (const ps of (stop as any).officialIds ?? []) canonicalOf.set(ps, stop.id);
  }
  const stopById = new Map(BUS_STOPS.map((s) => [s.id, s]));
  const nameOf = (id: string) => stopById.get(id)?.name ?? id;

  // ---- 1. every stop's position, against its own page on the operator's site -----
  rule('Stop position vs the coordinate on its own buslugo page');
  const drift: number[] = [];
  let missingPage = 0;
  for (const [ps, canonical] of canonicalOf) {
    const html = await page(`https://buslugo.com/mapa/?ps=${ps}`, `stop-${ps}`, FRESH_STOPS);
    const coords = html ? publishedCoords(html) : null;
    if (!coords) {
      missingPage++;
      continue;
    }
    const stop = stopById.get(canonical)!;
    const d = distance(stop.lat, stop.lng, coords[0], coords[1]);
    drift.push(d);
    if (d > 60) flag(`${stop.name} sits ${Math.round(d)} m from what its page publishes for ps=${ps}`);
  }
  console.log(
    `  ${drift.length} stop pages checked; drift p50 ${Math.round(percentile(drift, 50))} m, ` +
      `p99 ${Math.round(percentile(drift, 99))} m, worst ${Math.round(Math.max(0, ...drift))} m`,
  );
  if (missingPage) console.log(`  ${missingPage} operator ids publish no coordinate`);

  // ---- 2. poles that merge several operator ids ---------------------------------
  rule('Poles that merge several operator ids');
  let merged = 0;
  let worstSpread = 0;
  for (const stop of BUS_STOPS) {
    const points: [number, number][] = [];
    for (const ps of (stop as any).officialIds ?? []) {
      const file = join(CACHE, `stop-${ps}.html`);
      if (!existsSync(file)) continue;
      const coords = publishedCoords(readFileSync(file, 'utf8'));
      if (coords) points.push(coords);
    }
    if (points.length < 2) continue;
    merged++;
    let spread = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        spread = Math.max(spread, distance(points[i][0], points[i][1], points[j][0], points[j][1]));
      }
    }
    worstSpread = Math.max(worstSpread, spread);
    // Two poles more than a street apart are two stops, and merging them moves both.
    if (spread > 80) flag(`${stop.name} merges ids ${Math.round(spread)} m apart — likely two different stops`);
  }
  console.log(`  ${merged} poles merge 2+ ids; widest spread ${Math.round(worstSpread)} m`);

  // ---- 3. the independent survey in OpenStreetMap -------------------------------
  rule('Stop position vs the survey in OpenStreetMap');
  if (!osmStops.length) {
    console.log('  no OSM stop cache; run `npm run data:amenities` first');
  } else {
    const offsets: number[] = [];
    let unmatched = 0;
    for (const stop of BUS_STOPS) {
      let best = Infinity;
      for (const node of osmStops) best = Math.min(best, distance(stop.lat, stop.lng, node.lat, node.lon));
      if (best > 120) {
        unmatched++;
        if (best > 500) flag(`${stop.name} has no surveyed stop within ${Math.round(best)} m`);
      } else offsets.push(best);
    }
    console.log(
      `  ${offsets.length}/${BUS_STOPS.length} within 120 m of a surveyed stop ` +
        `(p50 ${Math.round(percentile(offsets, 50))} m, p90 ${Math.round(percentile(offsets, 90))} m)`,
    );
    console.log(`  ${unmatched} with nothing surveyed nearby — expected for rural poles nobody has mapped`);
  }

  // ---- 4. which stops each line calls at ----------------------------------------
  rule('Itineraries vs the operator pages');
  for (const parsed of reparsed) {
    const line = BUS_LINES.find((l) => l.id === parsed.id);
    if (!line) {
      flag(`the site publishes line ${parsed.number}, the app does not have it`);
      continue;
    }
    parsed.directions.forEach((rawDir: any, i: number) => {
      const dir = line.directions[i];
      if (!dir) {
        flag(`line ${line.number} is missing direction ${i}`);
        return;
      }
      // Compared as sets. The ORDER is repaired on purpose wherever the page contradicts
      // the surveyed route — `npm run data:build` prints every such repair — so ordering
      // is checked there and against OSM, not here.
      const published = new Set(rawDir.stops.map((ps: number) => canonicalOf.get(ps)).filter(Boolean) as string[]);
      const shipped = new Set(dir.stops);
      for (const id of published) {
        if (!shipped.has(id)) flag(`line ${line.number}/${dir.id}: the site lists "${nameOf(id)}", we do not`);
      }
      for (const id of shipped) {
        if (!published.has(id)) flag(`line ${line.number}/${dir.id}: we list "${nameOf(id)}", the site does not`);
      }
    });
  }
  const shippedIds = new Set(BUS_LINES.map((l) => l.id));
  for (const id of shippedIds) {
    if (!reparsed.some((p) => p.id === id)) flag(`the app has line ${id}, the site no longer publishes it`);
  }

  // ---- 5. stop names -------------------------------------------------------------
  rule('Stop names vs the operator');
  const strip = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Compared per POLE, not per operator id. The site prints more than one name for the
  // same pole across its own ids — "Agro da Torna (Plaza)" and "(Praza)", "A Tolda
  // (UNED)" and "(Gasolinera)" — and the build shows the majority. Checking each id
  // against its own page therefore flagged eight stops whose name the site does print,
  // just under a sibling id: a fault in this reader, not in the data.
  const namesOfPole = new Map<string, Set<string>>();
  for (const [ps, canonical] of canonicalOf) {
    const name = stopsByPs.get(ps)?.name;
    if (!name) continue;
    if (!namesOfPole.has(canonical)) namesOfPole.set(canonical, new Set());
    namesOfPole.get(canonical)!.add(name);
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

  // ---- 5b. the ORDER the operator lists them in ----------------------------------
  //
  // Reported, not failed. Where the page order contradicts the itinerary surveyed in
  // OSM, the build deliberately replaces it — line 5.1's return is printed with two
  // stops near the start that the route passes at the end, which read literally is a
  // 28 km crossing of the city for a 10 km trip. Treating that repair as an error would
  // flag the one place the data was fixed. So the comparison is shown with the evidence
  // beside it: if reading the page order really is shorter, that is worth knowing.
  rule('Stop order vs the operator (informational)');
  let reordered = 0;
  for (const parsed of reparsed) {
    const line = BUS_LINES.find((l) => l.id === parsed.id);
    if (!line) continue;
    parsed.directions.forEach((rawDir: any, i: number) => {
      const dir = line.directions[i];
      if (!dir) return;

      const published: string[] = [];
      for (const ps of rawDir.stops) {
        const id = canonicalOf.get(ps);
        if (id && !published.includes(id)) published.push(id);
      }
      const shipped = dir.stops;
      if (published.length !== shipped.length) return; // a set difference, already flagged

      // How many stops actually changed hands, not how many indices shifted. Moving two
      // stops from the front to the back pushes every index in between, which reads as
      // "30 of 33 differ" when the honest answer is two. The real figure is the length
      // less the longest run of stops that keeps its relative order in both lists.
      const position = new Map(shipped.map((id, k) => [id, k]));
      const runs: number[][] = [];
      for (const id of published) {
        const at = position.get(id);
        if (at === undefined) continue;
        let best: number[] = [];
        for (const run of runs) if (run[run.length - 1] < at && run.length > best.length) best = run;
        runs.push([...best, at]);
      }
      const agreed = runs.reduce((a, b) => (b.length > a.length ? b : a), []).length;
      const moved = published.length - agreed;
      if (!moved) return;

      reordered++;
      const walk = (order: string[]) => {
        let total = 0;
        for (let k = 1; k < order.length; k++) {
          const a = stopById.get(order[k - 1]);
          const b = stopById.get(order[k]);
          if (a && b) total += distance(a.lat, a.lng, b.lat, b.lng);
        }
        return total / 1000;
      };
      const theirs = walk(published);
      const ours = walk(shipped);
      const verdict = ours < theirs ? 'ours is shorter' : 'THEIRS IS SHORTER — look at this';
      console.log(
        `  ${line.number}/${dir.id}: ${moved} of ${shipped.length} stops moved — ` +
          `page order ${theirs.toFixed(1)} km, ours ${ours.toFixed(1)} km (${verdict})`,
      );
      const kept = new Set(runs.reduce((a, b) => (b.length > a.length ? b : a), []));
      const names = published.filter((id) => !kept.has(position.get(id)!)).map(nameOf);
      console.log(`      moved: ${names.join(', ')}`);
      if (ours >= theirs) problems++;
    });
  }
  if (!reordered) console.log('  every itinerary is shipped in exactly the order the operator prints');
  else console.log(`  ${reordered} of 48 directions differ in order; the rest match the page exactly`);

  // ---- 6. which lines each stop claims to serve ----------------------------------
  rule('Lines serving each stop');
  const serves = new Map<string, Set<string>>();
  for (const line of BUS_LINES) {
    for (const dir of line.directions) {
      for (const id of dir.stops) {
        if (!serves.has(id)) serves.set(id, new Set());
        serves.get(id)!.add(line.id);
      }
    }
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

  // ---- 7. timetables -------------------------------------------------------------
  rule('Timetables vs the operator pages');
  let changed = 0;
  for (const parsed of reparsed) {
    const line = BUS_LINES.find((l) => l.id === parsed.id);
    if (!line) continue;
    if (JSON.stringify(parsed.services ?? []) !== JSON.stringify((line as any).services ?? [])) {
      changed++;
      flag(`line ${line.number}: the timetable on the page differs from the one we ship`);
    }
  }
  console.log(`  ${reparsed.length - changed}/${reparsed.length} lines ship the timetable the page prints`);

  console.log(`\n${problems === 0 ? 'No disagreements found.' : `${problems} disagreements to look at.`}`);
  // A scheduled job needs this to fail, not to print quietly into a log nobody reads:
  // a changed itinerary or timetable is the one thing that makes the shipped data wrong.
  if (problems > 0) process.exitCode = 1;
  if (!FRESH) console.log('(run with --fresh to re-download the line pages and catch a stale snapshot)');
  else if (!FRESH_STOPS) console.log('(stop coordinates came from disk; --fresh-stops re-reads all 1186 pages)');
  console.log('');
}

main();
