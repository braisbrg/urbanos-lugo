/**
 * A browser, driven over the wire, so the app can be measured where it actually runs.
 *
 * Every other stress tool in here runs the app's functions under Node. That answers what
 * the computing costs and nothing else: it never loads a bundle, never paints, never
 * builds a map layer, and never blocks a main thread that somebody is waiting on. The
 * things this app is judged by at a bus stop -- how long the phone is frozen, how late
 * the first letter of a search appears -- have no Node equivalent.
 *
 * So: launch a Chromium that is already on this machine, talk CDP to it over the
 * WebSocket that Node has had built in since 22, and throttle it down to the phone the
 * README describes. No new dependency; the browser is found, not installed.
 *
 * Nothing here is app-specific. tools/stressBrowser.ts holds the scenarios.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Where a Chromium might already be.
 *
 * CHROME_PATH first, so anyone can point this at the browser they trust. Then the two
 * caches a machine that has ever run Playwright or Puppeteer will have, then the ordinary
 * installs. If none of them exist the caller says so and exits 0 -- a missing browser is
 * a machine that cannot run this measurement, not a failing check.
 */
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
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

function globDirs(parent: string, match: RegExp): string[] {
  if (!existsSync(parent)) return [];
  // Sorted descending so the newest versioned directory wins.
  return readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && match.test(e.name))
    .map((e) => path.join(parent, e.name))
    .sort()
    .reverse();
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
}

