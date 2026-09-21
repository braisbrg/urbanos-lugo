/**
 * What the app costs on the phone the README describes, rather than on this laptop.
 *
 *   pnpm build && PORT=3002 pnpm start     # in another terminal
 *   pnpm measure:browser                   # everything
 *   pnpm measure:browser start             # one round: start | second | map | typing | session
 *
 * The other stress tools call the app's functions under Node. Useful, and blind to the
 * half of the cost that only exists in a browser: the bundle being parsed, a map being
 * built, a keystroke waiting behind a render. This drives a real Chromium throttled to
 * a cheap handset on bad coverage and reports what the main thread was doing.
 *
 * Numbers here are machine-relative -- a faster laptop makes all of them smaller. What
 * is not machine-relative is the comparison, so every round prints what it is comparing
 * against, and the budgets below are set from measured runs, not from taste.
 */
import { blockingMs, findChromium, launch, profile, PROBE_SOURCE, report, sleep, type Browser, type Probe, type Session } from './cdp';

const BASE = process.env.BASE ?? 'http://localhost:3002';

/** Chrome's own "low-end mobile" multiplier. A 2017 phone, which is the floor we support. */
const CPU_THROTTLE = Number(process.env.CPU_THROTTLE ?? 6);

/** Chrome's "Slow 4G": what a marquesina in Lugo actually gives you. */
const SLOW_4G = {
  offline: false,
  latency: 562.5,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

let failures = 0;
const budget = (label: string, value: number, max: number, unit = 'ms'): void => {
  const over = value > max;
  if (over) failures++;
  // A budget under 1 is a score, not a count of milliseconds, and wants its decimals.
  const shown = max < 1 ? value.toFixed(3) : value.toFixed(0);
  report(label, `${shown} ${unit}`.trim(), over ? `<-- over ${max} ${unit}`.trim() : `(budget ${max} ${unit})`.replace(/ \)$/, ')'));
};

/** A page throttled to the phone, with the probe already installed. */
async function phonePage(browser: Browser, opts: { cpu?: number; network?: boolean } = {}): Promise<Session> {
  const page = await browser.newPage();
  await page.onNewDocument(PROBE_SOURCE);
  // The tabs are found by their Galician labels below, so the app is told to speak it,
  // whatever the browser's own language: on a runner Chrome speaks English, the tab was
  // "Map", and the map round stopped before it started.
  await page.onNewDocument("try { localStorage.setItem('urbanos-lugo-lang', 'gl'); } catch (e) {}");
  await page.send('Emulation.setDeviceMetricsOverride', PHONE);
  await page.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu ?? CPU_THROTTLE });
  if (opts.network !== false) await page.send('Network.emulateNetworkConditions', SLOW_4G);
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  return page;
}

const probeOf = (page: Session): Promise<Probe> => page.evaluate<Probe>('window.__probe');

/**
 * What stops.json and lines.json cost to become objects, timed in the page.
 *
 * They do not arrive as .json files -- the bundler folds them into the entry chunk as
 * `JSON.parse("...")` of a string literal, which is the fast shape already. So the honest
 * way to price them is to pull the shipped chunk back down, lift those literals out of it,
 * and parse exactly what the app parses.
 */
