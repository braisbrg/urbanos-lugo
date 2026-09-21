/**
 * The app when the network is the problem.
 *
 *   pnpm build && PORT=3002 pnpm start     # in another terminal
 *   pnpm run stress:network
 *
 * stress:http measures the server under load. This is the other side: what the reader
 * sees when the server, or the connection to it, is the thing that is wrong -- which at
 * a bus stop is the normal case, not the edge one. Four shapes, played through the
 * browser's own network stack against the built app:
 *
 *   - the API never answers (a cold worker, a tunnel, one bar of signal);
 *   - the API answers with an error;
 *   - the API answers, but six seconds late;
 *   - there is no network at all, on a second visit.
 *
 * What is measured is what is on screen and when. The bar: the timetable board is never
 * held up by the API, the notices screen never sits on an empty list -- an empty list
 * reads as "no incidents" -- for more than the two seconds the hook allows before it shows
 * the committed snapshot, a late answer still replaces that snapshot, and nothing throws.
 *
 * Run by hand, not a gate: it needs a built server, and the timings are this machine's.
 */
import alertSnapshot from '../public/alerts.json';
import { translations } from '../src/i18n';
import { findChromium, launch, sleep, type Browser, type Session } from './cdp';

const BASE = process.env.BASE ?? 'http://localhost:3002';
const VIEW = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const t = translations('gl');

/** The snapshot is on screen when the page says so above the notices; the sentence names the date. */
const SNAPSHOT_SENTENCE = t.fares.snapshotNotice('').split('.')[0];
/** Probes run in the page with `page.call`, so the strings they look for travel as arguments, never as code. */
// Case-insensitive: innerText carries the CSS text-transform, and the notice labels are set in capitals.
const PAGE_SAYS = '(s) => document.body.innerText.toLowerCase().includes(s.toLowerCase())';
const snapshotShown = (page: Session) => page.call<boolean>(PAGE_SAYS, SNAPSHOT_SENTENCE);
/** A departure board has at least one clock time on it. */
const boardShown = (page: Session) => page.call<boolean>("() => /\\b\\d{1,2}:\\d{2}\\b/.test(document.querySelector('main')?.innerText ?? '')");

let failures = 0;
function report(label: string, value: string, bad = false): void {
  if (bad) failures++;
  console.log(`  ${label.padEnd(58)} ${value}${bad ? '   <-- look' : ''}`);
}

/** Milliseconds until `probe` answers true, or -1 after `limit`. */
async function timeUntil(probe: () => Promise<boolean>, limit: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < limit) {
    if (await probe()) return Date.now() - started;
    await sleep(100);
  }
  return -1;
}

const ms = (n: number) => (n < 0 ? 'never' : `${n} ms`);

interface Trouble {
  name: string;
  /** What happens to each intercepted `/api/` request. */
  handle: (page: Session, requestId: string) => void;
  /** The most the notices screen may take to show something, in ms. */
  noticesWithin: number;
  /** Whether a live answer is expected to replace the snapshot in the end. */
  liveLater: boolean;
}

const TROUBLES: Trouble[] = [
  {
    name: 'the API never answers',
    handle: () => {
      /* held for ever */
    },
    noticesWithin: 3500,
    liveLater: false,
  },
  {
    name: 'the API answers 500',
    handle: (page, requestId) => {
      page.send('Fetch.fulfillRequest', { requestId, responseCode: 500, body: Buffer.from('boom').toString('base64') });
    },
    noticesWithin: 1500,
    liveLater: false,
  },
  {
    name: 'the API answers six seconds late',
    handle: (page, requestId) => {
      setTimeout(() => page.send('Fetch.continueRequest', { requestId }).catch(() => undefined), 6000);
    },
    noticesWithin: 3500,
    liveLater: true,
  },
];

async function freshPage(browser: Browser): Promise<{ page: Session; thrown: string[] }> {
  const page = await browser.newPage();
  await page.send('Emulation.setDeviceMetricsOverride', VIEW);
  await page.onNewDocument(`try { localStorage.setItem('urbanos-lugo-lang', 'gl'); } catch (e) {}`);
  const thrown: string[] = [];
  page.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails as { text?: string; exception?: { description?: string } };
    thrown.push((d.exception?.description ?? d.text ?? '').split('\n')[0].slice(0, 160));
  });
  return { page, thrown };
}