/** One attached page, and the socket it shares with the browser. */
export class Session {
  constructor(
    private readonly conn: Connection,
    readonly sessionId: string,
  ) {}

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.conn.send(method, params, this.sessionId) as Promise<T>;
  }

  on(event: string, handler: (params: Record<string, unknown>) => void): void {
    this.conn.on(event, handler, this.sessionId);
  }

  /** Evaluate in the page and return the value, awaiting a promise if one comes back. */
  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send<{
      result: { value?: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    }
    return res.result.value as T;
  }

  /** Runs before any of the page's own script, on this and every subsequent document. */
  async onNewDocument(source: string): Promise<void> {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  /** Navigate and wait for the load event, or give up after `timeout`. */
  async goto(url: string, timeout = 30_000): Promise<void> {
    const loaded = this.once('Page.loadEventFired', timeout);
    await this.send('Page.navigate', { url });
    await loaded;
  }

  once(event: string, timeout = 30_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout);
      this.conn.once(event, this.sessionId, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  /** Poll an expression until it is truthy. Cheaper and steadier than a fixed sleep. */
  async waitFor(expression: string, timeout = 15_000, every = 50): Promise<void> {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await this.evaluate<boolean>(`!!(${expression})`)) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expression}`);
      await sleep(every);
    }
  }

  /** Collect, then read. Two passes because one is not always enough to settle. */
  async heapBytes(): Promise<number> {
    for (let i = 0; i < 3; i++) await this.send('HeapProfiler.collectGarbage');
    const { usedSize } = await this.send<{ usedSize: number }>('Runtime.getHeapUsage');
    return usedSize;
  }
}

class Connection {
  private socket!: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, ((p: Record<string, unknown>) => void)[]>();

  async open(url: string): Promise<void> {
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    this.socket.addEventListener('message', (event: MessageEvent) => this.dispatch(String(event.data)));
  }

  private dispatch(raw: string): void {
    const message = JSON.parse(raw) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    for (const handler of this.handlers.get(this.key(message.method, message.sessionId)) ?? []) {
      handler(message.params ?? {});
    }
  }

  private key(event: string, sessionId?: string): string {
    return `${sessionId ?? ''}:${event}`;
  }

  send(method: string, params: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(event: string, handler: (p: Record<string, unknown>) => void, sessionId?: string): void {
    const key = this.key(event, sessionId);
    const list = this.handlers.get(key) ?? [];
    list.push(handler);
    this.handlers.set(key, list);
  }

  once(event: string, sessionId: string, handler: (p: Record<string, unknown>) => void): void {
    const wrapped = (p: Record<string, unknown>) => {
      const key = this.key(event, sessionId);
      const list = (this.handlers.get(key) ?? []).filter((h) => h !== wrapped);
      this.handlers.set(key, list);
      handler(p);
    };
    this.on(event, wrapped, sessionId);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Already gone; nothing to do.
    }
  }
}

export interface Browser {
  /** A fresh page with Page/Runtime/Network/Performance already enabled. */
  newPage(): Promise<Session>;
  /**
   * Pull the plug on every service worker too. `Network.emulateNetworkConditions` on a
   * page reaches only that page's own requests; a worker fetching on its behalf is a
   * different target with a working connection, so an "offline" test that forgot it
   * would be served fresh answers by the worker and pass for the wrong reason.
   */
  offline(on: boolean): Promise<void>;
  close(): void;
}

const OFFLINE = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const ONLINE = { ...OFFLINE, offline: false };

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Start the browser and wait for it to say where its socket is.
 *
 * Port 0 plus the DevToolsActivePort file rather than a fixed port: two runs of this on
 * one machine should not fight, and a stale Chromium from a killed run should not be
 * mistaken for this one's.
 */
export async function launch(executable: string, headless = true): Promise<Browser> {
  const profile = mkdtempSync(path.join(tmpdir(), 'urbanos-cdp-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // The map needs WebGL2 and there is no GPU behind a headless run; SwiftShader is the
    // software path, and without the unsafe flag Chromium refuses it outright. It also
    // makes every canvas a CPU cost, which a phone with a GPU does not pay: CDP_GPU=1
    // leaves the flags out and opens a window, to tell the two apart.
    ...(process.env.CDP_GPU ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ...(headless && !process.env.CDP_GPU ? ['--headless=new'] : []),
    'about:blank',
  ];
  const child: ChildProcess = spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore'] });

  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 30_000;
  let port = 0;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, 'utf8').split('\n')[0]?.trim();
      if (first) {
        port = Number(first);
        break;
      }
    }
    await sleep(100);
  }
  if (!port) {
    child.kill();
    throw new Error('the browser never reported a debugging port');
  }

  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
    webSocketDebuggerUrl: string;
  };
  const conn = new Connection();
  await conn.open(version.webSocketDebuggerUrl);

  // Every service worker the browser starts gets a session of its own, so `offline`
  // can reach it. Pages are attached by hand in `newPage`, so the filter leaves them out.
  const workers = new Set<string>();
  let unplugged = false;
  conn.on('Target.attachedToTarget', (p) => {
    const info = p.targetInfo as { type: string };
    if (info.type !== 'service_worker') return;
    const sessionId = p.sessionId as string;
    workers.add(sessionId);
    if (unplugged) {
      conn.send('Network.enable', {}, sessionId).then(() => conn.send('Network.emulateNetworkConditions', OFFLINE, sessionId));
    }
  });
  conn.on('Target.detachedFromTarget', (p) => workers.delete(p.sessionId as string));
  await conn.send(
    'Target.setAutoAttach',
    { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'service_worker', exclude: false }] },
    undefined,
  );

  return {
    async offline(on: boolean): Promise<void> {
      unplugged = on;
      for (const sessionId of workers) {
        await conn.send('Network.enable', {}, sessionId);
        await conn.send('Network.emulateNetworkConditions', on ? OFFLINE : ONLINE, sessionId);
      }
    },
    async newPage(): Promise<Session> {
      const { targetId } = (await conn.send('Target.createTarget', { url: 'about:blank' }, undefined)) as {
        targetId: string;
      };
      const { sessionId } = (await conn.send(
        'Target.attachToTarget',
        { targetId, flatten: true },
        undefined,
      )) as { sessionId: string };
      const session = new Session(conn, sessionId);
      for (const domain of ['Page', 'Runtime', 'Network', 'Performance', 'DOM']) {
        await session.send(`${domain}.enable`);
      }
      return session;
    },
    close(): void {
      conn.close();
      child.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Windows keeps a handle on the profile for a moment after the kill. Harmless.
      }
    },
  };
}

/**
 * Installed before the page's own script, so nothing is missed.
 *
 * Two things nobody can measure after the fact: the tasks that blocked the main thread
 * while the bundle was starting, and the frames that were dropped while they did. The
 * long-task observer is the browser's own; the frame meter is a rAF chain, and the widest
 * gap between two frames is the closest thing to "how long did the phone look frozen".
 */
export const PROBE_SOURCE = `
(() => {
  const w = window;
  w.__probe = { longtasks: [], paint: {}, frames: [], worstFrame: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__probe.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__probe.paint[e.name] = Math.round(e.startTime);
    }).observe({ type: 'paint', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__probe.paint['lcp'] = Math.round(e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  // Net listeners on window and document, and net intervals.
  //
  // Only those two targets. Counting every addEventListener made this cry wolf: twelve laps
  // in and out of the map reported 66 net listeners, every one of them on an element --
  // 34 button clicks, 26 details toggles -- while DOM nodes and heap both went *down*. React
  // had unmounted those elements, and a discarded node takes its listeners with it without
  // anyone calling removeEventListener, so the count was measuring remounts.
  //
  // window and document outlive every component, so a handler left on them is the thing that
  // actually accumulates. The listenerKinds tally below keeps the full breakdown for when
  // the number does move and somebody has to find out which effect registered it.
  w.__probe.listeners = 0;
  w.__probe.intervals = 0;
  const add = EventTarget.prototype.addEventListener;
  const drop = EventTarget.prototype.removeEventListener;
  // Also by kind, because "66 net listeners" says something grows and not what. The key is
  // the event name and what it was attached to, which is enough to find the effect that
  // registered it and never took it off.
  w.__probe.listenerKinds = {};
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
  // What a keystroke actually cost the finger. The Event Timing API measures from the
  // hardware event to the frame that showed its result, which is the number a person
  // feels; how long the handler ran is a different and much kinder number.
  w.__probe.events = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__probe.events.push([e.name, Math.round(e.processingStart - e.startTime), Math.round(e.duration), Math.round(e.startTime)]);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {}

  // React tells whatever is on this hook about every commit, in production too. Nothing
  // here is React DevTools -- it just counts, and never throws, because a hook that
  // throws breaks the app it was meant to watch.
  w.__probe.commits = 0;
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

  // How often anything asked to be told its box changed. A map that keeps resizing itself
  // pays a forced layout every time, and the count is the only way to see it happening.
  w.__probe.resizes = 0;
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

/** Total time the main thread spent in tasks over 50 ms -- the part a finger notices. */
export const blockingMs = (probe: Probe): number =>
  probe.longtasks.reduce((total, [, duration]) => total + Math.max(0, duration - 50), 0);

export function report(label: string, value: string, note = ''): void {
  console.log(`  ${label.padEnd(46)} ${value.padStart(12)}  ${note}`);
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
}

/**
 * Where the milliseconds went, by function, self time only.
 *
 * A long task tells you the thread was busy; it does not tell you what it was busy with,
 * and guessing is how you optimise the wrong loop. This runs the sampler across whatever
 * `during` does and adds up the time each frame was on top of the stack. Minified names
 * survive well enough to find the file; the line number is what makes it actionable.
 */
export async function profile(
  page: Session,
  during: () => Promise<void>,
  intervalUs = 200,
): Promise<{ label: string; ms: number }[]> {
  await page.send('Profiler.enable');
  await page.send('Profiler.setSamplingInterval', { interval: intervalUs });
  await page.send('Profiler.start');
  await during();
  const { profile: raw } = await page.send<{
    profile: { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] };
  }>('Profiler.stop');
  await page.send('Profiler.disable');

  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const totals = new Map<string, number>();
  const samples = raw.samples ?? [];
  const deltas = raw.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i]);
    if (!node) continue;
    const { functionName, url, lineNumber } = node.callFrame;
    const where = url ? `${url.split('/').pop()}:${lineNumber + 1}` : 'native';
    const label = `${functionName || '(anonymous)'}  ${where}`;
    totals.set(label, (totals.get(label) ?? 0) + Math.max(0, deltas[i] ?? 0) / 1000);
  }
  return [...totals].map(([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms);
}
