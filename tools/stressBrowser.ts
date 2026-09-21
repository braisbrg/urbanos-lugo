/**
 * What the app costs on the phone the README describes, rather than on this laptop.
 *
 *   pnpm build && PORT=3002 pnpm start     # in another terminal
 *   pnpm measure:browser                   # everything
 *   pnpm measure:browser start             # one round: start | map | typing | session
 *
 * A real Chromium throttled to a cheap handset on bad coverage, reporting what the main
 * thread was doing. The numbers are machine-relative; the comparison is not, so every
 * round prints what it compares against, and the budgets are set from measured runs.
 */
import { BASE, blockingMs, ONLINE, phonePage, profile, PROBE_SOURCE, report, withBrowser, type Browser, type Probe, type Session } from './cdp';
import { median, percentile, sleep } from './lib';

/** Chrome's own "low-end mobile" multiplier: a 2017 phone, the floor we support. */
const CPU_THROTTLE = Number(process.env.CPU_THROTTLE ?? 6);
/** Chrome's "Slow 4G": what a marquesina actually gives you. */
const SLOW_4G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const SETTLE_MS = Number(process.env.SETTLE ?? 4000);

let failures = 0;
const budget = (label: string, value: number, max: number, unit = 'ms'): void => {
  const over = value > max;
  if (over) failures++;
  report(label, `${value.toFixed(0)} ${unit}`, over ? `<-- over ${max} ${unit}` : `(budget ${max} ${unit})`);
};

/** A page throttled to the phone, with the probe already installed. */
async function throttled(browser: Browser, opts: { network?: boolean } = {}, ...extra: string[]): Promise<Session> {
  const page = await phonePage(browser, PROBE_SOURCE, ...extra);
  await page.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  if (opts.network !== false) await page.send('Network.emulateNetworkConditions', SLOW_4G);
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  return page;
}

const probeOf = (page: Session): Promise<Probe> => page.evaluate<Probe>('window.__probe');
const reset = (page: Session) => page.evaluate('window.__probeReset()');
const longest = (probe: Probe) => `${Math.max(0, ...probe.longtasks.map(([, d]) => d)).toFixed(0)} ms`;
const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;
const top = (title: string, rows: { label: string; ms: number }[], n: number) => {
  console.log(`\n  ${title}`);
  for (const { label, ms } of rows.slice(0, n)) console.log(`    ${ms.toFixed(0).padStart(6)} ms  ${label}`);
};

const domCounts = (page: Session): Promise<{ nodes: number; canvases: number; maps: number }> =>
  page.evaluate(`({ nodes: document.getElementsByTagName('*').length, canvases: document.querySelectorAll('canvas').length, maps: document.querySelectorAll('.leaflet-container').length })`);

/** Heap (collected first), DOM nodes, canvases and map containers, for a before/after. */
const footprint = async (page: Session) => ({ heap: await page.heapBytes(), ...(await domCounts(page)) });

/**
 * What stops.json and lines.json cost to become objects, timed in the page. The bundler
 * folds them into the entry chunk as `JSON.parse("...")` literals, so the honest price is
 * to pull the shipped chunk down, lift those literals out, and parse exactly that.
 */
const bundledJsonParseMs = (page: Session): Promise<number> =>
  page.evaluate<number>(`(async () => {
    const entry = document.querySelector('script[type=module]');
    if (!entry) return -1;
    const src = await fetch(entry.src).then((r) => r.text());
    const needle = 'JSON.parse(\\u0060';
    let total = 0;
    for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
      let out = '';
      for (let j = i + needle.length; j < src.length; j++) {
        const c = src[j];
        if (c === '\\\\') { out += src[j + 1]; j++; continue; }
        if (c === '\\u0060') break;
        out += c;
      }
      if (out.length < 20000) continue;
      try { JSON.parse(out); } catch { continue; }
      const started = performance.now();
      for (let k = 0; k < 5; k++) JSON.parse(out);
      total += (performance.now() - started) / 5;
    }
    return total;
  })()`);

