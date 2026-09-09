/**
 * The basemap style, ours, derived from OpenFreeMap's published pair.
 *
 *   pnpm run map:style            # rebuild from the cached copies -- offline, free
 *   pnpm run map:style --fetch    # re-download the published styles first
 *
 * Writes `src/data/map-style-light.json` and `src/data/map-style-dark.json`. Like
 * everything else in `src/data/`, those are generated: change the table below and re-run
 * rather than editing the JSON.
 *
 * ## Why this exists at all
 *
 * The colours used to be applied at runtime, with `setPaintProperty` over the style
 * fetched from `tiles.openfreemap.org/styles/dark` on every load. That cost three things.
 * The published colours paint first and ours a frame later, which is visible on every
 * theme switch. A style endpoint that changes shape leaves the app with no map, not with
 * a differently coloured one. And each adjustment was applied inside a `try`/`catch` that
 * forgives an id upstream may have renamed -- so an id that never existed was forgiven
 * just as quietly. That is not a hypothetical: the two published styles are not one
 * design with two palettes, `dark` names its layers with underscores and `positron` with
 * hyphens, and the adjustment that hides street names under our own stop labels named
 * only dark's. It never once applied to the light map, and nothing said so.
 *
 * Here the ids are checked when the file is built and again by `pnpm test`.
 *
 * ## What is not changed
 *
 * Tiles, sprites and glyphs still come from `tiles.openfreemap.org`, so the policy in
 * `src/security/csp.ts` gains no origin. The attribution is carried in the file itself as
 * well as by the map control. The layers stay as published, in their published order:
 * nine of them can never draw anything in Lugo -- glaciers, country and state borders,
 * counted at zero through Overpass -- and they stay in, because dropping them saves three
 * kilobytes and costs the map the moment somebody zooms out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Fewer labels where our own take over.
 *
 * From zoom 16 the map writes a name beside every stop -- a dozen on a phone screen --
 * and the basemap writes street names into the same space at the same time. Two sets of
 * text competing is how a map stops being readable, and only one of them answers the
 * question this screen is for.
 *
 * They fade out exactly where the stop names arrive rather than being removed: below 15
 * they are the only thing telling you where you are, and there are no stop labels yet to
 * take over. Both styles, because this is about density and not about the dark one being
 * dark -- which is what the previous version of this claimed and did not do.
 */
const FADE_ABOVE_16: unknown = ['interpolate', ['linear'], ['zoom'], 15, 1, 16.5, 0];

/**
 * The dark map.
 *
 * As published it puts everything inside seventeen levels of black: ground rgb(12,12,12),
 * water rgb(27,27,29), buildings rgb(10,10,10) -- darker than the ground they stand on.
 * The app's own background is #110d0d, so the map did not separate from the chrome round
 * it either. That flatness is what read as cheap; the detail was all there and all the
 * same colour.
 *
 * For years the answer to it was `filter: brightness(2.8)` on the tile pane, written when
 * the basemap was CARTO raster and there was no other lever on a picture. It outlived
 * CARTO by a provider change, so every colour below used to reach the screen multiplied
 * by 2.8 -- and, because the filter covers the tile pane and not the overlay pane above
 * it, the basemap was multiplied and the routes drawn on top of it were not. That is the
 * whole reason a bus line was disappearing into the street underneath it. The filter is
 * gone; these values are now what is on the screen.
 *
 * ## The order, and what sets the ceiling
 *
 * Ground at the bottom, blocks a step up, streets above them, and nothing anywhere near
 * the route drawn on top. Measured against the 21 distinct colours of the 24 lines:
 *
 *     ground     #171a1f  1,00     the floor
 *     building   #1c2027  1,07     mass without linework
 *     park/wood  #1e2a1b  1,16     green enough to be a park
 *     minor      #242932  1,19     no casing, so it carries itself
 *     major      #282d34  1,26     the widest thing on the map
 *     casing     #39404b  1,67     a hairline, 0,65 px a side at zoom 14
 *
 * The faintest route colour is line 11 at 1,92 over the ground, so a street at 1,26
 * leaves every one of the 21 at 1,53 or better over the widest thing they cross. The
 * ceiling is not taste: pushing the major street one step further puts line 11 under 1,5
 * and it starts to vanish.
 *
 * Line 11 is dark for a reason of its own -- the badge is white text at 10 px on that
 * colour and had to clear 4,5:1 -- so the two requirements pull opposite ways and the map
 * is the one that gives. If the basemap ever needs to be brighter than this, the lever is
 * a hairline casing under the route line, not another step here.
 *
 * Contrast is set for a phone in daylight, not for a dark room: dark mode here is a
 * preference, not a time of day.
 *
 * Water goes the other way, darker and actually blue, so the Miño reads as a river rather
 * than a slightly different rectangle. Buildings keep their mass and lose their linework:
 * nobody navigates by the shape of a block, and it was drawn underneath the thing the
 * screen is for.
 *
 * Tried and rejected: swapping the whole style for `fiord`, OpenFreeMap's designed dark.
 * Its ground is #45516E, a pale blue slab inside a near-black app -- the route line
 * dissolved into it and the white stop dots disappeared.
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
  // Upstream draws streets dark with a light edge, which is the right structure and the
  // one the runtime patches had inverted. The casing is what makes a street read as a
  // street; the inner is what the route line has to survive.
  ['highway_major_casing', 'line-color', '#39404b'],
  ['highway_motorway_casing', 'line-color', '#39404b'],
  /*
   * A colour instead of a texture that does not exist.
   *
   * The published dark style paints woodland with `fill-pattern: "wood-pattern"` and the
   * sprite it names has no such image -- 264 icons and not one pattern among them -- so
   * every load logged "Image 'wood-pattern' could not be loaded" and the woods came out
   * unpainted. Upstream's bug, ours to survive. The pattern is deleted alongside the
   * colour because a pattern, when it is set, wins over the colour.
   */
  ['landcover_wood', 'fill-pattern', null],
  ['landcover_wood', 'fill-color', '#1e2a1b'],
  // Parks came as rgb(32,32,32), a grey: a park drawn as a block is a block. Same green.
  ['landuse_park', 'fill-color', '#1e2a1b'],
  /*
   * Labels are measured against 4,5 rather than against the ceiling above, because a
   * label is text and has to be read. Published, they do not reach it: street names come
   * at rgba(80,78,78) and place names at rgb(101,101,101), which are 2,3 and 3,0 over the
   * ground. The water name is black at 70% on a near-black map, which is not dim, it is
   * absent.
   */
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
 * The light map.
 *
 * Positron is left as published apart from the fade, and that is a decision rather than
 * an oversight. Its ground rgb(242,243,240) already separates from the app's #fefdfd, its
 * layers already differ from one another, and the route colours -- dark and saturated by
 * the badge requirement that makes them a problem on the dark map -- sit at 4,04 at worst
 * over the white streets they cross. Redesigning what already measures well would be
 * redesigning for its own sake.
 *
 * The path label is the one exception: hsl(30,0%,62%) is 2,4 over the ground, under the
 * 4,5 a label owes the reader.
 */
