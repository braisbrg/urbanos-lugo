# Urbanos de Lugo

### 👉 [**braisbrg.github.io/urbanos-lugo**](https://braisbrg.github.io/urbanos-lugo/)

**When your bus comes in Lugo.** Every line, every stop and when it passes, on a light
site that works with no signal.

> **This is not the official app.** It is not made, reviewed or endorsed by AULUSA, Grupo
> Monbus or the Concello de Lugo. It reads the timetables the operator publishes at
> <https://buslugo.com>. Where a timetable matters, the official source wins.

> [Castellano](README.es.md) · [Galego — full document](README.md)
>
> This page is a summary. The whole documentation — how the dataset is built, how the
> times are computed, what each test checks and why — is in the Galician README, and it
> is kept there so there are never three versions of the same figure.

---

## What it is for

- **You reach a stop and want to know how long you have to wait.** Scan the code on the pole, or search
  the stop by name, and you get the list of what is coming.
- **You do not know which bus to take.** Type where you are and where you are going — a
  street, a square, the hospital — and it gives you the whole trip.
- **You want to see where they run.** The map shows all 24 lines along their real street
  routes, and all 417 stops.
- **You are getting off somewhere you do not know.** Set an alarm and the phone tells you
  when you are close.
- **You are on the bus and do not want to miss your stop.** Tap **"Vou nesta"** on the trip
  and the screen counts the stops left against your GPS, gives the minutes from the
  timetable, and warns you before you get off — at the transfer too.
- **You have no data.** Once open it works offline. The timetables are inside it.

## What this app cannot do

**It does not know where the bus is.** Nobody publishes that: this network does not
broadcast vehicle positions. So **no time on this site is a measurement**; it is either
what the operator prints in its timetable, or something computed from it. And every time
on screen says which of the two it is:

| | |
| :--- | :--- |
| `HORARIO OFICIAL` — `SCHEDULED` in the English interface | The operator publishes that time for that stop. |
| `~ ESTIMADO` — `~ ESTIMATED` | Published departure from the terminus, plus road running time. |

## Privacy

No account, no sign-in, no analytics, no advertising, no cookies, and no server of ours
that keeps a record of a visit. **Your location is sent to nobody** — not even to draw
the walking route, because the pedestrian network of Lugo ships inside the app and the
route is computed on your own device. The only thing that leaves the phone is the request
for the map tiles, and PRIVACY.md says to whom.

The full detail, written from the code rather than from intention, is in
[PRIVACY.md](PRIVACY.md).

## Running it

```bash
pnpm install
pnpm dev      # Express + Vite
pnpm test     # the whole suite, one file, no framework
```

Node 22 or newer, and **pnpm always**: CI installs with `--frozen-lockfile` from
`pnpm-lock.yaml`.

## Data, licences and credits

- [DATA.md](DATA.md) — where every file comes from and under what terms.
- [NOTICE.md](NOTICE.md) — who has to be credited.
- [SECURITY.md](SECURITY.md) — how to report a security problem.

The code is MIT. Geometry derived from OpenStreetMap is ODbL, which is not the same
thing, and DATA.md says which is which.