/** Every response the browser asked for, and whether it happened before the first paint. */
async function coldStart(browser: Browser): Promise<void> {
  console.log(`\ncold start -- ${CPU_THROTTLE}x CPU, Slow 4G, no cache, 390x844`);

  const page = await throttled(browser);
  const requests: { url: string; size: number; start: number; end: number; type: string }[] = [];
  const started = new Map<string, { url: string; start: number; type: string }>();
  page.on('Network.requestWillBeSent', (p) => {
    started.set(p.requestId as string, { url: String((p.request as { url: string }).url), start: (p.timestamp as number) * 1000, type: String(p.type ?? '?') });
  });
  page.on('Network.loadingFinished', (p) => {
    const open = started.get(p.requestId as string);
    if (open) requests.push({ ...open, size: (p.encodedDataLength as number) ?? 0, end: (p.timestamp as number) * 1000 });
  });

  // The service worker precaches the whole app on the first visit, which would make the
  // second run of this a cache and not a cold start.
  await page
    .evaluate<boolean>(`navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(ks => Promise.all(ks.map(k => caches.delete(k)))).then(() => true)`)
    .catch(() => false);

  await page.goto(BASE);
  await sleep(6000); // the service worker registers on load; lazy chunks follow

  const probe = await probeOf(page);
  const first = requests.length ? Math.min(...requests.map((r) => r.start)) : 0;
  const at = (t: number) => Math.round(t - first);
  const fcp = probe.paint['first-contentful-paint'] ?? 0;
  const bytes = (list: typeof requests) => list.reduce((t, r) => t + r.size, 0);
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

  budget('first contentful paint', fcp, 4000);
  budget('largest contentful paint', probe.paint['lcp'] ?? 0, 5000);
  budget('main thread blocked (tasks over 50 ms)', blockingMs(probe), 1500);
  report('longest single task', longest(probe), `${probe.longtasks.length} long tasks`);

  const beforePaint = requests.filter((r) => at(r.end) <= fcp);
  report('bytes over the wire, all of them', kb(bytes(requests)), `${requests.length} requests`);
  report('bytes that arrived before first paint', kb(bytes(beforePaint)), `${beforePaint.length} requests`);

  console.log('\n  the whole waterfall, in the order the browser asked');
  for (const r of [...requests].sort((a, b) => a.start - b.start)) {
    const name = (r.url.split('/').pop()?.split('?')[0] || r.url).slice(0, 38);
    console.log(
      `    ${name.padEnd(40)} ${(r.size / 1024).toFixed(1).padStart(7)} KB  ${String(at(r.start)).padStart(5)} -> ${String(at(r.end)).padStart(5)} ms  ${r.type.padEnd(10)} ${at(r.end) <= fcp ? 'before paint' : ''}`,
    );
  }

  // A gap between the finished document and the request for the entry chunk is a parser
  // stopped at a blocking script: one round trip, half a second on this connection. The
  // preload links vite.config.ts puts at the top of <head> keep it near zero.
  const doc = requests.find((r) => r.type === 'Document');
  const entry = requests.find((r) => /\/assets\/index-[^/]+\.js$/.test(r.url));
  if (doc && entry) budget('waited after the document to ask for the entry', at(entry.start) - at(doc.end), 200);

  console.log('\n  the long tasks, in order');
  for (const [when, duration] of probe.longtasks) console.log(`    ${String(when).padStart(6)} ms  for ${String(duration).padStart(5)} ms`);

  // Nothing on the stops tab is a map until the reader asks for one, so map code arriving
  // means something mounted a map that cannot be seen.
  const mapBytes = bytes(requests.filter((r) => /palette-|maplibre|route-geometry|NearbyMiniMap|useMapChrome/.test(r.url)));
  console.log('');
  budget('map code pulled by the home screen', mapBytes / 1024, 1, 'KB');
  if (requests.some((r) => /openfreemap|ofm\.json|tiles\./.test(r.url))) {
    failures++;
    report('off-origin tile style fetched', 'yes', '<-- for a map nobody opened');
  }

  report('JSON.parse of the bundled datasets', `${(await bundledJsonParseMs(page)).toFixed(1)} ms`, `main thread, ${CPU_THROTTLE}x`);

  const screen = await page.evaluate<{ path: string; headings: string[]; maps: number; canvases: number }>(
    `({ path: location.pathname, headings: [...document.querySelectorAll('h1,h2')].map((e) => e.textContent.trim()).slice(0, 8), maps: document.querySelectorAll('.leaflet-container').length, canvases: document.querySelectorAll('canvas').length })`,
  );
  console.log(`\n  what was on screen: ${screen.path}  ${screen.maps} map(s), ${screen.canvases} canvas`);
  for (const h of screen.headings) console.log(`    ${h}`);

  await page.close();
}

