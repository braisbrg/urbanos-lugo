# Whose work this is built on

`LICENSE` covers the code written for this project. It does not cover the libraries the
build bundles into what a visitor downloads, the typeface, or the data — each of those
belongs to somebody else, on their own terms. This file is the code and the typeface;
`DATA.md` is the data, which is the part with the strings attached.

## Bundled into the shipped application

These end up inside the JavaScript a visitor downloads, so their notices travel with it.

| | Licence |
| :--- | :--- |
| [React](https://react.dev) and React DOM — Meta Platforms, Inc. | MIT |
| [Leaflet](https://leafletjs.com) — Volodymyr Agafonkin, CloudMade | BSD-2-Clause |
| [MapLibre GL JS](https://maplibre.org) — MapLibre contributors, Mapbox | BSD-3-Clause |
| [@maplibre/maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) | ISC |
| [Lucide](https://lucide.dev) — Lucide contributors, and Cole Bemis for the Feather icons it forked | ISC |
| [Tailwind CSS](https://tailwindcss.com) — Tailwind Labs | MIT |
| [Workbox](https://developer.chrome.com/docs/workbox), via vite-plugin-pwa — Google | MIT |

BSD-2-Clause, BSD-3-Clause and ISC each ask that the copyright notice and the licence
text be kept with redistributions of the source or the binary. A bundler strips comments,
so this table is where they are kept. Each project's full text is in its own package under
`node_modules`, and at the links above.

## Used to build it, not shipped

Vite, esbuild, TypeScript (Apache-2.0), tsx, Express (MIT, and shipped only if you
self-host `server.ts`), and the `@types/*` packages. All MIT except where noted.

## The typeface

**Atkinson Hyperlegible Next** and **Atkinson Hyperlegible Mono**, from the
[Braille Institute of America](https://www.brailleinstitute.org/freefont/), designed with
Applied Design Works. It exists because letterforms that are easy to tell apart matter
more to somebody with low vision than a designer's preference does, which is a good reason
to use it on a bus app read at arm's length in the rain.

It is loaded from Google Fonts rather than served from here — see `PRIVACY.md` for what
that means for a visitor — so this project redistributes no font files and the licence
travels with them from Google. If that ever changes, the licence text has to be shipped
alongside.

## The data, in one line each

The full account, with what each source permits, is in `DATA.md`.

- Timetables, stops and pole codes: transcribed from **buslugo.com** (AULUSA / Grupo
  Monbus). Published for public consultation; no licence stated and no agreement granted
  to this project.
- Route geometry, stop surveys and amenities: **OpenStreetMap contributors**, ODbL 1.0.
  The derived geometry is a Derivative Database and stays under ODbL.
- Map tiles: **OpenFreeMap**, serving the **OpenMapTiles** schema built from OpenStreetMap.
- Routing: the **OSRM** project's public demo server, at build time only, and
  OpenStreetMap's pedestrian router at `routing.openstreetmap.de` when a reader asks to
  see a walking path.
- Works and traffic notices: three RSS feeds published by the **Concello de Lugo**.

## And what this project is not

It is not made, reviewed, endorsed by or affiliated with **AULUSA**, **Grupo Monbus** or
the **Concello de Lugo**. It reads what the operator publishes. Where a timetable matters,
the operator's own page is the authority. The names above are used to say whose service
and whose data this describes — nothing here claims to be theirs.
