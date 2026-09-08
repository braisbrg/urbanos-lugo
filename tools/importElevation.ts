/**
 * The IGN's 5 m terrain model, for the ground the walkable network covers.
 *
 * `tools/buildWalkGraph.ts` reads what this caches and writes a height onto every
 * junction, so the router can charge for a climb. Only the cells the network actually
 * passes through are asked for — Lugo's bounding box is mostly fields, and a coverage
 * nobody can walk in is a request nobody needs to make.
 *
 * The cells come from the raw ways rather than from the built graph, so this does not
 * depend on the graph that depends on it. Run it between the two:
 *   pnpm run data:walk && pnpm run data:elevation && pnpm run data:walkgraph
 *
 * Slowly and by hand. It is the national mapping agency's own service, asked once per
 * square kilometre of city, and the answers do not change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CELL, COVERAGE, WCS, cellKey, cellUrl, decodeTiff } from './terrain';

const CACHE = '.cache/mdt';
/** Comfortably slower than anything that could be called hammering. */
const GAP_MS = 1500;

interface KeptWay {
  geometry: [number, number][];
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const ways: KeptWay[] = JSON.parse(readFileSync('data/osm-walk-network.json', 'utf8'));

  // Every cell any walkable way passes through, plus the ring around it, because a
  // junction can sit within a pixel of a cell edge and the router reads its exact point.
  const wanted = new Set<string>();
  for (const way of ways) {
    for (const [lat, lng] of way.geometry) {
      wanted.add(cellKey(lat, lng));
    }
  }

  const total = wanted.size;
  const missing = [...wanted].filter((key) => !existsSync(join(CACHE, `${key}.tif`)));
  console.log(`${COVERAGE} from ${WCS}`);
  console.log(`${total} cells of ${CELL}° cover the walkable network; ${missing.length} not cached.`);
  if (missing.length) {
    const minutes = ((missing.length * GAP_MS) / 60000).toFixed(0);
    console.log(`One request every ${GAP_MS} ms: about ${minutes} minutes.\n`);
  }

  let got = 0;
  let failed = 0;
  for (const key of missing) {
    await new Promise((r) => setTimeout(r, GAP_MS));
    try {
      const res = await fetch(cellUrl(key), { headers: { 'User-Agent': 'UrbanosLugoOpenData/1.0' } });
      if (!res.ok) throw new Error(String(res.status));
      const body = Buffer.from(await res.arrayBuffer());
      // Decode before keeping it: the service answers an out-of-range request with an XML
      // exception and a 200, and a cache full of those would be silent nonsense later.
      decodeTiff(body);
      writeFileSync(join(CACHE, `${key}.tif`), body);
      got++;
      if (got % 20 === 0) process.stdout.write(` ${got}/${missing.length}`);
      else process.stdout.write('.');
    } catch (error) {
      failed++;
      console.log(`\n  ! ${key}: ${(error as Error).message}`);
    }
  }

  console.log(`\n\n${got} fetched, ${failed} failed, ${total - missing.length} already cached.`);

  // What the whole cache says, as a check that it is the right ground: Lugo's old town is
  // about 465 m, the Miño runs through at about 370, and the hills around reach 600.
  let low = Infinity;
  let high = -Infinity;
  let cells = 0;
  for (const key of wanted) {
    const file = join(CACHE, `${key}.tif`);
    if (!existsSync(file)) continue;
    cells++;
    for (const metres of decodeTiff(readFileSync(file)).values) {
      if (metres < -1000) continue;
      low = Math.min(low, metres);
      high = Math.max(high, metres);
    }
  }
  console.log(`${cells} cells cached, heights from ${low} m to ${high} m.`);
}

main();
