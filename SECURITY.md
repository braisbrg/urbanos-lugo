# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/braisbrg/urbanos-lugo/security/advisories/new).
Please do not use a public issue for anything exploitable.

Expect a first reply within a week. This is one person's side project, not a staffed
service, and saying so is more useful than promising a turnaround nobody is on call for.

## What is worth reporting

The app is a reader for a public timetable. It has no accounts, no payments and no
personal data — the only thing it stores about anyone is a list of favourite stops and a
theme, in that browser's own `localStorage`, which never leaves the device.

So the interesting surface is small:

- **The Express server** in `server.ts`, if you self-host it. It serves the timetable
  from memory and reads three outside sources on the browser's behalf, because CORS stops
  the browser doing it: buslugo.com, three of the council's RSS feeds, and the operator's
  own stop page behind the QR stickers. Every one of those reads is capped at 512 KB and
  timed out. Anything that gets the server to read a file, run a command, hammer an
  outside host, or spend a long time on one request is worth a report.
- **The Content Security Policy** in `src/security/csp.ts`. If you can execute script in
  a published build, that is a finding regardless of how it got there.
- **The build and its dependencies.** A postinstall script that runs when it should not,
  or anything that could get code into the published artefact through the workflow in
  `.github/workflows/`.

## What is not a vulnerability here

- **Times being wrong.** Every hour is labelled with where it came from — published or
  estimated — and the estimates can be minutes out. That is documented, not a defect.
  See "Nunca mentir coas horas" in the README.
- **A stop in the wrong place.** That is a data issue and there is a form for it.
- **Rate limits being reachable.** 120 requests a minute per address is deliberate, and
  the counter is per process. `src/security/rateLimit.ts` says so in as many words.
- **buslugo.com being scraped.** It is a public timetable, fetched at most once a minute
  behind a thirty-minute cache, with an honest User-Agent. `DATA.md` covers the terms.

## Supply chain

Dependencies and GitHub Actions are updated weekly by Dependabot. `package.json` names
the only dependency allowed to run an install script; every other one is blocked. CI
installs with `--frozen-lockfile` and runs the type check and the test suite before it
will build anything.
