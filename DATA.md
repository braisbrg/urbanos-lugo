# Where the data comes from, and under what terms

This is an unofficial project. It is not made, reviewed or endorsed by AULUSA, Grupo
Monbus or the Concello de Lugo; it reads what the operator publishes. Where a timetable
matters, the operator's own page is the authority.

The MIT licence in `LICENSE` covers the source code. The datasets under `src/data/`
are not the authors' to relicense, and each has its own provenance.

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
- **Consequence:** the derived geometry in `src/data/routeGeometry.*` is a Derivative
  Database under ODbL and stays under ODbL. It is not covered by the MIT licence.

## Map tiles — CARTO

Basemap tiles are served by CARTO from OpenStreetMap data, attributed in the map
corner as their terms require. They are fetched at runtime and not redistributed here.

## What this project does NOT have

**There is no vehicle position feed for this network.** No GPS, no AVL, no real-time
API — public or otherwise. Every time this app shows is either a published timetable
entry or a figure computed from one, and the interface labels which is which on every
row. If a future version gains a real feed, the third label (`EN DIRECTO`) exists in
the design system for exactly that day and is deliberately unused until then.