async function apiTrouble(browser: Browser, trouble: Trouble): Promise<void> {
  console.log(`\n${trouble.name}`);
  const { page, thrown } = await freshPage(browser);
  // The first visit: no service worker in front yet, so the page talks to the API itself.
  await page.send('Network.setBypassServiceWorker', { bypass: true });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  let intercepted = 0;
  page.on('Fetch.requestPaused', (p) => {
    intercepted++;
    trouble.handle(page, p.requestId as string);
  });

  // The board first: it is computed on the device and must not wait for anyone.
  await page.goto(`${BASE}/paradas/?parada=uilP`);
  const board = await timeUntil(() => boardShown(page), 5000);
  report('timetable board on screen, pole times pending', ms(board), board < 0 || board > 3000);

  await page.goto(`${BASE}/avisos/`);
  const shown = await timeUntil(() => snapshotShown(page), 8000);
  report(`notices screen shows the dated snapshot (bar ${trouble.noticesWithin} ms)`, ms(shown), shown < 0 || shown > trouble.noticesWithin);
  if (trouble.liveLater) {
    const replaced = await timeUntil(async () => !(await snapshotShown(page)), 10_000);
    report('the late answer replaces the snapshot', ms(replaced), replaced < 0);
  }
  report('API requests intercepted', String(intercepted), intercepted === 0);
  report('uncaught exceptions', thrown.length ? thrown.join(' | ') : 'none', thrown.length > 0);
  await page.send('Fetch.disable');
}

async function offlineSecondVisit(browser: Browser): Promise<void> {
  console.log('\nno network at all, second visit');
  const { page, thrown } = await freshPage(browser);
  // First visit online, until the service worker is installed; then once more so it is
  // the one answering for the page.
  await page.goto(`${BASE}/paradas/`);
  await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
  await sleep(1000);
  await page.goto(`${BASE}/paradas/`);
  await page.waitFor('navigator.serviceWorker.controller', 20_000);
  await sleep(1000);

  await browser.offline(true);
  await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const dead = await page.call<boolean>('(u) => fetch(u).then(() => false, () => true)', `${BASE}/api/version`);
  report('the page really is offline', dead ? 'yes' : 'no: a fetch still went through', !dead);

  await page.goto(`${BASE}/paradas/?parada=uilP`);
  const board = await timeUntil(() => boardShown(page), 5000);
  report('timetable board on screen, from the cache', ms(board), board < 0);
  const online = await page.evaluate<boolean>('navigator.onLine');
  report('navigator.onLine', String(online));

  // Offline, the service worker answers /api/alerts with the last answer it saw -- the
  // app asks on every screen, so the first visit left one -- and the screen shows it: as
  // notice cards when it carried any, as the "last check" line when it did not. Only when
  // the worker has nothing does the hook's snapshot appear. Any of the three is a dated
  // answer; an empty list is the failure.
  await page.goto(`${BASE}/avisos/`);
  const cards = () => page.call<boolean>(PAGE_SAYS, t.fares.sourceOperator);
  const checked = () => page.call<boolean>(PAGE_SAYS, t.fares.lastCheck);
  const dated = async () => (await snapshotShown(page)) || (await checked()) || (await cards());
  const shown = await timeUntil(dated, 8000);
  // When nothing dated shows, say what the screen does say: it is the difference between
  // an empty list and a page that never rendered.
  const which = shown < 0
    ? ` (nothing dated; the screen reads: ${JSON.stringify(await page.call<string>("() => (document.querySelector('main')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 160)"))})`
    : (await snapshotShown(page)) ? ' (the committed snapshot)' : " (the worker's last cached answer)";
  report('notices screen shows a dated answer', ms(shown) + which, shown < 0 || shown > 3500);
  report('uncaught exceptions', thrown.length ? thrown.join(' | ') : 'none', thrown.length > 0);
  await browser.offline(false);
}

const exe = findChromium();
if (!exe) throw new Error('no Chromium found');
// A dead server would read as every probe timing out, which looks like the app failing.
// It happened: the server had been stopped under the tool and every row said "never".
const alive = await fetch(`${BASE}/`).then((r) => r.ok, () => false);
if (!alive) throw new Error(`${BASE} does not answer: start the built server first (pnpm build && PORT=3002 pnpm start)`);
console.log(`against ${BASE}; committed snapshot from ${alertSnapshot.fetchedAt}, ${alertSnapshot.alerts.length} notice(s)`);
const browser = await launch(exe, true);
try {
  for (const trouble of TROUBLES) await apiTrouble(browser, trouble);
  await offlineSecondVisit(browser);
} finally {
  browser.close();
}
console.log(`\n${failures === 0 ? 'nothing broke' : `${failures} thing(s) worth looking at`}\n`);
