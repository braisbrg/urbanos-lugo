/**
 * A browser, driven over the wire, so the app can be measured where it actually runs.
 *
 * The other stress tools call the app's functions under Node, which is blind to the half
 * of the cost that only exists in a browser: a bundle parsing, a map painting, a keystroke
 * waiting behind a render. This launches a Chromium already on the machine, talks CDP to
 * it over Node's built-in WebSocket, and throttles it to the phone the README describes.
 * No dependency: the browser is found, not installed. The scenarios live in
 * stressBrowser.ts, auditBrowser.ts and stressNetwork.ts.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { sleep } from './lib';

export const BASE = process.env.BASE ?? 'http://localhost:3002';
export const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
/** The tools find buttons by their Galician labels, whatever language the browser speaks. */
const SPEAK_GALICIAN = "try { localStorage.setItem('urbanos-lugo-lang', 'gl'); } catch (e) {}";

function globDirs(parent: string, match: RegExp): string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && match.test(e.name))
    .map((e) => path.join(parent, e.name))
    .sort()
    .reverse(); // newest version first
}

/** CHROME_PATH, then the Playwright and Puppeteer caches, then the ordinary installs. */
export function findChromium(): string | null {
  const local = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
  const candidates = [
    process.env.CHROME_PATH,
    ...globDirs(path.join(local, 'ms-playwright'), /^chromium(_headless_shell)?-\d+$/).flatMap((d) => [
      path.join(d, 'chrome-win64', 'chrome.exe'),
      path.join(d, 'chrome-win', 'chrome.exe'),
      path.join(d, 'chrome-linux', 'chrome'),
      path.join(d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]),
    ...globDirs(path.join(homedir(), '.cache', 'puppeteer', 'chrome'), /./).flatMap((d) => [
      path.join(d, 'chrome-win64', 'chrome.exe'),
      path.join(d, 'chrome-linux64', 'chrome'),
      path.join(d, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    ]),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

type Params = Record<string, unknown>;
type Handler = (params: Params) => void;
interface Evaluated<T> {
  result: { value?: T };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

const unwrap = <T>(res: Evaluated<T>): T => {
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value as T;
};

class Connection {
  private socket!: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: Params) => void; reject: (e: Error) => void }>();
  private readonly handlers = new Map<string, Handler[]>();

  async open(url: string): Promise<void> {
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    this.socket.addEventListener('message', (event: MessageEvent) => this.dispatch(String(event.data)));
  }

  private dispatch(raw: string): void {
    const m = JSON.parse(raw) as { id?: number; method?: string; params?: Params; sessionId?: string; result?: Params; error?: { message: string } };
    if (m.id !== undefined) {
      const waiting = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) waiting?.reject(new Error(m.error.message));
      else waiting?.resolve(m.result ?? {});
    } else if (m.method) {
      for (const handler of this.handlers.get(`${m.sessionId ?? ''}:${m.method}`) ?? []) handler(m.params ?? {});
    }
  }

  send(method: string, params: Params, sessionId?: string): Promise<Params> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  on(event: string, handler: Handler, sessionId?: string): void {
    const key = `${sessionId ?? ''}:${event}`;
    this.handlers.set(key, [...(this.handlers.get(key) ?? []), handler]);
  }

  once(event: string, sessionId: string, handler: Handler): void {
    const key = `${sessionId}:${event}`;
    const wrapped: Handler = (p) => {
      this.handlers.set(key, (this.handlers.get(key) ?? []).filter((h) => h !== wrapped));
      handler(p);
    };
    this.on(event, wrapped, sessionId);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // already gone
    }
  }
}

/** One attached page, and the socket it shares with the browser. */
export class Session {
  constructor(
    private readonly conn: Connection,
    readonly sessionId: string,
    private readonly targetId: string,
  ) {}

  send<T = Params>(method: string, params: Params = {}): Promise<T> {
    return this.conn.send(method, params, this.sessionId) as Promise<T>;
  }

  on(event: string, handler: Handler): void {
    this.conn.on(event, handler, this.sessionId);
  }

  /** Evaluate in the page and return the value, awaiting a promise if one comes back. */
  async evaluate<T>(expression: string): Promise<T> {
    return unwrap(await this.send<Evaluated<T>>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }));
  }

  /**
   * Call a function in the page with real arguments, over the protocol's own channel:
   * splicing values into an expression is code built from data, which CodeQL flagged.
   * `globalThis` is looked up every call because its handle dies with each navigation.
   */
  async call<T>(fn: string, ...args: unknown[]): Promise<T> {
    const { result: page } = await this.send<{ result: { objectId: string } }>('Runtime.evaluate', { expression: 'globalThis' });
    return unwrap(
      await this.send<Evaluated<T>>('Runtime.callFunctionOn', {
        functionDeclaration: fn,
        objectId: page.objectId,
        arguments: args.map((value) => ({ value })),
        awaitPromise: true,
        returnByValue: true,
      }),
    );
  }

  /** Runs before any of the page's own script, on this and every subsequent document. */
  onNewDocument(source: string): Promise<Params> {
    return this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  /** Navigate and wait for the load event, or give up after `timeout`. */
  async goto(url: string, timeout = 30_000): Promise<void> {
    const loaded = this.once('Page.loadEventFired', timeout);
    await this.send('Page.navigate', { url });
    await loaded;
  }

  once(event: string, timeout = 30_000): Promise<Params> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout);
      this.conn.once(event, this.sessionId, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  /** Poll an expression until it is truthy. */
  async waitFor(expression: string, timeout = 15_000, every = 50): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!(await this.evaluate<boolean>(`!!(${expression})`))) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expression}`);
      await sleep(every);
    }
  }

  /** Collect three times, then read: one pass is not always enough to settle. */
  async heapBytes(): Promise<number> {
    for (let i = 0; i < 3; i++) await this.send('HeapProfiler.collectGarbage');
    const { usedSize } = await this.send<{ usedSize: number }>('Runtime.getHeapUsage');
    return usedSize;
  }

  /** Uncaught exceptions from here on, first line each. */
  uncaught(): string[] {
    const list: string[] = [];
    this.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string } };
      list.push((d.exception?.description ?? d.text ?? '').split('\n')[0].slice(0, 220));
    });
    return list;
  }

  /** Closing is a browser-level command, keyed by target: sent through the page's own session it was refused, silently, and every page a run opened stayed open. */
  close(): Promise<unknown> {
    return this.conn.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
  }
}

export interface Browser {
  /** A fresh page with Page/Runtime/Network/Performance/DOM enabled. */
  newPage(): Promise<Session>;
  /**
   * Pull the plug on every service worker too: emulating conditions on a page reaches
   * only its own requests, and a worker fetching on its behalf would serve fresh answers
   * to an "offline" test.
   */
  offline(on: boolean): Promise<void>;
  close(): void;
}

export const OFFLINE = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
export const ONLINE = { ...OFFLINE, offline: false };

/**
 * Port 0 plus the DevToolsActivePort file, not a fixed port: two runs on one machine must
 * not fight, and a stale Chromium from a killed run must not be mistaken for this one.
 */
export async function launch(executable: string, headless = true): Promise<Browser> {
  const profile = mkdtempSync(path.join(tmpdir(), 'urbanos-cdp-'));
  // Headless has no GPU and the map needs WebGL2: SwiftShader is the software path, which
  // also makes every canvas a CPU cost. CDP_GPU=1 opens a window on the real GPU instead.
  const gpu = Boolean(process.env.CDP_GPU);
  const child = spawn(
    executable,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...(gpu ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      ...(headless && !gpu ? ['--headless=new'] : []),
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 30_000;
  let port = 0;
  while (!port && Date.now() < deadline) {
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]?.trim() || 0);
    if (!port) await sleep(100);
  }
  if (!port) {
    child.kill();
    throw new Error('the browser never reported a debugging port');
  }

  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const conn = new Connection();
  await conn.open(version.webSocketDebuggerUrl);

  // Every service worker gets a session of its own, so `offline` can reach it.
  const workers = new Set<string>();
  let unplugged = false;
  const plug = (sessionId: string, on: boolean) =>
    conn.send('Network.enable', {}, sessionId).then(() => conn.send('Network.emulateNetworkConditions', on ? OFFLINE : ONLINE, sessionId));
  conn.on('Target.attachedToTarget', (p) => {
    if ((p.targetInfo as { type: string }).type !== 'service_worker') return;
    workers.add(p.sessionId as string);
    if (unplugged) void plug(p.sessionId as string, true);
  });
  conn.on('Target.detachedFromTarget', (p) => workers.delete(p.sessionId as string));
  await conn.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'service_worker', exclude: false }] });

  return {
    async offline(on) {
      unplugged = on;
      for (const sessionId of workers) await plug(sessionId, on);
    },
    async newPage() {
      const { targetId } = (await conn.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
      const { sessionId } = (await conn.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
      const session = new Session(conn, sessionId, targetId);
      for (const domain of ['Page', 'Runtime', 'Network', 'Performance', 'DOM']) await session.send(`${domain}.enable`);
      return session;
    },
    close() {
      conn.close();
      child.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Windows keeps a handle on the profile for a moment after the kill
      }
    },
  };
}

/** A page sized like the phone, speaking Galician, with `extra` scripts run before the app's own. */
export async function phonePage(browser: Browser, ...extra: string[]): Promise<Session> {
  const page = await browser.newPage();
  await page.send('Emulation.setDeviceMetricsOverride', PHONE);
  for (const source of [SPEAK_GALICIAN, ...extra]) await page.onNewDocument(source);
  return page;
}

/**
 * Find a Chromium and a server, run the rounds, close the browser. A machine without
 * either cannot run the measurement, which is not a failing check: it says so and exits 0.
 */
export async function withBrowser(run: (browser: Browser) => Promise<void>): Promise<void> {
  const executable = findChromium();
  if (!executable) return console.log('\nNo Chromium found. Set CHROME_PATH, or install Chrome.\n');
  // A dead server reads as every probe timing out, which looks like the app failing.
  if (!(await fetch(BASE, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false))) {
    return console.log(`\nNothing is serving ${BASE}. Run: pnpm build && PORT=3002 pnpm start\n`);
  }
  console.log(`\nbrowser: ${executable}`);
  const browser = await launch(executable);
  try {
    await run(browser);
  } finally {
    browser.close();
  }
}

/**
 * Installed before the page's own script: the long tasks that blocked the main thread
 * while the bundle started, the widest gap between frames (how long the phone looked
 * frozen), what each keystroke cost from hardware event to painted frame, React commits,
 * ResizeObserver callbacks, and the net listeners and intervals.
 *
 * Listeners are counted on window and document only: those outlive every component, so a
 * handler left there is what accumulates. Counting every target measured React remounts
 * (a discarded element takes its listeners with it). The per-kind tally keeps the
 * breakdown for when the number moves.
 */
export const PROBE_SOURCE = `
(() => {
  const w = window;
  w.__probe = { longtasks: [], paint: {}, frames: [], worstFrame: 0, listeners: 0, listenerKinds: {}, intervals: 0, events: [], commits: 0, resizes: 0 };
  const observe = (type, onEntry, extra = {}) => {
    try { new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true, ...extra }); } catch {}
  };
  observe('longtask', (e) => w.__probe.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]));
  observe('paint', (e) => { w.__probe.paint[e.name] = Math.round(e.startTime); });
  observe('largest-contentful-paint', (e) => { w.__probe.paint['lcp'] = Math.round(e.startTime); });
  observe('event', (e) => w.__probe.events.push([e.name, Math.round(e.processingStart - e.startTime), Math.round(e.duration), Math.round(e.startTime)]), { durationThreshold: 16 });

  const add = EventTarget.prototype.addEventListener;
  const drop = EventTarget.prototype.removeEventListener;
  const tally = (target, type, by) => {
    try {
      const where = target === w ? 'window' : target === w.document ? 'document' : (target && target.constructor && target.constructor.name) || '?';
      const key = where + ' ' + type;
      w.__probe.listenerKinds[key] = (w.__probe.listenerKinds[key] || 0) + by;
    } catch {}
  };
  const longLived = (t) => t === w || t === w.document;
  EventTarget.prototype.addEventListener = function (...a) { if (longLived(this)) w.__probe.listeners++; tally(this, a[0], 1); return add.apply(this, a); };
  EventTarget.prototype.removeEventListener = function (...a) { if (longLived(this)) w.__probe.listeners--; tally(this, a[0], -1); return drop.apply(this, a); };

  // React reports every commit to whatever sits on this hook, in production too. It only
  // counts, and never throws: a hook that throws breaks the app it was meant to watch.
  if (!w.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      checkDCE() {},
      inject() { return 1; },
      onCommitFiberRoot() { try { w.__probe.commits++; } catch {} },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
    };
  }
  const RO = w.ResizeObserver;
  if (RO) {
    w.ResizeObserver = function (cb) {
      return new RO(function (...a) { w.__probe.resizes++; return cb.apply(this, a); });
    };
  }
  const setI = w.setInterval, clearI = w.clearInterval;
  w.setInterval = function (...a) { w.__probe.intervals++; return setI.apply(w, a); };
  w.clearInterval = function (...a) { w.__probe.intervals--; return clearI.apply(w, a); };

  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    if (gap > w.__probe.worstFrame) w.__probe.worstFrame = gap;
    w.__probe.frames.push(gap);
    if (w.__probe.frames.length > 4000) w.__probe.frames.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  w.__probeReset = () => { w.__probe.longtasks.length = 0; w.__probe.frames.length = 0; w.__probe.worstFrame = 0; w.__probe.resizes = 0; w.__probe.commits = 0; w.__probe.events.length = 0; };
})();
`;

export interface Probe {
  longtasks: [number, number][];
  paint: Record<string, number>;
  worstFrame: number;
  frames: number[];
  listeners: number;
  listenerKinds: Record<string, number>;
  intervals: number;
  resizes: number;
  commits: number;
  events: [string, number, number, number][];
}

/** Total time the main thread spent in tasks over 50 ms: the part a finger notices. */
export const blockingMs = (probe: Probe): number => probe.longtasks.reduce((total, [, duration]) => total + Math.max(0, duration - 50), 0);

export function report(label: string, value: string, note = ''): void {
  console.log(`  ${label.padEnd(46)} ${value.padStart(12)}  ${note}`);
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}

/**
 * Where the milliseconds went while `during` ran, by function, self time only: a long task
 * says the thread was busy, not what with. Minified names still find the file; the line
 * number is what makes it actionable.
 */
export async function profile(page: Session, during: () => Promise<void>, intervalUs = 200): Promise<{ label: string; ms: number }[]> {
  await page.send('Profiler.enable');
  await page.send('Profiler.setSamplingInterval', { interval: intervalUs });
  await page.send('Profiler.start');
  await during();
  const { profile: raw } = await page.send<{ profile: { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] } }>('Profiler.stop');
  await page.send('Profiler.disable');

  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const totals = new Map<string, number>();
  (raw.samples ?? []).forEach((id, i) => {
    const node = byId.get(id);
    if (!node) return;
    const { functionName, url, lineNumber } = node.callFrame;
    const label = `${functionName || '(anonymous)'}  ${url ? `${url.split('/').pop()}:${lineNumber + 1}` : 'native'}`;
    totals.set(label, (totals.get(label) ?? 0) + Math.max(0, raw.timeDeltas?.[i] ?? 0) / 1000);
  });
  return [...totals].map(([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms);
}