/** Click one of the bottom-nav destinations by its visible label. */
const tapNav = (page: Session, label: string): Promise<boolean> =>
  page.call<boolean>(`(label) => { const b = [...document.querySelectorAll('nav a, nav button')].find((e) => e.textContent.trim() === label); if (!b) return false; b.click(); return true; }`, label);

const MAP_READY = `document.querySelector('.leaflet-container canvas, .leaflet-container img.leaflet-tile')`;

/**
 * What opening the map costs, and what closing and reopening it leaves behind. The first
 * half measures the tap; the second taps twelve times, because a cost paid once is a cost
 * and a cost paid every time is a leak.
 */
async function mapTab(browser: Browser): Promise<void> {
  console.log(`\nthe map tab -- ${CPU_THROTTLE}x CPU, Slow 4G for the open, then unthrottled for the cycling`);

  const page = await throttled(browser);
  await page.goto(BASE);
  await page.waitFor(`document.querySelector('nav')`);
  await sleep(1500);

  await reset(page);
  const openedAt = Date.now();
  let drawn = 0;
  const opening = await profile(page, async () => {
    if (!(await tapNav(page, 'Mapa'))) throw new Error('could not find the Mapa tab');
    await page.waitFor(MAP_READY, 60_000);
    drawn = Date.now() - openedAt;
    await sleep(4000); // tiles keep arriving after the first canvas
  });

  let probe = await probeOf(page);
  budget('tap to first drawn map', drawn, 6000);
  // The vector basemap parses its style and paints its first frame on this thread, and
  // under SwiftShader the paint is CPU too: set above the measured spread (MapLibre 6.9).
  budget('main thread blocked while opening', blockingMs(probe), 2500);
  report('longest single task while opening', longest(probe), `${probe.longtasks.length} long tasks`);
  report('worst gap between frames', `${probe.worstFrame.toFixed(0)} ms`, 'the freeze a finger feels');
  budget('ResizeObserver callbacks while opening', probe.resizes, 12, 'calls');
  top('where the opening went, self time, top 12', opening, 12);

  // Zooming rebuilds the stop layer, so it is the recurring cost rather than the one-off.
  await page.send('Network.emulateNetworkConditions', ONLINE);
  await sleep(500);
  await reset(page);
  const zooming = await profile(page, async () => {
    for (let i = 0; i < 4; i++) {
      await page.evaluate(`document.querySelector('.leaflet-control-zoom-in')?.click()`);
      await sleep(900);
    }
  });
  probe = await probeOf(page);
  // Above the measured spread, a guard against the next regression rather than a target.
  budget('main thread blocked over four zoom steps', blockingMs(probe), 900);
  report('worst frame during zooming', `${probe.worstFrame.toFixed(0)} ms`, `${probe.longtasks.length} long tasks`);
  budget('ResizeObserver callbacks over four zooms', probe.resizes, 8, 'calls');
  top('where the zooming went, self time, top 12', zooming, 12);

  // Twelve laps between Paradas and Mapa. The map stays mounted behind `hidden` once
  // opened, so this measures show/hide, which is what would quietly accumulate.
  const before = await footprint(page);
  const start = await probeOf(page);
  for (let lap = 0; lap < 12; lap++) {
    await tapNav(page, 'Paradas');
    await sleep(400);
    await tapNav(page, 'Mapa');
    await sleep(600);
  }
  await sleep(2000);
  const after = await footprint(page);
  probe = await probeOf(page);

  console.log('\n  twelve laps in and out of the map');
  report('heap held after collection', mb(after.heap - before.heap), `${mb(before.heap)} -> ${mb(after.heap)}`);
  report('canvases', `${after.canvases - before.canvases}`, `${before.canvases} -> ${after.canvases}`);
  report('map containers', `${after.maps - before.maps}`, `${before.maps} -> ${after.maps}`);
  report('DOM nodes', `${after.nodes - before.nodes}`, `${before.nodes} -> ${after.nodes}`);
  budget('net listeners left on window/document', probe.listeners - start.listeners, 4, 'listeners');
  const grew = Object.entries(probe.listenerKinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (grew.length) {
    console.log('    what was added and never taken off:');
    for (const [kind, n] of grew) console.log(`      ${String(n).padStart(4)}  ${kind}`);
  }
  budget('net intervals left running', probe.intervals - start.intervals, 2, 'timers');
  budget('heap held after twelve laps', (after.heap - before.heap) / 1048576, 3, 'MB');

  await page.close();
}

/** One real keystroke: the browser's own event path, not `.value = x`. */
async function typeChar(page: Session, char: string): Promise<void> {
  const common = { text: char, key: char, windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0) };
  for (const type of ['keyDown', 'char', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, ...common });
}

