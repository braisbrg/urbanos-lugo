/**
 * Are the hand-written landmark coordinates where OpenStreetMap says the place is?
 *
 * LUGO_LANDMARKS was typed in by hand, and the main search box offers every entry as an
 * answer, so the claim that they are calibrated has to be true. This asks Overpass for
 * anything in Lugo carrying the distinctive words of each name and reports how far the
 * nearest plausible match is. It cannot decide for you — "Praza Maior" is a hundred metres
 * across and its OSM node is not its centre — but 150 m is the line: under it the two are
 * describing the same place from different corners; over it, one of them is wrong.
 *
 * Network, so not part of `pnpm test`. Run it when the list changes:
 *   pnpm check:landmarks
 */
import { existsSync } from 'node:fs';
import { LUGO_LANDMARKS } from '../src/utils/places';
import { metresBetween } from '../src/utils/geo';
import { readJson, writeJson } from './lib';
import { BBOX, overpass } from './osm';

/** Over this, the two coordinates are not describing the same place. */
const SUSPICIOUS_METRES = 150;

/** Alongside the other cached scrapes, and gitignored like them. */
const CACHE = '.cache/landmarks-osm.json';

/**
 * Words too common to search OSM for: the linking words, the city, the street types that
 * head most of the map. Nothing more — a name made only of dropped words searches for
 * nothing and is reported as missing, while matching too much is harmless because only
 * the nearest three candidates are printed.
 */
const GENERIC = /^(de|da|do|das|dos|e|a|o|as|os|la|el|los|las|y|lugo|rua|avenida|estacion|praza)$/i;

/** Overpass regex does not fold accents, and the two sides spell them differently ("Raiña" / "Raíña"). */
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

interface Hit {
  name: string;
  lat: number;
  lng: number;
  kind: string;
  wikidata?: string;
}
type Candidate = Hit & { metres: number };

/**
 * A second reading from a separate database. Overpass and Nominatim are the same OSM
 * through two doors; Wikidata has its own editors and its own coordinate (P625), and OSM
 * links to it by id for most notable places. Where the two disagree, a human decides.
 */
async function wikidataPoints(ids: string[]): Promise<Map<string, [number, number]>> {
  const found = new Map<string, [number, number]>();
  // Fifty at a time is what the API takes.
  for (let i = 0; i < ids.length; i += 50) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join('|')}&props=claims&format=json&origin=*`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UrbanosLugoOpenData/1.0' } });
    if (!res.ok) {
      console.warn(`  ! Wikidata answered ${res.status}`);
      continue;
    }
    const json: any = await res.json();
    for (const [id, entity] of Object.entries<any>(json.entities ?? {})) {
      const point = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
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

async function candidatesFor(word: string): Promise<Hit[]> {
  const json = await overpass(queryFor(word));
  return (json?.elements ?? []).flatMap((element: any): Hit[] => {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') return [];
    const tags = element.tags ?? {};
    const kind =
      tags.amenity ?? tags.shop ?? tags.leisure ?? tags.tourism ?? tags.railway ?? tags.highway ?? tags.place ?? tags.building ?? 'way';
    return [{ name: tags.name ?? '(unnamed)', lat, lng, kind, wikidata: tags.wikidata }];
  });
}

async function main() {
  console.log(`Checking ${LUGO_LANDMARKS.length} landmarks against OpenStreetMap.\n`);

  // One Overpass call per distinct word rather than per landmark, and cached to disk: it
  // is a free shared service, and the answers change when Lugo changes, not when this
  // script does. Delete the file to ask again.
  const wanted = [...new Set(LUGO_LANDMARKS.flatMap((landmark) => keywords(landmark.name)))].sort();
  const cache: Record<string, Hit[]> = existsSync(CACHE) ? readJson(CACHE) : {};
  let asked = 0;
  for (const word of wanted) {
    if (cache[word]) continue;
    process.stdout.write(`  ${word}… `);
    cache[word] = await candidatesFor(word);
    asked++;
    console.log(`${cache[word].length}`);
  }
  writeJson(CACHE, cache, false);
  console.log(`\n${asked} asked of Overpass, ${wanted.length - asked} read from ${CACHE}.`);

  // One call for every Wikidata id any candidate carries, before the loop below needs them.
  const ids = [...new Set(wanted.flatMap((word) => cache[word]).flatMap((c) => (c.wikidata ? [c.wikidata] : [])))];
  console.log(`\nAsking Wikidata for ${ids.length} linked entities.`);
  const secondOpinion = await wikidataPoints(ids);
  console.log(`  ${secondOpinion.size} carry a coordinate.\n`);

  const suspicious: string[] = [];
  let confirmed = 0;
  let contradicted = 0;

  for (const landmark of LUGO_LANDMARKS) {
    const metresFrom = (lat: number, lng: number) => Math.round(metresBetween(landmark.lat, landmark.lng, lat, lng));
    const ranked: Candidate[] = keywords(landmark.name)
      .flatMap((word) => cache[word])
      .map((hit) => ({ ...hit, metres: metresFrom(hit.lat, hit.lng) }))
      .sort((a, b) => a.metres - b.metres);

    const nearest = ranked[0];
    if (!nearest) {
      console.log(`  ?   ${landmark.name}\n        nothing in OSM carries these words — check the name, not the point`);
      suspicious.push(landmark.name);
      continue;
    }

    const far = nearest.metres > SUSPICIOUS_METRES;
    if (far) suspicious.push(landmark.name);
    console.log(`${far ? ' X ' : '   '} ${String(nearest.metres).padStart(5)} m  ${landmark.name}`);
    for (const c of ranked.slice(0, 3)) {
      console.log(`          ${String(c.metres).padStart(5)} m  ${c.name} [${c.kind}]  ${c.lat.toFixed(5)},${c.lng.toFixed(5)}`);
    }

    // The second database, measured from OUR point (the one being checked), and only via a
    // candidate already believed to be the place: a plain `find` over the whole pool takes
    // the nearest feature that happens to carry an id, which can be something else entirely
    // sharing one word of the name.
    const linked = ranked.find((c) => c.wikidata && secondOpinion.has(c.wikidata) && c.metres <= SUSPICIOUS_METRES);
    if (!linked) continue;
    const [lat, lng] = secondOpinion.get(linked.wikidata!)!;
    const apart = metresFrom(lat, lng);
    if (apart > SUSPICIOUS_METRES) contradicted++;
    else confirmed++;
    console.log(`          wikidata ${linked.wikidata} ${apart > SUSPICIOUS_METRES ? 'DISAGREES' : 'agrees'}: ${apart} m  (${lat.toFixed(5)},${lng.toFixed(5)})`);
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
