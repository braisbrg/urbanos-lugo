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
import { LUGO_LANDMARKS } from '../src/utils/transitEngine';
import { metresBetween } from '../src/utils/geo';
import { BBOX, overpass } from './osm';

/** Over this, the two coordinates are not describing the same place. */
const SUSPICIOUS_METRES = 150;

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
  metres: number;
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
      return { name: tags.name ?? '(unnamed)', lat, lng, kind };
    })
    .filter(Boolean) as Omit<Candidate, 'metres'>[];
}

async function main() {
  console.log(`Checking ${LUGO_LANDMARKS.length} landmarks against OpenStreetMap.\n`);

  // One Overpass call per distinct word rather than per landmark: the list shares words
  // ("Termas", "Gándaras"), and it is a free shared service.
  const wanted = new Set(LUGO_LANDMARKS.flatMap((landmark) => keywords(landmark.name)));
  const found = new Map<string, Omit<Candidate, 'metres'>[]>();
  for (const word of wanted) {
    process.stdout.write(`  ${word}… `);
    const hits = await candidatesFor(word);
    found.set(word, hits);
    console.log(`${hits.length}`);
  }

  console.log('');
  const suspicious: string[] = [];

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
  }

  console.log(
    `\n${suspicious.length} of ${LUGO_LANDMARKS.length} are more than ${SUSPICIOUS_METRES} m from anything OSM calls by that name.`,
  );
  if (suspicious.length) console.log(suspicious.map((name) => `  - ${name}`).join('\n'));
}

main();
