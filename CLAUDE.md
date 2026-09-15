# CLAUDE.md

Unofficial web app for the Lugo urban bus network: 24 lines, 417 stops, timetables and
route geometry, computed in the browser and served as a static site. React 19 + Vite 8 +
Tailwind 4 + MapLibre, TypeScript throughout, pnpm, Node >= 22.

## Project map

| Path | What lives there |
| :--- | :--- |
| `src/components/` | Screens and UI. `Map/` holds every MapLibre/Leaflet surface. |
| `src/utils/` | The engine: `arrivals.ts`, `planner.ts`, `vehicles.ts`, `places.ts` (one subject each; they were one `transitEngine.ts`), `schedule.ts` (runs and service windows), `searchUtils.ts`, `geo.ts`. Pure functions, no React. |
| `src/services/` | Everything that touches the network. Shared by browser, `server.ts` and `worker/`. |
| `src/data/` | The shipped dataset. **Generated** — see the pipeline block below. |
| `src/i18n/` | `gl` / `es` / `en` dictionaries. `gl.ts` is the type source. |
| `src/hooks/`, `src/security/`, `src/seo.ts`, `src/routes.ts` | React hooks, CSP + rate limit, SEO surfaces, path constants. |
| `tools/` | Everything run from the CLI: the dataset pipeline, the test suite, the stress and reconciliation checks. Never imported by the app. |
| `data/` | Snapshots the generator reads. Outside `src/` because nothing in the app imports them. |
| `server.ts` | Express host for local dev and self-hosting. |
| `worker/index.ts` | The same two endpoints on Deno Deploy, for the static deployment. |
| `docs/`, `design/`, `DATA.md` | Diagrams, design artboards, and where every dataset comes from and under what terms. |

<important if="you need to run, build, test or regenerate anything">

**Package manager is pnpm, always.** `bun.lock` and `package-lock.json` are gitignored
leftovers; CI installs with `--frozen-lockfile` from `pnpm-lock.yaml`.

**The four gates.** `.github/workflows/ci.yml` runs exactly these on every push, and
nothing merges without them. A change is not done until all four are green:

```
pnpm run lint          # tsc --noEmit
pnpm test              # tools/test.ts — prints "N checks passed" (149 as of this writing)
pnpm run check:deep    # invariants + planner + parser sweeps over the whole dataset, ~24s
pnpm run build         # vite build + esbuild of the server bundle
```

`lint`, `test` and `build` are offline and free to re-run as often as you like.
`check:deep` is not: its third sweep, `checkParsersUnchanged.ts`, fetches two live pages
twice each. It degrades to "nothing compared, nothing claimed" when they're unreachable,
so it is safe offline — but run it once when the work is done, not on every iteration.

Everyday: `pnpm dev` (Express + Vite on `server.ts`), `pnpm start` (built server),
`pnpm preview`, `pnpm clean`, `pnpm run worker:build`.

Offline, cheap, safe to run any time: `pnpm run data:build` (reshape `data/` into
`src/data/`), `pnpm run data:audit`, `pnpm run reconcile:selftest`,
`pnpm run measure:engine`, `pnpm run measure:parsers`, `pnpm run validate:times`,
`pnpm run diagrams`. With a built server on 3002 (`pnpm build && PORT=3002 pnpm start`):
`pnpm run measure:browser` and `pnpm run audit:browser`, which `.github/workflows/measure.yml`
also runs weekly and keeps as an artifact.

Hit somebody else's server — see the network block before running any of these:
`pnpm run data:fetch`, `pnpm run data:osm`, `pnpm run data:amenities`,
`pnpm run data:alerts`, `pnpm run reconcile`, `pnpm run compare:operator`,
`pnpm run calibrate:walking`, `pnpm run fonts:import`.

Needs a listening server: `pnpm run stress:http`.

</important>

<important if="you are changing stops, lines, timetables or route geometry">

`src/data/stops.json`, `lines.json` and `route-geometry.json` are **generated output**.
Never hand-edit them. The pipeline is `tools/importOfficialData.ts` (fetch, slow, cached
under `.cache/`) then `tools/buildDataset.ts` (reshape, fast, offline), reading the
snapshots in `data/`. To change what ships, change the generator and re-run
`pnpm run data:build`.

State the resulting counts and why they are plausible — 417 stops, 24 lines, 271 poles
with a printed code. A silent change in a count is the failure this dataset has.

`DATA.md` records the provenance and licence of every file here. Route geometry is ODbL,
not MIT; keep that distinction if you move files around.

</important>

<important if="you are showing a time, an arrival or a duration to the reader">

