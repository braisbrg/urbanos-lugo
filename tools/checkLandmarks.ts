/**
 * Are the hand-written landmark coordinates where OpenStreetMap says the place is?
 *
 * The 28 entries in LUGO_LANDMARKS were typed in by hand — the comment above them says
 * "calibrated", which is a claim nobody had checked. They were only reachable from the
 * route planner's autocomplete, where a wrong one costs a slightly wrong walk. Putting
 * them in the main search box makes each of them an answer to a question somebody asked,
 * so the claim needs to be true.
 *
 * This asks Overpass for anything in Lugo carrying the distinctive words of each name and
 * reports how far the nearest plausible match is. It cannot decide for you: "Praza Maior"
 * is a square a hundred metres across and its OSM node is not its centre. It tells you
 * which ones are worth a look, and 150 m is the line — under that, the two are describing
 * the same place from different corners of it; over it, one of them is wrong.
 *
 * Network, so it is not part of `pnpm test`. Run it when the list changes:
 *   pnpm check:landmarks
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LUGO_LANDMARKS } from '../src/utils/transitEngine';
import { metresBetween } from '../src/utils/geo';
import { BBOX, overpass } from './osm';

/** Over this, the two coordinates are not describing the same place. */
const SUSPICIOUS_METRES = 150;

/** Alongside the other cached scrapes, and gitignored like them. */
const CACHE = '.cache/landmarks-osm.json';

/**
 * The words worth searching OSM for.
 *
 * Our names carry qualifiers OSM does not — "(Porta de Santiago)", "de Lugo", the
 * disambiguations in brackets — so the query is built from the distinctive words rather
 * than the whole string. Only the words that would match hundreds of things are dropped:
 * the linking words, the city, and the four street types that head most of the map.
 *
 * Trimming this list further was the fix for two false alarms on the first run. "Pazo de
 * Feiras e Congresos" had every one of its words on it and so searched for nothing at
 * all, and was reported as missing from OSM. Matching too much is harmless here, because
 * candidates are ranked by distance and only the nearest three are printed.
 */
const GENERIC = /^(de|da|do|das|dos|e|a|o|as|os|la|el|los|las|y|lugo|rua|avenida|estacion|praza)$/i;

/**
 * Overpass regex does not fold accents, and neither side spells them the same: our list
 * says "Raiña" where OSM says "Raíña". Every vowel becomes a class of itself and its
 * accented forms, which is what turned "Rúa da Raiña" from "missing from OSM" into a
 * match 87 m away.
 */
const ACCENTS: Record<string, string> = {
  a: '[aáàâä]',
  e: '[eéèêë]',
  i: '[iíìîï]',
  o: '[oóòôö]',
  u: '[uúùûü]',
  n: '[nñ]',
  c: '[cç]',
};

const accentInsensitive = (word: string) =>
  [...word].map((ch) => ACCENTS[ch.toLowerCase()] ?? ch).join('');

const keywords = (name: string): string[] =>
  name
    .replace(/[()/,]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !GENERIC.test(word));

interface Candidate {
  name: string;
  lat: number;
  lng: number;
  kind: string;
  wikidata?: string;
  metres: number;
}

/**
 * A second reading, from a different database.
 *
 * Overpass and Nominatim are the same OpenStreetMap through two doors, so agreeing with
 * one another proves nothing. Wikidata is a separate record with its own editors and its
 * own coordinate (P625), and OSM links to it by id where somebody has bothered — which is
 * most of the notable places in a provincial capital. Where both exist and agree, the
 * point is confirmed twice; where they disagree, one of the two is wrong and it is worth
 * a human deciding which.
 */