const FOCUS_SEARCH = `(() => { const i = document.querySelector('input[type=search], header input, input'); if (!i) return false; i.focus(); return document.activeElement === i; })()`;

/** A page with the search box focused, after the idle work the app schedules on mount has run. */
async function searchReady(browser: Browser): Promise<Session | null> {
  const page = await throttled(browser, { network: false });
  await page.goto(BASE);
  await page.waitFor(`document.querySelector('input')`);
  await sleep(SETTLE_MS);
  return (await page.evaluate<boolean>(FOCUS_SEARCH)) ? page : null;
}

/**
 * The very first letter, on a page never typed into, five times over: the only keystroke
 * that finds every cache cold, and one sample of it swings by hundreds of milliseconds.
 * A fresh page each time and the median is what makes a before-and-after mean something.
 */
async function firstKeystroke(browser: Browser, samples = 5): Promise<{ paint: number[]; blocked: number[] }> {
  const paint: number[] = [];
  const blocked: number[] = [];
  for (let i = 0; i < samples; i++) {
    const page = await searchReady(browser);
    if (!page) break;
    await reset(page);
    await typeChar(page, 'R');
    await sleep(1200);
    const probe = await probeOf(page);
    const down = probe.events.find(([name]) => name === 'keydown');
    if (down) paint.push(down[2]);
    blocked.push(blockingMs(probe));
    await page.close();
  }
  return { paint, blocked };
}

/**
 * How late the letter arrives. The Event Timing API measures from the hardware event to
 * the frame that showed its result, which is the number a person feels.
 */
