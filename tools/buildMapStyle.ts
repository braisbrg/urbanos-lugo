/**
 * The basemap style, ours, derived from OpenFreeMap's published pair.
 *
 *   pnpm run map:style            # rebuild from the cached copies -- offline, free
 *   pnpm run map:style --fetch    # re-download the published styles first
 *
 * Writes `src/data/map-style-light.json` and `-dark.json`; change the tables below and
 * re-run rather than editing the JSON. Built once rather than patched at runtime because
 * the published colours painted first and ours a frame later, an endpoint that changed
 * shape left the app with no map, and an id that never existed was forgiven as quietly as
 * one upstream had renamed (the two styles name their layers differently, and the dark
 * adjustments never once applied to the light map). Here a wrong id refuses to build.
 *
 * Tiles, sprites and glyphs still come from tiles.openfreemap.org, so the CSP gains no
 * origin; the layers stay as published, in their published order. The measurements
 * behind every value are in design/DECIDIDO.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from './lib';

const CACHE = '.cache/style';
const OUT = 'src/data';
const PUBLISHED = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** Their terms ask for the credit to stay visible; it is also written into the file. */
const ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

/** A paint property to set on one layer. `null` deletes the property instead. */
type Edit = readonly [layer: string, property: string, value: unknown];

/** Layers taken out: not because Lugo has none of it, but because it works against the screen. */
const DROP: Record<string, readonly string[]> = {
  // One-way arrows: nobody reading this is driving, they arrive at zoom 15 in the space
  // just cleared for the stop labels, and the sprite draws them across the street anyway.
  dark: ['road_oneway', 'road_oneway_opposite'],
  // A flat wash over every residential polygon, the same weight as the footprints, so
  // whole neighbourhoods came out as one tinted block. Dark already caps it at zoom 9.
  light: ['landuse_residential'],
};

/**
 * From zoom 16 the map writes a name beside every stop, into the space the basemap's
 * street names take at the same time. They fade out where the stop names arrive rather
 * than being removed: below 15 they are the only thing saying where you are.
 */
const FADE_ABOVE_16: unknown = ['interpolate', ['linear'], ['zoom'], 15, 1, 16.5, 0];

/**
 * The dark map. Published, everything sits inside seventeen levels of black, and for
 * years a `brightness(2.8)` filter on the tile pane hid that while leaving the routes
 * unmultiplied, which is why a bus line vanished into the street under it. These are the
 * values on the screen now: ground at the bottom, blocks a step up, streets above, and
 * every step held under the faintest route colour (line 11 at 1,76 over a major street).
 * If the basemap must ever be brighter, the lever is a casing under the route, not a step
 * here. Labels are measured against 4,5, because they are text.
 */
const DARK: readonly Edit[] = [
  ['background', 'background-color', '#171a1f'],
  ['water', 'fill-color', '#0e151d'],
  ['waterway', 'line-color', '#16232f'],
  ['building', 'fill-color', '#232830'],
  ['building', 'fill-outline-color', '#232830'],
  ['highway_minor', 'line-color', '#2b3038'],
  ['highway_major_inner', 'line-color', '#1e222a'],
  ['highway_motorway_inner', 'line-color', '#1e222a'],
  // Dark streets with a light edge, as upstream draws them: the casing is what makes a
  // street read as a street; the inner is what the route line has to survive.
  ['highway_major_casing', 'line-color', '#39404b'],
  ['highway_motorway_casing', 'line-color', '#39404b'],
  // The published style paints woodland with a `wood-pattern` its own sprite does not
  // carry, so every load logged an error and the woods came out unpainted. A set pattern
  // wins over a colour, so it goes.
  ['landcover_wood', 'fill-pattern', null],
  ['landcover_wood', 'fill-color', '#1e2a1b'],
  ['landuse_park', 'fill-color', '#1e2a1b'],
  ['highway_name_other', 'text-color', '#9098a5'],
  ['highway_name_motorway', 'text-color', '#9098a5'],
  ['highway_name_other', 'text-opacity', FADE_ABOVE_16],
  ['highway_name_motorway', 'text-opacity', FADE_ABOVE_16],
  ['place_other', 'text-color', '#a7aeb9'],
  ['place_suburb', 'text-color', '#a7aeb9'],
  ['place_village', 'text-color', '#a7aeb9'],
  ['place_town', 'text-color', '#c2c8d1'],
  ['place_city', 'text-color', '#c2c8d1'],
  ['water_name', 'text-color', '#7ba3c4'],
  ['water_name', 'text-halo-color', '#0b1119'],
];