Nobody publishes vehicle positions for this network, so **no time in this app is a
measurement**. Every one is either transcribed from the operator's timetable or derived
from it, and the interface must always say which: `precision: 'published' | 'estimated'`
in `src/types.ts`, surfaced as `HORARIO OFICIAL` / `~ ESTIMADO`.

An unlabelled time is a bug, not a simplification. The same goes for the fares in
`src/data/transitData.ts`: they are what `buslugo.com/tarifas` publishes, never inferred.

</important>

<important if="you are adding or fixing non-trivial logic">

The whole suite is one file: `tools/test.ts`, plain `assert`, no framework, run with
`pnpm test`. Each check corresponds to a bug that was real once and names it in a comment.

Leave a check behind for logic you add or fix, in that style. Never delete, relax or
comment out an existing check to get to green — if one fails, the code is what's wrong.

`pnpm run check:deep` is the other half: three sweeps over the full dataset that `pnpm
test` cannot reach. Run it before claiming a data or planner change works.

</important>

<important if="you are adding or changing user-facing text">

Three dictionaries in `src/i18n/`, and `gl.ts` is the shape the other two are typed
against — a key missing from `es.ts` or `en.ts` is a compile error, which is the point.
Add the string in all three. No user-facing text hardcoded in a component.

Place names stay as the operator publishes them; only the words around them get
translated. See `src/utils/serviceLabels.ts` for why the prose fields in the dataset are
deliberately left unread.

</important>

<important if="your change makes anything in the README untrue">

**Finish the change in the docs, in the same commit.** The README describes behaviour and
quotes measured figures, so a change that alters either leaves it lying until someone
notices. That has happened: it described a "Ver camiño a pé" button for a while after the
button was deleted, and listed an origin in the security section after the policy had
stopped allowing it.

There are three front doors and they are not three translations:

| | |
| :--- | :--- |
| `README.md` | **Galician, and the whole documentation.** Every measured figure lives here and is updated here. |
| `README.es.md`, `README.en.md` | One screen each, on purpose. Three copies of every number would be three places for a measurement to go stale. |

So the rule is asymmetric. A change to how something works, or to a figure, goes in
`README.md` **only**. A change to what the summaries actually carry — that the app is not
official, that no time in it is a measurement, the counts they quote, the links they
offer — goes in **all three**, because those are the things a reader is owed whatever
language they read in. `pnpm test` checks exactly that much and no more.

`PRIVACY.md`, `DATA.md` and `NOTICE.md` are the same kind of promise: if a change alters
what leaves the device, where a file comes from, or who is owed credit, they are wrong
until they are updated, and that is a bug like any other.

</important>

<important if="you are editing src/services/ or adding a network call">

`src/services/` is imported by three runtimes: the browser, `server.ts` (Node/Express)
and `worker/index.ts` (Deno Deploy). Use only web standards there — `fetch`, `Response`,
`ReadableStream`, `TextDecoder`. A Node-only import breaks the worker deployment, and the
worker exists precisely so the two runtimes never reimplement each other.

The app is offline-first and computes everything client-side. Only two things need a
server, both because of CORS: the operator's service notices and the live minutes behind
the pole QR. Anything else you are tempted to fetch at runtime probably belongs in the
build-time dataset instead.

</important>

<important if="you are about to run a tool that leaves this machine">

`reconcile.ts`, `checkFares.ts`, `checkOsmGeometry.ts`, `compareOperatorTimes.ts`,
`importOfficialData.ts`, `importOsmRoutes.ts`, `importStopAmenities.ts`,
`fetchAlerts.ts`, `calibrateWalking.ts` and `importFonts.ts` read `buslugo.com`, the
council's feed or the Overpass API — servers this project does not own and has no
agreement with. So does `checkParsersUnchanged.ts`, which is easy to miss because
`pnpm run check:deep` carries it: four requests every time that script runs.

They are run by hand, or on the weekly schedule in `.github/workflows/check-source.yml`,
and their answers are committed so a rebuild costs nothing. Do not put any of them in a
loop, a watch, a retry or a per-turn check — including an automated loop of your own, such
as a `/goal` condition that re-runs `check:deep` every turn. One accidental loop is
hundreds of requests against somebody else's site.

</important>

<important if="you are committing, or deciding what to track">

`.claude/`, `.antigravity/`, `.agents/`, `.impeccable/` and every other assistant
directory are gitignored on purpose: they contain verbatim session transcripts and
absolute paths with the machine's user name. This repository is public. Never track them,
and never move their contents somewhere tracked.

Build output is not committed anywhere — `dist/`, `dist-server/`, `worker/dist/`. The
committed snapshots in `data/` are the deliberate exception, because nothing can
reproduce them.

</important>
