# What this app knows about you

Short version: nothing that reaches anybody. There is no account, no sign-in, no
analytics, no advertising, no cookie, and no server of ours that keeps a record of a
visit. What follows is the long version, written from the code rather than from
intention — every claim below is something you can check in the file named beside it.

This is not legal advice and the author is not a lawyer. It is an honest description of
what the software does, so that anyone who needs a legal opinion has accurate facts to
form one from.

## Kept on your device, and only there

Five things are saved in your browser's `localStorage`. They never leave it: nothing in
this project reads them and sends them anywhere.

| Key | What it holds |
| :--- | :--- |
| `urbanos_lugo_fav_stops` | the stops you starred |
| `urbanos_lugo_fav_lines` | the lines you starred |
| `urbanos-lugo-recent-stops` | the last stops you opened, as ids |
| `urbanos-lugo-lang` | Galician, Spanish or English |
| `urbanos-lugo-theme` | light, dark or automatic |

Clearing your browser's site data removes all of it. There is no copy anywhere else.

## Your location

The app asks for it in three places, and never without you pressing something:
**"stops near me"**, **"use my GPS location"** in the route planner, and the **arrival
alarm**, which watches your position while it is running so it can tell you when to get
off. Deny the permission and the app says so and carries on — it does not fall back to a
guess about where you are.

Your position is used in the browser to sort stops by distance and to draw a marker. It
is **not** sent to this project's server, because there is nothing to send it to: the
distance arithmetic is `src/utils/geo.ts`, running on your phone.

**One exception, and it is the one worth knowing about.** If you press *"see the walking
path"* on a planned trip, the two ends of each walking leg are sent to OpenStreetMap's
public pedestrian router at `routing.openstreetmap.de` so it can return the real path
along pavements. When the trip starts from your GPS position, that position is one of
those coordinates. Until you press it, the map draws a straight dashed line and nothing
is sent. See `src/services/walkingPath.ts`.

## What your browser requests from other people

Opening any web page tells the servers it contacts your IP address. This one contacts:

| Host | What for | When |
| :--- | :--- | :--- |
| `fonts.googleapis.com`, `fonts.gstatic.com` | the Atkinson Hyperlegible typeface | every visit, until cached |
| `tiles.openfreemap.org` | the map background | when you open a map |
| `tile.openstreetmap.org` | the map background, on a device with no WebGL2 | when you open a map |
| `routing.openstreetmap.de` | the real walking path | only when you ask for it |
| the API, if one is configured | service notices, and the operator's own minutes behind a QR | on the notices screen, and on a stop you reached by scanning |

The map hosts necessarily learn roughly which part of Lugo you are looking at, because
that is what a tile request is. The font host learns nothing but that you opened the
page. None of them is asked to identify you, and no identifier of ours travels with any
of these requests.

The published site has no API of its own: service notices come from a copy committed by a
scheduled job, and the app says on screen when that copy was taken. Where an API **is**
configured, it is a Cloudflare Worker (`worker/index.ts`) that reads buslugo.com and the
council's feeds on the browser's behalf, because those sites refuse a browser directly.
It is sent a stop code and nothing else — no identifier, no position.

## If you run the server yourself

`server.ts` keeps request counts per IP address **in memory** so one caller cannot exhaust
the route planner for everybody (`src/security/rateLimit.ts`). It is a `Map` that a timer
sweeps; nothing is written to disk, and restarting the process forgets it. Nothing else
about a request is recorded — there is no access log in this project.

Whoever hosts it may of course be keeping their own logs. GitHub Pages and Cloudflare
both do; that is between you and them, and their policies say what they keep.

## Children

Nothing here is directed at children and nothing asks anyone's age, because nothing asks
anyone anything.

## Changing this

The facts above are checkable and the checks are in `pnpm test`. If a future version
sends something new anywhere, this file is wrong until it is updated, and that is a bug
worth reporting like any other.
