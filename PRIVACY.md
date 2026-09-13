# What this app knows about you

Short version: nothing that reaches anybody. There is no account, no sign-in, no
analytics, no advertising, no cookie, and no server of ours that keeps a record of a
visit. What follows is the long version, written from the code rather than from
intention — every claim below is something you can check in the file named beside it.

This is not legal advice and the author is not a lawyer. It is an honest description of
what the software does, so that anyone who needs a legal opinion has accurate facts to
form one from.

## Kept on your device, and only there

Six things are saved in your browser's `localStorage`. They never leave it: nothing in
this project reads them and sends them anywhere.

| Key | What it holds |
| :--- | :--- |
| `urbanos_lugo_fav_stops` | the stops you starred |
| `urbanos_lugo_fav_lines` | the lines you starred |
| `urbanos-lugo-recent-stops` | the last stops you opened, as ids |
| `urbanos-lugo-recent-routes` | the last four trips you planned, as you typed them |
| `urbanos-lugo-lang` | Galician, Spanish or English |
| `urbanos-lugo-theme` | light, dark or automatic |

One of those is not like the others. A stop id means nothing without the dataset it
indexes into, but `urbanos-lugo-recent-routes` holds the words you typed — and if you
typed your street, your street is what it holds. It is kept so you do not have to type
the same trip twice, it is capped at four, and "Borrar" beside the list removes it. As
with everything above, nothing in this project reads it back out or sends it anywhere.

One more is kept in `sessionStorage`, which is different: it survives a reload and is
gone when the tab closes.

| Key | What it holds |
| :--- | :--- |
| `urbanos-lugo-trip` | the trip you are on, if you pressed "Vou nesta": its stops, lines and times, and which stops you have passed |

It is there so that locking your phone on the bus does not end the mode. It is written
when you start a trip, removed when you press "Saír da viaxe", and — because it is
`sessionStorage` and not `localStorage` — not left on the device afterwards as a record
of where you went and when.

Clearing your browser's site data removes all of it. There is no copy anywhere else.

## Your location

The app asks for it in four places, and never without you pressing something:
**"stops near me"**, **"use my GPS location"** in the route planner, the **arrival
alarm** on a stop's board, and **"Vou nesta"** on a planned trip, which watches your
position for the length of the ride so it can count the stops you have passed and tell
you when to get off. Deny the permission and the app says so and carries on — it does not
fall back to a guess about where you are.

The alarm and the ride are one and the same watch (`src/services/stopAlarm.ts`): one
radius, one sound, one permission prompt. The difference is how long it runs — the alarm
until you reach one stop, the ride until you say you have finished — and in both cases
it runs only while the page is open, because a web page cannot wake itself in the
background.

Your position is used in the browser to sort stops by distance and to draw a marker. It
is **not** sent to this project's server, because there is nothing to send it to: the
distance arithmetic is `src/utils/geo.ts`, running on your phone.

**There used to be an exception here, and there is not any more.** Pressing *"see the
walking path"* sent both ends of each walking leg — one of which can be your GPS position
— to OpenStreetMap's public pedestrian router at `routing.openstreetmap.de`. That is why
it was a button: it was a thing to consent to.

The app now carries the pedestrian network of Lugo itself, 21.093 junctions and 29.489
edges of real pavement built from OpenStreetMap at build time, and works the route out on
your device in under a millisecond (`src/utils/walkRouter.ts`). So the button is gone,
because there is nothing left to agree to, and the walking times you see are measured
along real streets rather than estimated from a straight line — with no connection needed
and nothing sent anywhere.

## What your browser requests from other people

Opening any web page tells the servers it contacts your IP address. This one contacts:

| Host | What for | When |
| :--- | :--- | :--- |
| `tiles.openfreemap.org` | the map background | when you open a map |
| `tile.openstreetmap.org` | the map background, on a device with no WebGL2 | when you open a map |
| the API, if one is configured | service notices, and the operator's own minutes behind a QR | on the notices screen, and on a stop you reached by scanning |

That is the whole list, and the map is the only one you meet on an ordinary visit. Those
hosts necessarily learn roughly which part of Lugo you are looking at, because that is
what a tile request is. None of them is asked to identify you, and no identifier of ours
travels with any of these requests.

**The typeface used to be on that list** — it came from Google's CDN, so every visit told
Google you had opened a bus timetable. It is served from this site now
(`tools/importFonts.ts`), which changes nothing about what you download and removes the
one third party that was giving neither the map nor the data.

The published site has no API of its own: service notices come from a copy committed by a
scheduled job, and the app says on screen when that copy was taken. Where an API **is**
configured, it is a small service on Deno Deploy (`worker/index.ts`) that reads
buslugo.com and the council's feeds on the browser's behalf, because those sites refuse a
browser directly. It is sent a stop code and nothing else — no identifier, no position.

## If you run the server yourself

`server.ts` keeps request counts per IP address **in memory** so one caller cannot exhaust
the route planner for everybody (`src/security/rateLimit.ts`). It is a `Map` that a timer
sweeps; nothing is written to disk, and restarting the process forgets it. Nothing else
about a request is recorded — there is no access log in this project.

Whoever hosts it may of course be keeping their own logs. GitHub Pages does, and so does
Deno Deploy where the API is configured; that is between you and them, and their policies
say what they keep.

## Children

Nothing here is directed at children and nothing asks anyone's age, because nothing asks
anyone anything.

## Changing this

The facts above are checkable and the checks are in `pnpm test`. If a future version
sends something new anywhere, this file is wrong until it is updated, and that is a bug
worth reporting like any other.
