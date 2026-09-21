# Where the data comes from, and under what terms

This is an unofficial project. It is not made, reviewed or endorsed by AULUSA, Grupo
Monbus or the Concello de Lugo; it reads what the operator publishes. Where a timetable
matters, the operator's own page is the authority.

The MIT licence in `LICENSE` covers the source code. The datasets are not the authors'
to relicense, and each has its own provenance. They sit in three places: `src/data/` is
what ships in the bundle, `public/alerts.json` is the one file that ships beside it (the
service-notice snapshot, refreshed on every scheduled build and kept out of the bundle so
that a refresh renames no chunk), and `data/` holds the snapshots the generator reads.
The split is about what reaches the bundle, not about terms — everything below applies
to all three.

## Public holidays — Diario Oficial de Galicia

`src/data/festivos.json` lists, per year, the days the operator runs its Sunday timetable
on that are not Sundays: the regional calendar (a decree in the DOG each spring) and the
two local holidays of Lugo (a resolution in the DOG each autumn). Each year carries the
DOG entries it was read from. Legal texts are not subject to copyright in Spain (Ley de
Propiedad Intelectual, art. 13). The file has to be extended by hand every year, and
`tools/test.ts` fails once the current year is missing, which is the reminder.

## Timetables and stops — buslugo.com (AULUSA / Grupo Monbus)

Departure times, timing points, stop names and pole codes are transcribed from the
timetables the concessionaire publishes at <https://buslugo.com>, the page Lugo
residents are pointed at.

- **Status:** published for public consultation. No licence is stated on the source
  and no data-reuse agreement has been granted to this project.
- **Consequence:** this repository is a reader of a public timetable, not an official
  service, and is not endorsed by or affiliated with AULUSA, Grupo Monbus or the
  Concello de Lugo. Anyone redistributing this dataset should reach their own
  conclusion about the terms, not rely on this note.
- **Verification:** `npm run reconcile` re-parses buslugo's own pages and compares
  them stop by stop against the shipped dataset. `npm run reconcile:selftest` proves
  that comparison can actually fail.
- **One thing worth naming rather than leaving implied:** a departure time is a fact and
  facts are not copyrightable, but in the EU a *collection* of them can carry a sui
  generis database right of its own, separate from copyright, belonging to whoever
  invested in assembling it. Whether the timetables attract one, and whether reading them
  the way this project does falls inside it, is not something this file can settle. It is
  written down here so that anyone who needs an answer knows the question exists rather
  than assuming "public web page" settles it. What this project does about it in practice:
  it reads the pages a passenger reads, at the rate a passenger would, identifies itself
  in its User-Agent, links back to the source on every screen, and points anyone who needs
  certainty at the operator's own page.
- **Coordinates are the operator's, with one exception, and the exception is OSM's.**
  Each pole's position is read from the operator's own page for it. For one stop,
  "Estda. Nova Santiago (Monte Segade)", that page places the pin five metres from the
  previous stop of the same direction and 1.1 km from the pole OpenStreetMap surveys under
  the same name — a mis-entered coordinate, not a position. `tools/buildDataset.ts` takes
  the OSM pole only when both hold (pin duplicating a neighbour's, same-named pole far
  away), marks the stop `positionSource: "osm"`, and reports every other close pair without
  touching it. That one coordinate is OSM data and carries ODbL and its attribution like the
  rest of `data/stop-amenities.json`, where it is recorded; `tools/test.ts` holds the count
  at one.

## Route geometry — OpenStreetMap

Every drawn itinerary follows an OSM route relation, or the OSRM driving profile
where no surveyed relation exists.

- **Licence:** Open Database License (ODbL) 1.0 — <https://opendatacommons.org/licenses/odbl/>
- **Attribution:** "© OpenStreetMap contributors", shown on the map and in the menu.
- **Consequence:** the derived geometry is a Derivative Database under ODbL and stays
  under ODbL. It is not covered by the MIT licence. That is `src/data/route-geometry.json`,
  which ships, and the snapshots it is built from: `data/osm-routes.json`,
  `data/routes.json` and `data/stop-amenities.json`.
- **The same applies to the pedestrian network.** `src/data/walk-network.json` — 21.093
  junctions, 29.489 edges, 2.516 km of walkable way — is built by `tools/buildWalkGraph.ts`
  from `data/osm-walk-network.json`, which `tools/importWalkNetwork.ts` takes from
  Overpass. Derivative Database, ODbL, same as the route geometry. It exists so that a
  walking time is a real route rather than a straight line, and so that no coordinate has
  to be sent anywhere to work one out.

## Map tiles — OpenFreeMap

Basemap tiles come from **OpenFreeMap**, which serves the OpenMapTiles schema built from
OpenStreetMap data. No key, no account, no quota. The map credits OpenFreeMap,
OpenMapTiles and OpenStreetMap contributors in its own corner, and the tiles are fetched
as the reader pans rather than redistributed here.

The **style** is not theirs, but it is derived from theirs.
`src/data/map-style-light.json` and `map-style-dark.json` are generated by
`tools/buildMapStyle.ts` from the published `positron` and `dark` styles, with a table of
colour changes applied — the colours are measured against the 24 route colours drawn on
top of them, which is what the published pair was never designed for. Both files carry the
attribution inside them as well as in the map control, and both still point their tiles,
sprites and glyphs at `tiles.openfreemap.org`, so nothing here is rehosted. Re-run
`pnpm run map:style --fetch` to pull the published styles again and re-derive.

