/**
 * The IGN's 5 m terrain model, cached one cell at a time for the ground the walkable
 * network covers, so `buildWalkGraph.ts` can put a height on every junction. Reads the raw
 * ways, not the graph that depends on it: pnpm run data:walk && data:elevation && data:walkgraph.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, sleep } from './lib';
import { CELL, COVERAGE, WCS, cellKey, cellUrl, decodeTiff } from './terrain';

const CACHE = '.cache/mdt';
/** Comfortably slower than anything that could be called hammering. */
const GAP_MS = 1500;

const tif = (key: string) => join(CACHE, `${key}.tif`);

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const ways = readJson<{ geometry: [number, number][] }[]>('data/osm-walk-network.json');
  const wanted = new Set(ways.flatMap((way) => way.geometry.map(([lat, lng]) => cellKey(lat, lng))));

  const total = wanted.size;
  const missing = [...wanted].filter((key) => !existsSync(tif(key)));
  console.log(`${COVERAGE} from ${WCS}`);
  console.log(`${total} cells of ${CELL}° cover the walkable network; ${missing.length} not cached.`);
  if (missing.length) {
    console.log(`One request every ${GAP_MS} ms: about ${((missing.length * GAP_MS) / 60000).toFixed(0)} minutes.\n`);
  }

  let got = 0;
  let failed = 0;
  for (const key of missing) {
    await sleep(GAP_MS);
    try {
      const res = await fetch(cellUrl(key), { headers: { 'User-Agent': 'UrbanosLugoOpenData/1.0' } });
      if (!res.ok) throw new Error(String(res.status));
      const body = Buffer.from(await res.arrayBuffer());
      // An out-of-range request comes back as an XML exception with a 200; decode before keeping.
      decodeTiff(body);
      writeFileSync(tif(key), body);
      got++;
      process.stdout.write(got % 20 ? '.' : ` ${got}/${missing.length}`);
    } catch (error) {
      failed++;
      console.log(`\n  ! ${key}: ${(error as Error).message}`);
    }
  }

  console.log(`\n\n${got} fetched, ${failed} failed, ${total - missing.length} already cached.`);

  // The range the cache spans, as a check that it is the right ground (roughly 370 m to 600 m).
  let low = Infinity;
  let high = -Infinity;
  let cells = 0;
  for (const key of wanted) {
    if (!existsSync(tif(key))) continue;
    cells++;
    for (const metres of decodeTiff(readFileSync(tif(key))).values) {
      if (metres < -1000) continue;
      low = Math.min(low, metres);
      high = Math.max(high, metres);
    }
  }
  console.log(`${cells} cells cached, heights from ${low} m to ${high} m.`);
}

main();
