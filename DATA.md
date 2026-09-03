# Where the data comes from, and under what terms

This is an unofficial project. It is not made, reviewed or endorsed by AULUSA, Grupo
Monbus or the Concello de Lugo; it reads what the operator publishes. Where a timetable
matters, the operator's own page is the authority.

The MIT licence in `LICENSE` covers the source code. The datasets are not the authors'
to relicense, and each has its own provenance. They sit in two places: `src/data/` is
what ships to the browser, and `data/` holds the snapshots the generator reads. The split
is about what reaches the bundle, not about terms — everything below applies to both.

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

## Route geometry — OpenStreetMap

Every drawn itinerary follows an OSM route relation, or the OSRM driving profile
where no surveyed relation exists.

- **Licence:** Open Database License (ODbL) 1.0 — <https://opendatacommons.org/licenses/odbl/>
- **Attribution:** "© OpenStreetMap contributors", shown on the map and in the menu.
- **Consequence:** the derived geometry is a Derivative Database under ODbL and stays
  under ODbL. It is not covered by the MIT licence. That is `src/data/route-geometry.json`,
  which ships, and the snapshots it is built from: `data/osm-routes.json`,
  `data/routes.json` and `data/stop-amenities.json`.

## Map tiles — OpenFreeMap

Basemap tiles come from **OpenFreeMap**, which serves the OpenMapTiles schema built from
OpenStreetMap data. No key, no account, no quota. The map credits OpenFreeMap,
OpenMapTiles and OpenStreetMap contributors in its own corner, and the tiles are fetched
as the reader pans rather than redistributed here.

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
- **`routing.openstreetmap.de/routed-foot`** draws the real pedestrian path for a walking
  leg. This one *is* called from the reader's browser, because the endpoints are wherever
  they asked to go and nothing can precompute that. It is **opt-in**: the map draws a
  straight dashed line until the reader presses "see the walking path", and answers are
  kept for the session. Both serve OSM-derived data under ODbL, and both are free services
  with usage policies of their own — check them before pointing anything heavier at them.

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