async function typing(browser: Browser): Promise<void> {
  console.log(`\ntyping in the search box -- ${CPU_THROTTLE}x CPU`);

  const cold = await firstKeystroke(browser);
  report('first letter, press to paint', `${median(cold.paint)} ms`, `median of ${cold.paint.length}: ${cold.paint.join(', ')}`);
  budget('first letter, main thread blocked', median(cold.blocked), 250);

  const page = await searchReady(browser);
  if (!page) return console.log('  no search input found on the opening screen.');

  // A real street somebody would look for, typed a letter at a time at a human rate.
  const query = 'Ronda da Muralla';
  const typeIt = async () => {
    for (const char of query) {
      await typeChar(page, char);
      await sleep(120);
    }
    await sleep(900);
  };

  // Timed with nothing attached: the sampler costs enough to show, so it gets its own pass.
  await reset(page);
  await typeIt();
  const probe = await probeOf(page);
  const keyEvents = probe.events.filter(([name]) => /^(keydown|keypress|keyup|input)$/.test(name));
  const delays = keyEvents.map(([, delay]) => delay);
  const durations = keyEvents.map(([, , duration]) => duration);
  const first = keyEvents.length ? keyEvents[0][3] : 0;

  report('key events measured', `${keyEvents.length}`, `${query.length} characters, events over 16 ms`);
  report('input delay, median / worst', `${median(delays)} / ${percentile(delays, 100)} ms`, 'press to handler');
  report('event to painted frame, median / p95', `${median(durations)} / ${percentile(durations, 95)} ms`);
  budget('event to painted frame, worst', percentile(durations, 100), 600);
  console.log('\n  the five slowest key events, and when in the word they landed');
  for (const [name, delay, duration, when] of [...keyEvents].sort((a, b) => b[2] - a[2]).slice(0, 5)) {
    console.log(`    ${name.padEnd(10)} ${String(duration).padStart(5)} ms to paint, ${String(delay).padStart(4)} ms delay, at ${String(when - first).padStart(5)} ms into the typing`);
  }
  console.log('');
  budget('main thread blocked while typing', blockingMs(probe), 400);
  report('worst gap between frames', `${probe.worstFrame.toFixed(0)} ms`, `${probe.longtasks.length} long tasks`);
  // Up to three a keystroke: the field, the deferred rows behind it, and a deferred render
  // interrupted by the next key and finished later.
  budget('React commits for the whole word', probe.commits, 3 * query.length + 4, 'commits');

  // Second pass, sampler on, only to say where the time goes.
  await page.evaluate(`(() => { const i = document.querySelector('input[type=search], header input, input'); if (i) { i.focus(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(600);
  const hot = await profile(page, typeIt);
  top('where the typing went, self time, top 10 (sampler attached, so slower)', hot.filter((h) => !/\(idle\)|\(program\)/.test(h.label)), 10);

  await page.close();
}

/**
 * How much faster than real time the session runs. What makes a long session is the tick
 * count, not the wall clock, so intervals of five seconds or more are divided down; the
 * shorter ones are animations and debounces, and speeding them up would measure something
 * the app never does.
 */
const COMPRESS = Number(process.env.COMPRESS ?? 30);
const SPEED_UP_LONG_TIMERS = `
(() => {
  const original = window.setInterval;
  window.setInterval = function (fn, delay, ...rest) {
    const scaled = typeof delay === 'number' && delay >= 5000 ? Math.max(60, delay / ${COMPRESS}) : delay;
    return original.call(window, fn, scaled, ...rest);
  };
})();
`;

/**
 * A board left open: the board recomputes every 15 s and the operator's minutes are asked
 * for every 30 s, and the question is whether two hundred of them leave anything behind.
 * The operator's site is not in this: pointing a compressed hour of polling at somebody
 * else's service would be rude and would measure their caching, so `/agora` is answered
 * here with a fixed body. What is exercised is the client.
 */
async function longSession(browser: Browser): Promise<void> {
  const minutes = Number(process.env.MINUTES ?? 30);
  const seconds = Math.round((minutes * 60) / COMPRESS);
  console.log(`\na stop board left open for ${minutes} minutes -- ${COMPRESS}x compressed, so ${seconds} s of clock`);

  const page = await throttled(browser, { network: false }, SPEED_UP_LONG_TIMERS);
  let served = 0;
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  page.on('Fetch.requestPaused', (event) => {
    served++;
    const url = String(event.request ? (event.request as { url: string }).url : '');
    const body = /agora/.test(url) ? JSON.stringify({ code: 'uilP', departures: [{ line: '1', towards: 'HULA', minutes: served % 20 }], fetchedAt: new Date().toISOString() }) : '[]';
    void page.send('Fetch.fulfillRequest', {
      requestId: event.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(body, 'utf8').toString('base64'),
    });
  });

  await page.goto(`${BASE}/paradas?parada=uilP`);
  await page.waitFor(`document.querySelector('nav')`);
  await sleep(3000);

  const before = await footprint(page);
  const start = await probeOf(page);
  await reset(page);
  await sleep(seconds * 1000);
  const after = await footprint(page);
  const probe = await probeOf(page);

  const screen = await page.evaluate<{ heading: string; intervals: number }>(`({ heading: (document.querySelector('h2, h1') || {}).textContent || '', intervals: window.__probe.intervals })`);
  report('what was on screen', screen.heading.slice(0, 34), `${screen.intervals} intervals live`);
  report('endpoint answers served', `${served}`, `${(served / minutes).toFixed(1)} a minute`);
  report('DOM nodes', `${after.nodes - before.nodes}`, `${before.nodes} -> ${after.nodes}`);
  budget('heap held after the session', (after.heap - before.heap) / 1048576, 3, 'MB');
  report('heap, before and after', mb(after.heap - before.heap), `${mb(before.heap)} -> ${mb(after.heap)}`);
  budget('net listeners left on window/document', probe.listeners - start.listeners, 4, 'listeners');
  budget('net intervals left running', probe.intervals - start.intervals, 2, 'timers');
  budget('main thread blocked over the session', blockingMs(probe), 2000);
  report('longest single task', longest(probe), `${probe.longtasks.length} long tasks`);
  report('worst gap between frames', `${probe.worstFrame.toFixed(0)} ms`);

  await page.send('Fetch.disable').catch(() => undefined);
  await page.close();
}

const rounds: Record<string, (b: Browser) => Promise<void>> = { start: coldStart, map: mapTab, typing, session: longSession };
const chosen = process.argv[2] ? [process.argv[2]] : Object.keys(rounds);
const unknown = chosen.find((name) => !rounds[name]);
if (unknown) {
  console.log(`\nNo round called "${unknown}". Try: ${Object.keys(rounds).join(', ')}\n`);
} else {
  await withBrowser(async (browser) => {
    for (const name of chosen) await rounds[name](browser);
  });
  console.log('');
  if (failures) {
    console.log(`${failures} measurement(s) over budget.\n`);
    process.exitCode = 1;
  }
}