async function wikidataPoints(ids: string[]): Promise<Map<string, [number, number]>> {
  const found = new Map<string, [number, number]>();
  // Fifty at a time is what the API takes, and this list is nowhere near that.
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}&props=claims&format=json&origin=*`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UrbanosLugoOpenData/1.0' } });
    if (!res.ok) {
      console.warn(`  ! Wikidata answered ${res.status}`);
      continue;
    }
    const json = (await res.json()) as { entities?: Record<string, { claims?: Record<string, unknown[]> }> };
    for (const [id, entity] of Object.entries(json.entities ?? {})) {
      const claim = entity.claims?.P625?.[0] as
        | { mainsnak?: { datavalue?: { value?: { latitude: number; longitude: number } } } }
        | undefined;
      const point = claim?.mainsnak?.datavalue?.value;
      if (point) found.set(id, [point.latitude, point.longitude]);
    }
  }
  return found;
}

/** Everything in Lugo whose name contains this word, as nodes, ways and relations. */
const queryFor = (word: string) => `[out:json][timeout:60];
(
  nwr["name"~"${accentInsensitive(word)}",i](${BBOX});
);
out center tags;`;

async function candidatesFor(word: string): Promise<Omit<Candidate, 'metres'>[]> {
  const json = await overpass(queryFor(word));
  if (!json?.elements) return [];
  return json.elements
    .map((element: Record<string, unknown>) => {
      const centre = element.center as { lat: number; lon: number } | undefined;
      const lat = (element.lat as number) ?? centre?.lat;
      const lng = (element.lon as number) ?? centre?.lon;
      const tags = (element.tags ?? {}) as Record<string, string>;
      if (typeof lat !== 'number' || typeof lng !== 'number') return null;
      const kind =
        tags.amenity ?? tags.shop ?? tags.leisure ?? tags.tourism ?? tags.railway ?? tags.highway ?? tags.place ?? tags.building ?? 'way';
      return { name: tags.name ?? '(unnamed)', lat, lng, kind, wikidata: tags.wikidata };
    })
    .filter(Boolean) as Omit<Candidate, 'metres'>[];
}

async function main() {
  console.log(`Checking ${LUGO_LANDMARKS.length} landmarks against OpenStreetMap.\n`);

  // One Overpass call per distinct word rather than per landmark: the list shares words
  // ("Termas", "Gándaras"), and it is a free shared service.
  //
  // And cached to disk, for the same reason. Getting this tool right took four runs of
  // about fifty queries each against somebody else's server, which is exactly what
  // CLAUDE.md says not to do. The answers change when Lugo changes, not when this script
  // does; delete the file to ask again.
  const wanted = [...new Set(LUGO_LANDMARKS.flatMap((landmark) => keywords(landmark.name)))].sort();
  const cache: Record<string, Omit<Candidate, 'metres'>[]> = existsSync(CACHE)
    ? JSON.parse(readFileSync(CACHE, 'utf8'))
    : {};

  const found = new Map<string, Omit<Candidate, 'metres'>[]>();
  let asked = 0;
  for (const word of wanted) {
    if (cache[word]) {
      found.set(word, cache[word]);
      continue;
    }
    process.stdout.write(`  ${word}… `);
    const hits = await candidatesFor(word);
    cache[word] = hits;
    found.set(word, hits);
    asked++;
    console.log(`${hits.length}`);
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n${asked} asked of Overpass, ${wanted.length - asked} read from ${CACHE}.`);

  // One call for every Wikidata id any candidate carries, before the loop below needs them.
  const ids = [...new Set([...found.values()].flat().map((c) => c.wikidata).filter(Boolean) as string[])];
  console.log(`\nAsking Wikidata for ${ids.length} linked entities.`);
  const secondOpinion = await wikidataPoints(ids);
  console.log(`  ${secondOpinion.size} carry a coordinate.\n`);

  const suspicious: string[] = [];
  let confirmed = 0;
  let contradicted = 0;

  for (const landmark of LUGO_LANDMARKS) {
    const pool = keywords(landmark.name).flatMap((word) => found.get(word) ?? []);
    const ranked: Candidate[] = pool
      .map((candidate) => ({
        ...candidate,
        metres: Math.round(metresBetween(landmark.lat, landmark.lng, candidate.lat, candidate.lng)),
      }))
      .sort((a, b) => a.metres - b.metres);

    const nearest = ranked[0];
    if (!nearest) {
      console.log(`  ?   ${landmark.name}\n        nothing in OSM carries these words — check the name, not the point`);
      suspicious.push(landmark.name);
      continue;
    }

    const flag = nearest.metres > SUSPICIOUS_METRES ? ' X ' : '   ';
    if (nearest.metres > SUSPICIOUS_METRES) suspicious.push(landmark.name);
    console.log(`${flag} ${String(nearest.metres).padStart(5)} m  ${landmark.name}`);
    for (const candidate of ranked.slice(0, 3)) {
      console.log(`          ${String(candidate.metres).padStart(5)} m  ${candidate.name} [${candidate.kind}]  ${candidate.lat.toFixed(5)},${candidate.lng.toFixed(5)}`);
    }

    // The second database, where there is one. Distance from OUR point, not from OSM's,
    // because ours is the one being checked.
    //
    // Only from a candidate we already believe is the place. Written as a plain `find`
    // over the whole ranked pool, this took the nearest feature that happened to carry a
    // Wikidata id — which, when nothing nearby was linked, was something else entirely
    // sharing one word of the name. It reported sixteen of the twenty-eight as
    // contradicted, including by 5.9 and 7.6 km, on the same run that found none of them
    // more than 150 m from OSM. Two checks of the same coordinates cannot both be right,
    // and the one that disagreed with itself was this one.
    const linked = ranked.find((c) => c.wikidata && secondOpinion.has(c.wikidata) && c.metres <= SUSPICIOUS_METRES);
    if (linked) {
      const [lat, lng] = secondOpinion.get(linked.wikidata!)!;
      const apart = Math.round(metresBetween(landmark.lat, landmark.lng, lat, lng));
      const verdict = apart > SUSPICIOUS_METRES ? 'DISAGREES' : 'agrees';
      if (apart > SUSPICIOUS_METRES) contradicted++;
      else confirmed++;
      console.log(`          wikidata ${linked.wikidata} ${verdict}: ${apart} m  (${lat.toFixed(5)},${lng.toFixed(5)})`);
    }
  }

  console.log(
    `\n${suspicious.length} of ${LUGO_LANDMARKS.length} are more than ${SUSPICIOUS_METRES} m from anything OSM calls by that name.`,
  );
  if (suspicious.length) console.log(suspicious.map((name) => `  - ${name}`).join('\n'));
  console.log(
    `Wikidata, where it has an opinion: ${confirmed} confirmed, ${contradicted} contradicted, ${LUGO_LANDMARKS.length - confirmed - contradicted} not linked.`,
  );
}

main();