const LIGHT: readonly Edit[] = [
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

async function fetchPublished(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  for (const [theme, url] of Object.entries(PUBLISHED)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body = await res.text();
    writeFileSync(join(CACHE, `${theme === 'light' ? 'positron' : 'dark'}.json`), body);
    console.log(`fetched ${url} -- ${body.length} bytes`);
    // One request a second is the courtesy every other tool here keeps.
    await new Promise((r) => setTimeout(r, 1100));
  }
}

/** Apply the table, and refuse to write a style whose ids have drifted from ours. */
function derive(published: Style, edits: readonly Edit[], theme: string): Style {
  const style: Style = JSON.parse(JSON.stringify(published));
  const byId = new Map(style.layers.map((l) => [l.id, l]));

  const missing = [...new Set(edits.map(([id]) => id))].filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(
      `${theme}: the published style has no layer ${missing.join(', ')}. ` +
        'Upstream renamed or dropped it -- fix the table rather than skipping it.',
    );
  }

  for (const [id, property, value] of edits) {
    const layer = byId.get(id)!;
    layer.paint ??= {};
    if (value === null) delete layer.paint[property];
    else layer.paint[property] = value;
  }

  // The credit travels with the file as well as with the map control, so a style lifted
  // out of here on its own still carries it.
  for (const source of Object.values(style.sources)) source.attribution = ATTRIBUTION;
  style.metadata = {
    'urbanos-lugo:derived-from': PUBLISHED[theme as keyof typeof PUBLISHED],
    'urbanos-lugo:note':
      'Generated by tools/buildMapStyle.ts -- do not edit by hand. Tiles, sprites and ' +
      'glyphs are still served by OpenFreeMap.',
  };
  return style;
}

if (process.argv.includes('--fetch')) await fetchPublished();

let wrote = 0;
for (const [theme, file] of [
  ['light', 'positron'],
  ['dark', 'dark'],
] as const) {
  const source = join(CACHE, `${file}.json`);
  if (!existsSync(source)) {
    throw new Error(`${source} is missing. Run with --fetch once to download it.`);
  }
  const published = JSON.parse(readFileSync(source, 'utf8')) as Style;
  const style = derive(published, theme === 'dark' ? DARK : LIGHT, theme);
  const out = join(OUT, `map-style-${theme}.json`);
  writeFileSync(out, JSON.stringify(style));
  const edits = theme === 'dark' ? DARK.length : LIGHT.length;
  console.log(
    `${out}  ${style.layers.length} layers, ${edits} edits, ` +
      `${(JSON.stringify(style).length / 1024).toFixed(1)} KB`,
  );
  wrote++;
}
console.log(`${wrote} styles written.`);