async function bundledJsonParseMs(page: Session): Promise<number> {
  return page.evaluate<number>(`(async () => {
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
}

// --------------------------------------------------------------------------------------
// Round 1: the cold start
// --------------------------------------------------------------------------------------

/**
 * Every response the browser asked for, in order, with what it cost.
 *
 * The interesting column is not the size, it is whether a request happened at all before
 * the first stop time was on screen. A chunk that is only needed by a tab nobody has
 * opened is bytes a phone on Slow 4G paid for and cannot use.
 */
async function coldStart(browser: Browser): Promise<void> {
  console.log(`\ncold start -- ${CPU_THROTTLE}x CPU, Slow 4G, no cache, 390x844`);

  const page = await phonePage(browser);
  const requests: { url: string; size: number; start: number; end: number; type: string }[] = [];
  const started = new Map<string, { url: string; start: number; type: string }>();
  page.on('Network.requestWillBeSent', (p) => {
    started.set(p.requestId as string, {
      url: String((p.request as { url: string }).url),
      start: (p.timestamp as number) * 1000,
      type: String(p.type ?? '?'),
    });
  });
  page.on('Network.loadingFinished', (p) => {
    const open = started.get(p.requestId as string);
    if (!open) return;
    requests.push({ ...open, size: (p.encodedDataLength as number) ?? 0, end: (p.timestamp as number) * 1000 });
  });

  // The service worker precaches the whole app on the first visit, which would make the
  // second run of this measure a cache and not a cold start.
  await page.evaluate<boolean>(
    `navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).then(() => caches.keys()).then(ks => Promise.all(ks.map(k => caches.delete(k)))).then(() => true)`,
  ).catch(() => false);

  await page.goto(BASE);
  // Let the deferred work land: the service worker registers on load, and anything the
  // first screen lazy-loads asks for its chunk right after.
  await sleep(6000);

  const probe = await probeOf(page);
  const first = requests.length ? Math.min(...requests.map((r) => r.start)) : 0;
  const at = (t: number) => Math.round(t - first);

  const fcp = probe.paint['first-contentful-paint'] ?? 0;
  const lcp = probe.paint['lcp'] ?? 0;
  const worst = Math.max(0, ...probe.longtasks.map(([, d]) => d));

  budget('first contentful paint', fcp, 4000);
  budget('largest contentful paint', lcp, 5000);
  budget('main thread blocked (tasks over 50 ms)', blockingMs(probe), 1500);
  report('longest single task', `${worst.toFixed(0)} ms`, `${probe.longtasks.length} long tasks`);
  // Google's "good" threshold. The number that catches a board jumping when its times
  // land, or a banner pushing the list down after the reader has started reading it.
  budget('cumulative layout shift', Math.round(probe.cls * 1000) / 1000, 0.1, '');
  for (const [when, score, what] of probe.shifts.slice(0, 5)) {
    report('  shifted', `${score.toFixed(3)}`, `at ${when} ms: ${what}`);
  }

  // Budgets on the bytes, not just a printout: a dependency bump that adds 60 KB to the
  // entry chunk would otherwise be a bigger number in a log nobody reads. Set from the
  // measured 186 / 192 KB with a third of headroom, and the README's table quotes them.
  const bytes = (list: typeof requests) => list.reduce((t, r) => t + r.size, 0);
  const beforePaint = requests.filter((r) => at(r.end) <= fcp);
  budget('bytes over the wire, all of them', Math.round(bytes(requests) / 1024), 260, 'KB');
  report('  requests', `${requests.length}`, '');
  budget('bytes that arrived before first paint', Math.round(bytes(beforePaint) / 1024), 250, 'KB');
  report('  requests before paint', `${beforePaint.length}`, '');

  console.log('\n  the whole waterfall, in the order the browser asked');
  for (const r of [...requests].sort((a, b) => a.start - b.start)) {
    const name = (r.url.split('/').pop()?.split('?')[0] || r.url).slice(0, 38);
    console.log(
      `    ${name.padEnd(40)} ${(r.size / 1024).toFixed(1).padStart(7)} KB  ` +
        `${String(at(r.start)).padStart(5)} -> ${String(at(r.end)).padStart(5)} ms  ` +
        `${r.type.padEnd(10)} ${at(r.end) <= fcp ? 'before paint' : ''}`,
    );
  }

  // How long the browser sat on a finished document before asking for the code that
  // fills it. Everything the first paint needs is named in <head>, so the only reason
  // for a gap is that the parser stopped at a blocking script before reaching them --
  // which is one round trip on a connection where a round trip is half a second. The
  // preload links vite.config.ts puts at the top of <head> are what keeps this near zero.
  const doc = requests.find((r) => r.type === 'Document');
  const entry = requests.find((r) => /\/assets\/index-[^/]+\.js$/.test(r.url));
  if (doc && entry) {
    budget('waited after the document to ask for the entry', at(entry.start) - at(doc.end), 200);
  }

  console.log('\n  the long tasks, in order');
  for (const [when, duration] of probe.longtasks) {
    console.log(`    ${String(when).padStart(6)} ms  for ${String(duration).padStart(5)} ms`);
  }

  // The map libraries are the biggest thing the build produces. Whether the home screen
  // pulls them is the single largest question a cold start can answer.
  const mapBytes = bytes(requests.filter((r) => /palette-|maplibre|route-geometry|NearbyMiniMap|useMapChrome/.test(r.url)));
  const styleFetched = requests.some((r) => /openfreemap|ofm\.json|tiles\./.test(r.url));
  console.log('');
  // Nothing on the stops tab is a map until the reader asks for one, so any of this
  // arriving means something mounted a map that cannot be seen. It was 255 KB and four
  // long tasks before src/components/Map/LazyNearbyMiniMap.tsx existed.
  budget('map code pulled by the home screen', mapBytes / 1024, 1, 'KB');
  if (styleFetched) {
    failures++;
    report('off-origin tile style fetched', 'yes', '<-- for a map nobody opened');
  }

  report('JSON.parse of the bundled datasets', `${(await bundledJsonParseMs(page)).toFixed(1)} ms`, `main thread, ${CPU_THROTTLE}x`);

  const screen = await page.evaluate<{ path: string; headings: string[]; maps: number; canvases: number }>(
    `({ path: location.pathname, headings: [...document.querySelectorAll('h1,h2')].map((e) => e.textContent.trim()).slice(0, 8), maps: document.querySelectorAll('.leaflet-container').length, canvases: document.querySelectorAll('canvas').length })`,
  );
  console.log(`\n  what was on screen: ${screen.path}  ${screen.maps} map(s), ${screen.canvases} canvas`);
  for (const h of screen.headings) console.log(`    ${h}`);

  await page.send('Target.closeTarget', {}).catch(() => undefined);
}

// --------------------------------------------------------------------------------------
// Round 2: the map tab
// --------------------------------------------------------------------------------------

// --------------------------------------------------------------------------------------
// Round 1b: the second visit
// --------------------------------------------------------------------------------------

/**
 * The visit that is not cold, which for an installed app is every visit but the first.
 *
 * The cold start measures the network. Once the service worker has the app, the network
 * is out of the picture and two other things decide what the reader sees: how long the
 * parse and the first render take on a throttled phone, and whether the page they get
 * moves after it has painted -- a static shell replaced by the app, a board that lands
 * after the frame, a font swapping in. None of that is visible in the cold numbers,
 * where everything arrives so late that it all paints at once.
 *
 * Same throttles as the cold start, the cache on, the service worker left as the cold
 * start registered it. Bytes that still cross the wire are the ones the precache does
 * not cover, and there should be almost none.
 */
async function warmStart(browser: Browser): Promise<void> {
  console.log(`\nsecond visit -- ${CPU_THROTTLE}x CPU, Slow 4G, service worker and cache from the first`);

  // Let the first visit finish installing. The precache is a couple of megabytes and on
  // Slow 4G it is still arriving when the cold start's six seconds are up, so this waits,
  // unthrottled, until the worker is in charge and the cache has stopped growing --
  // which is the state every later visit actually starts from.
  const settle = await phonePage(browser, { cpu: 1, network: false });
  await settle.send('Network.setCacheDisabled', { cacheDisabled: false });
  await settle.goto(BASE);
  const cached = await settle.evaluate<number>(`(async () => {
    if (!('serviceWorker' in navigator)) return -1;
    await navigator.serviceWorker.ready;
    const count = async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; };
    let last = -1;
    for (let i = 0; i < 60; i++) {
      const n = await count();
      if (n > 0 && n === last) return n;
      last = n;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return last;
  })()`);
  await settle.send('Target.closeTarget', {}).catch(() => undefined);
  report('precached by the first visit', `${cached} files`, cached > 0 ? '' : '<-- no service worker cache to visit from');
  if (cached <= 0) failures++;

  const page = await phonePage(browser);
  await page.send('Network.setCacheDisabled', { cacheDisabled: false });
  const fromNetwork: { url: string; size: number }[] = [];
  const served = new Map<string, string>();
  page.on('Network.responseReceived', (p) => {
    const r = p.response as { url: string; fromServiceWorker?: boolean; fromDiskCache?: boolean; fromPrefetchCache?: boolean };
    served.set(p.requestId as string, r.fromServiceWorker ? 'sw' : r.fromDiskCache || r.fromPrefetchCache ? 'cache' : 'network');
    if (!r.fromServiceWorker && !r.fromDiskCache && !r.fromPrefetchCache) fromNetwork.push({ url: r.url, size: 0 });
  });
  page.on('Network.loadingFinished', (p) => {
    if (served.get(p.requestId as string) !== 'network') return;
    const entry = fromNetwork[fromNetwork.length - 1];
    if (entry) entry.size = (p.encodedDataLength as number) ?? 0;
  });

  await page.goto(BASE);
  await sleep(6000);
  const probe = await probeOf(page);

  const fcp = probe.paint['first-contentful-paint'] ?? 0;
  budget('first contentful paint', fcp, 2500);
  budget('main thread blocked (tasks over 50 ms)', blockingMs(probe), 1500);
  budget('cumulative layout shift', Math.round(probe.cls * 1000) / 1000, 0.1, '');
  for (const [when, score, what] of probe.shifts.slice(0, 5)) {
    report('  shifted', `${score.toFixed(3)}`, `at ${when} ms: ${what}`);
  }
  const kinds = [...served.values()];
  report('responses from the service worker', `${kinds.filter((k) => k === 'sw').length}`, `of ${kinds.length}`);
  // The notices endpoint is the one request that has to leave; anything else that still
  // crosses the wire is a file the precache should have had.
  const stray = fromNetwork.filter((r) => !/\/api\/alerts|\/alerts(\?|$)/.test(r.url));
  budget('bytes over the wire, beyond the notices', Math.round(stray.reduce((t, r) => t + r.size, 0) / 1024), 4, 'KB');
  for (const r of stray.slice(0, 6)) report('  from the network', `${(r.size / 1024).toFixed(1)} KB`, r.url.replace(BASE, ''));

  await page.send('Target.closeTarget', {}).catch(() => undefined);
}

/** Click one of the bottom-nav destinations by its visible label. */
const tapNav = (page: Session, label: string): Promise<boolean> =>
  page.call<boolean>(
    `(label) => { const b = [...document.querySelectorAll('nav a, nav button')].find((e) => e.textContent.trim() === label); if (!b) return false; b.click(); return true; }`,
    label,
  );

const MAP_READY = `document.querySelector('.leaflet-container canvas, .leaflet-container img.leaflet-tile')`;

/**
 * What opening the map costs, and what closing and reopening it leaves behind.
 *
 * The map is the most expensive thing this app can do: Leaflet and MapLibre GL glued
 * together, a WebGL context, a worker, and three layers rebuilt from the whole network.
 * The first half of this measures the tap; the second half taps twelve times, because a
 * cost paid once is a cost and a cost paid every time is a leak.
 */
async function mapTab(browser: Browser): Promise<void> {
  console.log(`\nthe map tab -- ${CPU_THROTTLE}x CPU, Slow 4G for the open, then unthrottled for the cycling`);

  const page = await phonePage(browser);
  await page.goto(BASE);
  await page.waitFor(`document.querySelector('nav')`);
  await sleep(1500);

  await page.evaluate('window.__probeReset()');
  const openedAt = Date.now();
  let drawn = 0;
  const opening = await profile(page, async () => {
    if (!(await tapNav(page, 'Mapa'))) throw new Error('could not find the Mapa tab');
    await page.waitFor(MAP_READY, 60_000);
    drawn = Date.now() - openedAt;
    // Tiles keep arriving after the first canvas; let the opening settle before reading.
    await sleep(4000);
  });

  let probe = await probeOf(page);
  budget('tap to first drawn map', drawn, 6000);
  // 1,200 when the basemap was raster tiles. The vector basemap parses its style and
  // paints its first frame on this thread, and under SwiftShader -- see launch() -- the
  // paint is CPU too: measured 1,610 to 1,883 ms across four runs on 14 September 2026
  // (MapLibre 6.9), of which the renderer is about three quarters and the WebGL2 probe
  // 200 ms. Set above that spread; the profile below is for whoever wants to move it.
  budget('main thread blocked while opening', blockingMs(probe), 2500);
  report('longest single task while opening', `${Math.max(0, ...probe.longtasks.map(([, d]) => d)).toFixed(0)} ms`, `${probe.longtasks.length} long tasks`);
  report('worst gap between frames', `${probe.worstFrame.toFixed(0)} ms`, 'the freeze a finger feels');
  budget('ResizeObserver callbacks while opening', probe.resizes, 12, 'calls');
  console.log('\n  where the opening went, self time, top 12');
  for (const { label, ms } of opening.slice(0, 12)) console.log(`    ${ms.toFixed(0).padStart(6)} ms  ${label}`);

  // Zooming is what rebuilds the stop layer, so it is the recurring cost rather than the
  // one-off. The control is the one a thumb actually hits.
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(500);
  await page.evaluate('window.__probeReset()');
  const zooming = await profile(page, async () => {
    for (let i = 0; i < 4; i++) {
      await page.evaluate(`document.querySelector('.leaflet-control-zoom-in')?.click()`);
      await sleep(900);
    }
  });
  probe = await probeOf(page);
  // 425 to 614 ms when this was set, all of it inside Leaflet and the renderer. The lane
  // work took it to 2,133-4,055: a line nobody had chosen was drawn as the subject with
  // its arrows -- 199 DOM markers at zoom 16, rebuilt every step -- the 26,175 route
  // vertices were projected and stroked whole at every zoom, and every bus icon was
  // rebuilt every three seconds; and the written stop names were DOM tooltips, each a
  // forced layout on every zoom. With those gone -- the names are a canvas -- it measures
  // 249-607 ms over four runs, most of it the renderer's own frames under SwiftShader.
  // So the budget stands where it was set: above the spread, a guard against the next
  // regression rather than a target.
  budget('main thread blocked over four zoom steps', blockingMs(probe), 900);
  report('worst frame during zooming', `${probe.worstFrame.toFixed(0)} ms`, `${probe.longtasks.length} long tasks`);
  budget('ResizeObserver callbacks over four zooms', probe.resizes, 8, 'calls');
  console.log('\n  where the zooming went, self time, top 12');
  for (const { label, ms } of zooming.slice(0, 12)) console.log(`    ${ms.toFixed(0).padStart(6)} ms  ${label}`);

  // Twelve laps between Paradas and Mapa. App.tsx keeps the map mounted behind `hidden`
  // once it has been opened, so this is measuring show/hide rather than construction --
  // which is the thing that would quietly accumulate.
  const before = { heap: await page.heapBytes(), ...(await domCounts(page)) };
  const startListeners = (await probeOf(page)).listeners;
  const startIntervals = (await probeOf(page)).intervals;
  for (let lap = 0; lap < 12; lap++) {
    await tapNav(page, 'Paradas');
    await sleep(400);
    await tapNav(page, 'Mapa');
    await sleep(600);
  }
  await sleep(2000);
  const after = { heap: await page.heapBytes(), ...(await domCounts(page)) };
  probe = await probeOf(page);

  console.log('\n  twelve laps in and out of the map');
  const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;
  report('heap held after collection', `${mb(after.heap - before.heap)}`, `${mb(before.heap)} -> ${mb(after.heap)}`);
  report('canvases', `${after.canvases - before.canvases}`, `${before.canvases} -> ${after.canvases}`);
  report('map containers', `${after.maps - before.maps}`, `${before.maps} -> ${after.maps}`);
  report('DOM nodes', `${after.nodes - before.nodes}`, `${before.nodes} -> ${after.nodes}`);
  budget('net listeners left on window/document', probe.listeners - startListeners, 4, 'listeners');
  const grew = Object.entries(probe.listenerKinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (grew.length) {
    console.log('    what was added and never taken off:');
    for (const [kind, n] of grew) console.log(`      ${String(n).padStart(4)}  ${kind}`);
  }
  budget('net intervals left running', probe.intervals - startIntervals, 2, 'timers');
  budget('heap held after twelve laps', (after.heap - before.heap) / 1048576, 3, 'MB');

  await page.send('Target.closeTarget', {}).catch(() => undefined);
}

const domCounts = (page: Session): Promise<{ nodes: number; canvases: number; maps: number }> =>
  page.evaluate(
    `({ nodes: document.getElementsByTagName('*').length, canvases: document.querySelectorAll('canvas').length, maps: document.querySelectorAll('.leaflet-container').length })`,
  );

// --------------------------------------------------------------------------------------
// Round 3: typing, and what React does about it
// --------------------------------------------------------------------------------------

/** One real keystroke: the browser's own event path, not `.value = x`. */
async function typeChar(page: Session, char: string): Promise<void> {
  const common = { text: char, key: char, windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0) };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...common });
  await page.send('Input.dispatchKeyEvent', { type: 'char', ...common });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

/**
 * How late the letter arrives.
 *
 * calculateRelevanceScore is already timed under Node and is fast there. That is not the
 * question: the question is what the gap is between pressing a key and seeing it, with a
 * render and a re-sorted list in between. The Event Timing API measures exactly that gap,
 * which is why it is used here rather than a stopwatch around the function.
 */
const FOCUS_SEARCH = `(() => { const i = document.querySelector('input[type=search], header input, input'); if (!i) return false; i.focus(); return document.activeElement === i; })()`;

/**
 * The very first letter, on a page that has never been typed into, five times over.
 *
 * It is the only keystroke that finds every cache cold, and one sample of it swings by a
 * couple of hundred milliseconds run to run -- enough to make any single before-and-after
 * a coin toss. A fresh page each time and the median of five is what makes the comparison
 * mean something.
 */
async function firstKeystroke(browser: Browser, samples = 5): Promise<{ paint: number[]; blocked: number[] }> {
  const paint: number[] = [];
  const blocked: number[] = [];
  for (let i = 0; i < samples; i++) {
    const page = await phonePage(browser, { network: false });
    await page.goto(BASE);
    await page.waitFor(`document.querySelector('input')`);
    // Long enough for the idle work the app schedules on mount to have run. Typing
    // before it has is a different measurement -- an interesting one, but not this one.
    await sleep(Number(process.env.SETTLE ?? 4000));
    if (!(await page.evaluate<boolean>(FOCUS_SEARCH))) break;
    await page.evaluate('window.__probeReset()');
    await typeChar(page, 'R');
    await sleep(1200);
    const probe = await probeOf(page);
    const down = probe.events.find(([name]) => name === 'keydown');
    if (down) paint.push(down[2]);
    blocked.push(blockingMs(probe));
    await page.send('Target.closeTarget', {}).catch(() => undefined);
  }
  return { paint, blocked };
}

const median = (list: number[]) =>
  list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : 0;

async function typing(browser: Browser): Promise<void> {
  console.log(`\ntyping in the search box -- ${CPU_THROTTLE}x CPU`);

  const cold = await firstKeystroke(browser);
  report('first letter, press to paint', `${median(cold.paint)} ms`, `median of ${cold.paint.length}: ${cold.paint.join(', ')}`);
  budget('first letter, main thread blocked', median(cold.blocked), 250);

  const page = await phonePage(browser, { network: false });
  await page.goto(BASE);
  await page.waitFor(`document.querySelector('input')`);
  await sleep(Number(process.env.SETTLE ?? 4000));

  if (!(await page.evaluate<boolean>(FOCUS_SEARCH))) {
    console.log('  no search input found on the opening screen.');
    return;
  }

  // A real street somebody would look for, typed a letter at a time at a human rate.
  const query = 'Ronda da Muralla';
  const typeIt = async () => {
    for (const char of query) {
      await typeChar(page, char);
      await sleep(120);
    }
    await sleep(900);
  };

  // Timed with nothing else attached. The sampler below costs enough to show up in these
  // numbers, so it gets its own pass rather than contaminating the one that is reported.
  await page.evaluate('window.__probeReset()');
  await typeIt();
  const probe = await probeOf(page);

  const keyEvents = probe.events.filter(([name]) => /^(keydown|keypress|keyup|input)$/.test(name));
  const at = (list: number[], q: number) =>
    list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * q))] : 0;
  const delays = keyEvents.map(([, delay]) => delay);
  const durations = keyEvents.map(([, , duration]) => duration);
  const first = keyEvents.length ? keyEvents[0][3] : 0;

  report('key events measured', `${keyEvents.length}`, `${query.length} characters, events over 16 ms`);
  report('input delay, median / worst', `${at(delays, 0.5)} / ${at(delays, 1)} ms`, 'press to handler');
  report('event to painted frame, median / p95', `${at(durations, 0.5)} / ${at(durations, 0.95)} ms`);
  // The first letter is its own measurement, and the only one that is not noise: it is
  // the keystroke that finds every cache cold, so it is where a warm-up shows or does not.
  budget('event to painted frame, worst', at(durations, 1), 600);
  console.log('\n  the five slowest key events, and when in the word they landed');
  for (const [name, delay, duration, when] of [...keyEvents].sort((a, b) => b[2] - a[2]).slice(0, 5)) {
    console.log(`    ${name.padEnd(10)} ${String(duration).padStart(5)} ms to paint, ${String(delay).padStart(4)} ms delay, at ${String(when - first).padStart(5)} ms into the typing`);
  }
  console.log('');
  budget('main thread blocked while typing', blockingMs(probe), 400);
  report('worst gap between frames', `${probe.worstFrame.toFixed(0)} ms`, `${probe.longtasks.length} long tasks`);
  // Up to three a keystroke: the field itself, the rows behind it (a deferred value, so
  // the letter paints before the list), and one more where a deferred render was
  // interrupted by the next key and finished later. Measured 45 for sixteen letters.
  budget('React commits for the whole word', probe.commits, 3 * query.length + 4, 'commits');

  // Second pass, sampler on, only to say where the time goes.
  await page.evaluate(
    `(() => { const i = document.querySelector('input[type=search], header input, input'); if (i) { i.focus(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`,
  );
  await sleep(600);
  const hot = await profile(page, typeIt);
  console.log('\n  where the typing went, self time, top 10 (sampler attached, so slower)');
  for (const { label, ms } of hot.filter((h) => !/\(idle\)|\(program\)/.test(h.label)).slice(0, 10)) {
    console.log(`    ${ms.toFixed(0).padStart(6)} ms  ${label}`);
  }

  await page.send('Target.closeTarget', {}).catch(() => undefined);
}

// --------------------------------------------------------------------------------------
// Round 4: the board somebody left open
// --------------------------------------------------------------------------------------

/**
 * How much faster than real time the session runs.
 *
 * Half an hour at a bus stop is 120 recomputes of the board and 60 asks for the operator's
 * minutes. What makes it a long session is that tick count, not the wall clock, so the
 * intervals are divided down and the same number of ticks happens in a couple of minutes.
 * Every timer under five seconds is left alone: those are animations and debounces, and
 * speeding them up would measure something the app never does.
 */
const COMPRESS = Number(process.env.COMPRESS ?? 30);

const SPEED_UP_LONG_TIMERS = `
(() => {
  const speed = ${COMPRESS};
  const slow = 5000;
  const original = window.setInterval;
  window.setInterval = function (fn, delay, ...rest) {
    const scaled = typeof delay === 'number' && delay >= slow ? Math.max(60, delay / speed) : delay;
    return original.call(window, fn, scaled, ...rest);
  };
})();
`;

/**
 * A board left open, and whether anything piles up behind it.
 *
 * The board recomputes every 15 s and the operator's own minutes are asked for every 30 s,
 * both for as long as somebody stands there. Neither is expensive once; the question is
 * whether two hundred of them leave anything behind -- a listener per pass, an interval
 * that outlives its effect, a heap that only goes up.
 *
 * The operator's site is not in this. Their page is read by the server, and pointing a
 * compressed hour of polling at somebody else's free service to measure our own memory
 * would be rude and would measure their caching as much as our heap, so `/agora` is
 * answered here with a fixed body. What is being exercised is the client: the fetch, the
 * state it sets, and the render that follows.
 */
async function longSession(browser: Browser): Promise<void> {
  const minutes = Number(process.env.MINUTES ?? 30);
  const seconds = Math.round((minutes * 60) / COMPRESS);
  console.log(`\na stop board left open for ${minutes} minutes -- ${COMPRESS}x compressed, so ${seconds} s of clock`);

  const page = await phonePage(browser, { network: false });
  await page.onNewDocument(SPEED_UP_LONG_TIMERS);

  // Answer the operator endpoint here rather than upstream. See above.
  let served = 0;
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  page.on('Fetch.requestPaused', (event) => {
    served++;
    const url = String(event.request ? (event.request as { url: string }).url : '');
    const body = /agora/.test(url)
      ? JSON.stringify({ code: 'uilP', departures: [{ line: '1', towards: 'HULA', minutes: served % 20 }], fetchedAt: new Date().toISOString() })
      : '[]';
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

  const before = { heap: await page.heapBytes(), ...(await domCounts(page)) };
  const start = await probeOf(page);
  await page.evaluate('window.__probeReset()');

  await sleep(seconds * 1000);

  const after = { heap: await page.heapBytes(), ...(await domCounts(page)) };
  const probe = await probeOf(page);
  const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;

  const screen = await page.evaluate<{ heading: string; ticks: number; intervals: number }>(
    `({ heading: (document.querySelector('h2, h1') || {}).textContent || '', ticks: Number((document.querySelector('[data-tick]') || {}).dataset ? document.querySelector('[data-tick]').dataset.tick : -1), intervals: window.__probe.intervals })`,
  );
  report('what was on screen', screen.heading.slice(0, 34), `${screen.intervals} intervals live`);
  report('endpoint answers served', `${served}`, `${(served / minutes).toFixed(1)} a minute`);
  report('DOM nodes', `${after.nodes - before.nodes}`, `${before.nodes} -> ${after.nodes}`);
  budget('heap held after the session', (after.heap - before.heap) / 1048576, 3, 'MB');
  report('heap, before and after', mb(after.heap - before.heap), `${mb(before.heap)} -> ${mb(after.heap)}`);
  budget('net listeners left on window/document', probe.listeners - start.listeners, 4, 'listeners');
  budget('net intervals left running', probe.intervals - start.intervals, 2, 'timers');
  budget('main thread blocked over the session', blockingMs(probe), 2000);
  report('longest single task', `${Math.max(0, ...probe.longtasks.map(([, d]) => d)).toFixed(0)} ms`, `${probe.longtasks.length} long tasks`);
  report('worst gap between frames', `${probe.worstFrame.toFixed(0)} ms`);

  await page.send('Fetch.disable').catch(() => undefined);
  await page.send('Target.closeTarget', {}).catch(() => undefined);
}

// --------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const executable = findChromium();
  if (!executable) {
    console.log('\nNo Chromium found. Set CHROME_PATH, or install Chrome.\n');
    return;
  }
  const alive = await fetch(BASE, { signal: AbortSignal.timeout(3000) }).then(
    (r) => r.ok,
    () => false,
  );
  if (!alive) {
    console.log(`\nNothing is serving ${BASE}. Run: pnpm build && PORT=3002 pnpm start\n`);
    return;
  }
  console.log(`\nbrowser: ${executable}`);

  const rounds: Record<string, (b: Browser) => Promise<void>> = { start: coldStart, second: warmStart, map: mapTab, typing, session: longSession };
  const asked = process.argv[2];
  const chosen = asked ? [asked] : Object.keys(rounds);
  for (const name of chosen) {
    if (!rounds[name]) {
      console.log(`\nNo round called "${name}". Try: ${Object.keys(rounds).join(', ')}\n`);
      return;
    }
  }

  const browser = await launch(executable);
  try {
    for (const name of chosen) await rounds[name](browser);
  } finally {
    browser.close();
  }

  console.log('');
  if (failures) {
    console.log(`${failures} measurement(s) over budget.\n`);
    process.exitCode = 1;
  }
}

void main();