Type faces on the map come from two places and it is worth knowing which. The app's own
text, including the line number inside a stop pin, is **Atkinson Hyperlegible Next**,
self-hosted from `src/fonts/`. The street and place names inside the basemap are rendered
from OpenFreeMap's own SDF glyph tiles, which are **Noto Sans**; they fade out above zoom
16.5, where the app's own labels take over.

A device without WebGL2 falls back to raster tiles from **tile.openstreetmap.org**, under
that project's tile usage policy: fetched as the reader pans, cached, never bulk
downloaded or prefetched.

This used to be CARTO. It was replaced in August 2026, when CARTO began stamping "API KEY
REQUIRED" across the tiles of its keyless basemaps.

## Overpass API — how the OpenStreetMap data is actually fetched

`overpass-api.de` answers the two queries behind the route relations and the stop
amenities. The data is OSM's, so the section above governs it; what is worth stating here
is the load. `pnpm data:osm` and `pnpm data:amenities` are run by hand and their answers
are committed, so a rebuild costs nothing; the weekly check in `.github/workflows/`
sends **two requests a week**. Nothing in the browser ever calls it.

## Routing — two public services, used differently

- **`router.project-osrm.org`**, the OSRM project's public demo server, gives the driving
  time and shape between consecutive stops where no surveyed relation exists. **Build
  time only**, cached under `.cache/` and committed as `data/routes.json`, precisely so
  that regenerating the dataset does not go back to it. No reader's browser calls it.
- **`routing.openstreetmap.de/routed-foot`** used to draw the pedestrian path for a
  walking leg, and was the only one of these called from a reader's browser — the
  endpoints are wherever they asked to go, so nothing could precompute it. It is no
  longer called from anywhere. The app carries the walkable network itself
  (`src/data/walk-network.json`, above) and routes on the device, which is both faster
  and the reason no coordinate has to leave it. `tools/calibrateWalking.ts` still names
  the host, at build time and by hand, because comparing our answers against a second
  implementation is what tells us ours are right.

  Both serve OSM-derived data under ODbL, and both are free services with usage policies
  of their own — FOSSGIS ask for one request a second, no scraping and no heavy usage.
  Check them before pointing anything heavier at them.

## Altitude — Instituto Geográfico Nacional (MDT05)

- **What:** how high the ground is under each of the 21.093 junctions of the walking
  network, so a route can charge for a climb. OpenStreetMap carries no elevation, and
  without this the router was right about the pavement and silent about the hill — which
  in a city with the Miño at the bottom and a walled town on top is most of the difference
  between the two ways along one street.
- **Source:** the **MDT05**, Spain's national terrain model on a 5 m grid, derived from
  the airborne LiDAR of the PNOA programme, fetched from the IGN's INSPIRE WCS at
  `servicios.idee.es/wcs-inspire/mdt` (coverage `Elevacion4258_5`). 460 coverages of 0,01°
  cover the walkable network; only cells a walkable way passes through are asked for.
- **Licence:** **CC BY 4.0** under the Sistema Cartográfico Nacional. Attribution as
  published: `CC BY 4.0 scne.es`, carried in `NOTICE.md`.
- **Why this rather than the global tiles:** the first version read the Terrarium tiles on
  AWS, which are about 28 m a pixel over Spain and are a worldwide composite. Asking the
  national mapping agency for its own LiDAR is five times finer, and this is the number
  that gets stored, so it is worth the extra requests. They are made by hand, spaced
  1,5 s apart, and cached under `.cache/mdt/` — 46 MB that never ships.
- **Consequence:** the heights live in `src/data/walk-network.json` alongside the graph,
  delta-coded, together with what each edge climbs in each direction — the build walks
  every street's own profile at 5 m rather than subtracting the heights of its two ends,
  because 287 edges hide ten metres or more of climb between level ends. 21.093 heights
  and 29.489 pairs of ascents for 36 KB gzipped. That file is therefore covered by
  **both** ODbL (the geometry, from OSM) and CC BY 4.0 (the heights, from the IGN), and
  both are credited.

## Service notices — buslugo.com and the Concello de Lugo

The notices screen reads two kinds of thing, and keeps them apart on screen because they
are not the same claim:

- The operator's own service notices, scraped from <https://buslugo.com>, under the same
  terms as the timetables above.
- Three RSS feeds published by the **Concello de Lugo** about works and traffic. They are
  municipal press releases, not incidents on the network, so they never count towards the
  navigation badge.

Both are read **from the server**, never from the browser: neither sends CORS headers.
Each read is capped at 512 KB and given a deadline. On the static build there is no server
to do it, so the screen shows the snapshot a scheduled job committed, and says when it was
taken.

## The minutes behind the QR sticker — info.urbanoslugo.com

Every pole's QR opens `info.urbanoslugo.com/qr-demo-paradas/<code>`, the operator's own
page for that stop. Somebody who arrives in this app by scanning that sticker — and only
them — is shown what that page says, in a block of its own, attributed to the operator and
never called live. It is read server-side, cached for twenty seconds, and asked for at
most once a minute however many people are looking. What those minutes are is not
confirmed anywhere in writing, which is why they are quoted rather than merged with ours.

## What this project does NOT have

**There is no vehicle position feed for this network.** No GPS, no AVL, no real-time
API — public or otherwise. Every time this app shows is either a published timetable
entry or a figure computed from one, and the interface labels which is which on every
row. If a future version gains a real feed, the third label (`EN DIRECTO`) exists in
the design system for exactly that day and is deliberately unused until then.