/**
 * The light map. Positron's white streets are its design and stay; what did not hold up
 * was a building outline separating twice as well as its fill (a block as a wireframe)
 * and a fill that did not separate the city from the fields at all. So the outline takes
 * the fill's colour and the mass comes forward, the minor street joins the majors on the
 * light side, and the ground sits between. Park and woodland keep their published
 * colours: the dark map's green painted 57% of the screen here.
 */
const LIGHT: readonly Edit[] = [
  ['building', 'fill-color', '#dedcd4'],
  ['building', 'fill-outline-color', '#dedcd4'],
  ['highway_minor', 'line-color', '#fafaf9'],
  ['highway-name-minor', 'text-opacity', FADE_ABOVE_16],
  ['highway-name-major', 'text-opacity', FADE_ABOVE_16],
  ['highway-name-path', 'text-opacity', FADE_ABOVE_16],
  ['highway-name-path', 'text-color', '#767472'],
];

interface Layer {
  id: string;
  type: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}
interface Style {
  version: number;
  sprite?: string;
  glyphs?: string;
  sources: Record<string, Record<string, unknown>>;
  layers: Layer[];
  [key: string]: unknown;
}

const THEMES = [
  ['light', 'positron'],
  ['dark', 'dark'],
] as const;

async function fetchPublished(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  for (const [theme, file] of THEMES) {
    const url = PUBLISHED[theme];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body = await res.text();
    writeFileSync(join(CACHE, `${file}.json`), body);
    console.log(`fetched ${url} -- ${body.length} bytes`);
    await sleep(1100); // one request a second, the courtesy every other tool here keeps
  }
}

/** Apply the table, and refuse to write a style whose ids have drifted from ours. */
function derive(published: Style, edits: readonly Edit[], theme: keyof typeof PUBLISHED): Style {
  const style: Style = JSON.parse(JSON.stringify(published));
  const has = (id: string) => style.layers.some((l) => l.id === id);

  const gone = new Set(DROP[theme] ?? []);
  const absent = [...gone].filter((id) => !has(id));
  if (absent.length) throw new Error(`${theme}: cannot drop ${absent.join(', ')}; the published style has no such layer. Upstream removed it, so remove it from DROP too rather than leaving a stale reason.`);
  style.layers = style.layers.filter((l) => !gone.has(l.id));

  const missing = [...new Set(edits.map(([id]) => id))].filter((id) => !has(id));
  if (missing.length) throw new Error(`${theme}: the published style has no layer ${missing.join(', ')}. Upstream renamed or dropped it -- fix the table rather than skipping it.`);

  const byId = new Map(style.layers.map((l) => [l.id, l]));
  for (const [id, property, value] of edits) {
    const paint = (byId.get(id)!.paint ??= {});
    if (value === null) delete paint[property];
    else paint[property] = value;
  }

  // The credit travels with the file as well as with the map control.
  for (const source of Object.values(style.sources)) source.attribution = ATTRIBUTION;
  style.metadata = {
    'urbanos-lugo:derived-from': PUBLISHED[theme],
    'urbanos-lugo:note': 'Generated by tools/buildMapStyle.ts -- do not edit by hand. Tiles, sprites and glyphs are still served by OpenFreeMap.',
  };
  return style;
}

if (process.argv.includes('--fetch')) await fetchPublished();

for (const [theme, file] of THEMES) {
  const source = join(CACHE, `${file}.json`);
  if (!existsSync(source)) throw new Error(`${source} is missing. Run with --fetch once to download it.`);
  const edits = theme === 'dark' ? DARK : LIGHT;
  const style = derive(JSON.parse(readFileSync(source, 'utf8')) as Style, edits, theme);
  const out = join(OUT, `map-style-${theme}.json`);
  writeFileSync(out, JSON.stringify(style));
  console.log(`${out}  ${style.layers.length} layers, ${edits.length} edits, ${(JSON.stringify(style).length / 1024).toFixed(1)} KB`);
}
console.log(`${THEMES.length} styles written.`);
