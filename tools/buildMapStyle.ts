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
 * Layers taken out, with the reason, because a deletion needs one more than a colour does.
 *
 * The rule for being on this list is not "Lugo has none of it" -- glaciers and country
 * borders are on neither. It is that the layer answers a question this screen is not for,
 * or actively works against the one it is.
 */
const DROP: Record<string, readonly string[]> = {
  dark: [
    // Nobody reading this is driving. The arrows arrive at zoom 15, which is exactly
    // where a stop label appears beside every pole and where the basemap's own street
    // names are faded out to make room for them -- so they spend the space that
    // decision had just cleared, on a restriction that matters to a car.
    //
    // They are also drawn wrong, which is how they got noticed. The sprite's `oneway`
    // icon is a 21x21 arrow pointing up with a long tail, and the layer places it with
    // `symbol-placement: line`, which aligns the icon along the road: an arrow drawn
    // upwards ends up across the street rather than along it. Same family as the
    // wood-pattern -- the style naming an image the sprite does not draw the way the
    // layer assumes. Rotating them was the alternative fix and it is the wrong one,
    // because a correct arrow is still an arrow this map has no use for.
    'road_oneway',
    'road_oneway_opposite',
  ],
  light: [
    // A flat wash over every residential polygon, at 0.6 to 0.8 opacity, all the way to
    // zoom 16. It is why whole neighbourhoods came out as one block of tinted
    // background with no buildings visible in them -- the wash is the same weight as
    // the footprints, so the footprints stop reading as separate things.
    //
    // The dark style already caps it at zoom 9, where it never draws in a city, and the
    // two themes should show the same things. What says "people live here" is the
    // buildings, and those are now heavy enough to say it on their own.
    'landuse_residential',
  ],
};

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
 *     ground        #171a1f  1,00     the floor
 *     major inner   #1e222a  1,09     where the ink lands: 1,76 at worst
 *     building      #232830  1,18     mass without linework; was 1,07, not a step
 *     park/wood     #1e2a1b  1,16     green enough to be a park
 *     minor         #2b3038  1,31     no casing, so it carries itself
 *     major casing  #39404b  1,67     a hairline, 0,65 px a side at zoom 14
 *
 * The faintest route colour is line 11 at 1,92 over the ground: 1,76 over the major
 * street it runs on and 1,46 over a minor one, which is 2,3 px wide at zoom 14. The
 * ceiling is not taste: one step brighter on either street and the 11 starts to vanish.
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
 * This said "left as published, because Positron already measures well" and shipped that
 * way for one commit. What had been measured was the route ink -- 4,04 at worst over the
 * white streets, which is fine -- and nothing else. The ground and the things standing on
 * it had never been put side by side, and they do not hold up:
 *
 *     major street  #ffffff              1,11   LIGHTER than the ground
 *     ground        rgb(242,243,240)     1,00
 *     building fill rgb(234,234,229)     1,08   darker
 *     building edge rgb(219,219,218)     1,24   darker
 *     minor street  hsl(0,0%,88%)        1,19   darker
 *     park          rgb(230,233,229)     1,10   darker
 *
 * Two things are wrong there and they are the same two the dark map had.
 *
 * The building's outline separates from the ground almost twice as well as its fill
 * does, so a block is drawn as a wireframe rather than as a mass -- every footprint
 * outlined individually, which is detail a bus app never uses and which is drawn
 * underneath the thing the screen is for. And the fill itself, at 1,08, does not separate
 * at all: the built-up part of Lugo and the fields around it are the same colour.
 *
 * So the same fix as the dark side. The outline takes the fill's colour and the mass
 * comes forward.
 *
 * ## Which way is "up"
 *
 * On the dark map everything above the ground is brighter. Here the ground is already
 * near white, so the room is downwards -- except that Positron's streets are white
 * ribbons, which is its whole design and worth keeping. That left the blocks and the
 * minor streets both on the dark side and a hundredth of a ratio apart, which is the
 * flatness again in a different order.
 *
 * The minor street goes up to join the majors instead. Streets are the light side, blocks
 * and water are the dark side, and the ground sits between them:
 *
 *     building      #dedcd4   1,23 darker    the mass
 *     ground        #f2f3f0   1,00
 *     minor street  #fafaf9   1,05 lighter
 *     major street  #ffffff   1,11 lighter
 *     water         published 1,52 darker    still the darkest large area, correctly
 *
 * The park and the woodland keep their published colours, and that is worth writing down
 * because the alternative was tried and is wrong. Giving them the dark map's real green
 * painted 57% of the screen -- counted off the frame -- because in OpenStreetMap almost
 * everything around Lugo is `landcover_wood`, so the city came out as a hole in a field
 * rather than as the mass of blocks this whole change is for. On the dark map the same
 * green sits at 1,16 against a near-black ground and reads as a park; on a near-white
 * one it is a hue shift across the entire map. Green is not what was wrong here.
 *
 * The route colours are dark and saturated -- the badge requirement that makes them a
 * problem on the dark map is what makes them easy here -- so the tightest one still sits
 * at 3,28 over the new blocks, above the 3:1 that non-text contrast asks for. The light
 * map has room the dark one does not, and this spends about half of it.
 *
 * The path label is the last thing: hsl(30,0%,62%) is 2,4 over the ground, under the 4,5
 * a label owes the reader.
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

  const gone = new Set(DROP[theme] ?? []);
  const absent = [...gone].filter((id) => !style.layers.some((l) => l.id === id));
  if (absent.length) {
    throw new Error(
      `${theme}: cannot drop ${absent.join(', ')}; the published style has no such layer. ` +
        'Upstream removed it, so remove it from DROP too rather than leaving a stale reason.',
    );
  }
  style.layers = style.layers.filter((l) => !gone.has(l.id));

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
