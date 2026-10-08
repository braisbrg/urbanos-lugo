/**
 * Every screen and every state of the app, against WCAG 2.2 at levels A and AA and against
 * this project's own bar.
 *
 *   pnpm build && PORT=3002 pnpm start     # in another terminal
 *   pnpm run audit:browser                 # the whole matrix
 *   pnpm run audit:browser quick           # phone, Galician, both themes: for an edit loop
 *
 * The matrix is the app as people meet it: a phone and a desktop, Galician, Spanish and
 * English, light and dark, each state reached the way a person reaches it -- a search, an
 * open stop, the QR link, a planned trip, the ride screen, every dialog, the night, the
 * notices with the server down and with no network at all. In each one:
 *
 *   axe-core, every rule tagged WCAG 2.0, 2.1 or 2.2 at A or AA;
 *   the contrast of every text, its opacity and the backdrop it really sits on, resolved by
 *   painting the colour to a canvas (the app is written in oklch() and a regex over rgb()
 *   silently scores 1.00 everywhere);
 *   every control named, and named with the words it shows (2.5.3, which axe leaves off);
 *   targets of 24 px or their spacing (2.5.8), and 44 px, which is this project's own bar;
 *   reflow at 320 px (1.4.10), text at 200 % (1.4.4) and the text-spacing overrides
 *   (1.4.12): sideways scroll, and words cut by an ellipsis, a line clamp or the edge;
 *   a real Tab through every focusable thing: the focus has to show (2.4.7), with 3:1 for
 *   an outline (1.4.11), and not sit entirely behind something (2.4.11); nothing reachable
 *   only with a pointer (2.1.1), no way in without a way out (2.1.2);
 *   the page's title, its lang, one <h1>, the same navigation in the same order (3.2.3);
 *   what a state has to announce, announced (4.1.3);
 *   and the console, per fresh load.
 *
 * Then the things that need a sequence rather than a state: the map's hover labels have to
 * stay under the pointer and leave on Escape (1.4.13), the map has to move without a drag
 * (2.5.7), a pressed button has to look pressed in forced colours, nothing may keep moving
 * under reduced motion, and the app has to draw with site data refused.
 *
 * Nothing here reads anybody else's server. Every request that leaves the host being
 * audited is refused at the browser, the two API answers are fixtures, and the page's
 * clock is pinned (a Tuesday at 09:12, or 03:00 for the night), so a run is the same at any
 * hour and on any machine, and can run on every push. The basemap's tiles are refused with
 * the rest: the map is measured for its controls, never its picture.
 *
 * Exits 1 on any WCAG finding, any state not reached and any check that proved nothing;
 * the 44 px and 12 px bars are this project's own and are printed, not gated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BASE, findChromium, launch, PHONE, withBrowser, type Browser, type Session } from './cdp';
import { sleep } from './lib';
import { gl } from '../src/i18n/gl';
import { es } from '../src/i18n/es';
import { en } from '../src/i18n/en';
import { BUS_LINES, BUS_STOPS, LUGO_CENTER } from '../src/data/transitData';

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };

type Lang = 'gl' | 'es' | 'en';
type Theme = 'light' | 'dark';

/**
 * What a finding can be, and the success criterion it answers to. `size` and `target44`
 * are this project's own bar, stricter than WCAG, and are reported rather than gated.
 */
const KINDS = {
  axe: 'axe-core rule',
  contrast: '1.4.3 contrast',
  target: '2.5.8 target size',
  name: '4.1.2 name',
  label: '2.5.3 label in name',
  alt: '1.1.1 text alternative',
  overflow: '1.4.10 / 1.4.4 / 1.4.12 reflow',
  cut: '1.4.4 / 1.4.10 / 1.4.12 text out of sight',
  lang: '3.1.1 language',
  headings: '1.3.1 one <h1>',
  title: '2.4.2 page title',
  nav: '3.2.3 consistent navigation',
  focus: '2.4.7 / 2.4.11 / 1.4.11 focus',
  keyboard: '2.1.1 / 2.1.2 / 2.4.3 keyboard',
  status: '4.1.3 / 3.3.1 announced',
  hover: '1.4.13 content on hover',
  drag: '2.5.7 dragging',
  forced: 'forced colours (1.4.1 / 1.4.11)',
  motion: '2.2.2 / 2.3 / reduced motion',
  console: 'console',
  reach: 'state not reached',
  size: 'house bar: text under 12 px',
  target44: 'house bar: target under 44 px',
  room: 'house bar: under 48 px left between the bars',
} as const;
type Kind = keyof typeof KINDS;
const HOUSE: Kind[] = ['size', 'target44', 'room'];

interface Finding {
  kind: Kind;
  where: string;
  detail: string;
}

/* ------------------------------------------------------------------------------------- */
/* The page, prepared before any of its own script runs                                  */
/* ------------------------------------------------------------------------------------- */

const DAY = new Date(2026, 8, 29, 9, 12).getTime(); // a Tuesday, mid-morning, every line running
const NIGHT = new Date(2026, 8, 29, 3, 0).getTime(); // the same day before the first bus

/**
 * Read from the address's fragment, then removed from it, before the app's own script: the
 * clock, the stored data, the location the phone would report and the language. One
 * navigation per state instead of two, and nothing for the app to see but the result.
 * Geolocation is faked in the page rather than granted to the browser, because the passes
 * run side by side and a permission is the browser's, shared by every page in it.
 */
const PREPARE = `(() => {
  const at = location.hash.indexOf('#audit=');
  if (at < 0) return;
  const set = JSON.parse(decodeURIComponent(location.hash.slice(at + 7)));
  history.replaceState(history.state, '', location.pathname + location.search);
  const Real = Date;
  let offset = set.clock - Real.now();
  // A setup can move the clock on: the ride asks whether the bus was caught only once its
  // departure has gone by, and the pulse of the next stop exists only on the bus.
  window.__auditLater = (ms) => { offset += ms; };
  class Pinned extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); } static now() { return Real.now() + offset; } }
  window.Date = Pinned;
  try { localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(set.stored)) localStorage.setItem(k, v); } catch (e) {}
  const where = set.geo === 'granted' ? { coords: { latitude: set.at[0], longitude: set.at[1], accuracy: 12 }, timestamp: Real.now() } : null;
  const answer = (ok, fail) => setTimeout(() => (where ? ok(where) : fail && fail({ code: 1, message: 'denied' })), 60);
  navigator.geolocation.getCurrentPosition = (ok, fail) => answer(ok, fail);
  navigator.geolocation.watchPosition = (ok, fail) => { answer(ok, fail); return 1; };
  navigator.geolocation.clearWatch = () => {};
  if (navigator.permissions) {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && d.name === 'geolocation' ? Promise.resolve({ state: set.geo === 'granted' ? 'granted' : 'prompt', addEventListener() {}, removeEventListener() {} }) : query(d));
  }
})();`;

interface Prepared {
  clock: number;
  stored: Record<string, string>;
  geo: 'granted' | 'denied' | 'none';
  at: [number, number];
}

const busiest = [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length);
/** Two saved stops, a saved line and a stop seen recently: what a regular rider's phone holds. */
const REGULAR = {
  urbanos_lugo_fav_stops: JSON.stringify([busiest[0].id, busiest[1].id]),
  urbanos_lugo_fav_lines: JSON.stringify([BUS_LINES[0].id]),
  'urbanos-lugo-recent-stops': JSON.stringify([busiest[2].id]),
};

/* ------------------------------------------------------------------------------------- */
/* The two API answers, as fixtures                                                      */
/* ------------------------------------------------------------------------------------- */

type Api = 'incidents' | 'quiet' | 'down' | 'offline' | 'slow';

const iso = new Date(DAY).toISOString();
/** An operator notice written out line by line, and a council press note: every branch of the notices UI. */
const INCIDENTS = {
  status: 'active_incidents',
  lastSyncTime: iso,
  sourceUrl: 'https://buslugo.com',
  message: '',
  alerts: [
    {
      id: 'fixture-operator',
      title: 'Desvíos provisionales por obras',
      description: 'Del 28 de septiembre al 3 de octubre',
      severity: 'warning',
      linesAffected: ['1.2', '3.1', '3.2', '5ES', '7', '8', '11'],
      date: iso,
      active: true,
      source: 'operator',
      sections: [
        { heading: 'Línea 1.2 : Campus USC – HULA', lines: ['1.2'], paragraphs: ['No efectuará parada provisionalmente en dos postes del recorrido.'] },
        { heading: 'Resto de líneas', lines: [], paragraphs: ['Sin cambios.'] },
      ],
    },
    {
      id: 'fixture-council',
      title: 'Corte de tráfico por unha proba deportiva',
      description: 'O domingo pola mañá, no centro.',
      severity: 'info',
      linesAffected: [],
      date: iso,
      active: true,
      source: 'concello',
      link: 'https://concellodelugo.gal/',
    },
  ],
};
const QUIET = { status: 'operational_normal', lastSyncTime: iso, sourceUrl: 'https://buslugo.com', message: '', alerts: [] };
const AGORA = { code: 'uilP', departures: [{ line: '6', towards: 'HULA', minutes: 4 }, { line: 'AVENIDA', towards: 'Estación', minutes: 12 }], fetchedAt: iso };

const audited = new URL(BASE).host;

/**
 * Every request the page makes goes through here. Its own host is let through, the API is
 * answered from the fixtures, and anything else is refused. Service workers are bypassed so
 * no request can leave through one.
 */
async function guard(page: Session, mode: () => Api): Promise<void> {
  await page.send('Network.setBypassServiceWorker', { bypass: true });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  page.on('Fetch.requestPaused', (p) => {
    const requestId = p.requestId as string;
    const url = new URL((p.request as { url: string }).url);
    const send = (status: number, body: unknown) =>
      void page
        .send('Fetch.fulfillRequest', {
          requestId,
          responseCode: status,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify(body)).toString('base64'),
        })
        .catch(() => undefined);
    if (url.host !== audited) return void page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => undefined);
    const m = mode();
    if (url.pathname.endsWith('/alerts.json') && m === 'offline') return void page.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => undefined);
    if (!url.pathname.includes('/api/')) return void page.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
    if (m === 'offline') return void page.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => undefined);
    if (m === 'down') return send(500, { error: 'fixture' });
    if (url.pathname.includes('/agora')) return send(200, AGORA);
    if (m === 'slow') return void setTimeout(() => send(200, INCIDENTS), 3000);
    send(200, m === 'quiet' ? QUIET : INCIDENTS);
  });
}

/* ------------------------------------------------------------------------------------- */
/* What is measured in a state                                                           */
/* ------------------------------------------------------------------------------------- */

/** Shared by the probes: colours through a canvas, the backdrop behind an element, a label for a report. */
const HELPERS = `
  const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  paint.canvas.width = paint.canvas.height = 1;
  const cache = new Map();
  /** Any CSS colour -> [r,g,b,a], via the renderer rather than a regex. */
  const rgba = (css) => {
    if (cache.has(css)) return cache.get(css);
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = '#000';
    paint.fillStyle = css;
    const resolved = paint.fillStyle;
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = resolved;
    paint.fillRect(0, 0, 1, 1);
    const d = paint.getImageData(0, 0, 1, 1).data;
    const out = [d[0], d[1], d[2], d[3] / 255];
    cache.set(css, out);
    return out;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** The colour actually behind an element: walk up until something is opaque. */
  const backdrop = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement.parentElement) {
      const bg = rgba(getComputedStyle(node).backgroundColor);
      if (bg[3] > 0) acc = acc === null ? bg.slice() : over(acc, bg).concat(1);
      if (acc && acc[3] >= 0.999) return acc.slice(0, 3);
      node = node.parentElement;
    }
    return acc ? acc.slice(0, 3) : [255, 255, 255];
  };
  const label = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
      : '';
    const text = ((el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34);
    return el.tagName.toLowerCase() + id + cls + (text ? ' "' + text + '"' : '');
  };
  const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
  /** Words, with accents, case and punctuation gone: how voice control and the eye compare labels. */
  const words = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
`;

/**
 * One state, measured once per theme. Everything a static look can find: the colours, the
 * sizes, the names and the shape of the page.
 */
const PROBE = `async function (expectLang) {
  ${HELPERS}

  /**
   * How much of an element the eye actually gets: its own opacity times every
   * ancestor's. A muted caption at opacity .6 measured at full strength scored 5.5 and
   * showed 3.6, and this probe called it fine. Disabled controls are left at 1, because
   * an inactive control has no contrast requirement and its dimming is the point.
   */
  const opacityOf = (el) => {
    let o = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true') return 1;
      o *= parseFloat(getComputedStyle(node).opacity);
    }
    return o;
  };

  /**
   * The name a screen reader would announce, close enough to the accname algorithm to
   * catch the real cases: aria-labelledby, aria-label, a <label>, the text and alt text
   * inside, title, and for a text field its placeholder as the last resort.
   */
  const nameOf = (el) => {
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const t = ids.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    if (/^(input|select|textarea)$/i.test(el.tagName)) {
      const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
      const lbl = byFor || el.closest('label');
      const t = lbl ? (lbl.textContent || '').trim() : '';
      if (t) return t;
      return (el.getAttribute('title') || el.getAttribute('placeholder') || '').trim();
    }
    const inner = [...el.querySelectorAll('img[alt], [aria-label]')]
      .filter((n) => !n.closest('[aria-hidden="true"]'))
      .map((n) => (n.getAttribute('alt') || n.getAttribute('aria-label') || '').trim())
      .join(' ');
    // The words a screen reader gets, so without what is hidden from it: the menu button with
    // its label taken off still "had a name" here, the count in its badge, which is aria-hidden.
    let words = '';
    const walk = (n) => {
      if (n.nodeType === 3) words += n.textContent;
      else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true') for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return (words + ' ' + inner + ' ' + (el.getAttribute('title') || '')).trim();
  };

  /** The words a control shows: everything rendered inside it, screen-reader text left out. */
  const shownWords = (el) => {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += ' ' + n.textContent; return; }
      if (n.nodeType !== 1) return;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || n.classList.contains('sr-only')) return;
      for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return words(out);
  };

  const seen = new Set();
  const findings = [];
  const push = (kind, el, detail) => {
    const key = kind + '|' + label(el) + '|' + detail;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, where: label(el), detail });
  };
  const contrastOf = (el, colour, size, weight, what) => {
    const bg = backdrop(el);
    const raw = rgba(colour);
    const o = opacityOf(el);
    const fg = over([raw[0], raw[1], raw[2], raw[3] * o], bg);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    const detail = what + colour + (o < 1 ? ' at opacity ' + o.toFixed(2) : '') + ' on rgb(' + bg.map(Math.round).join(',') + '): ' + got.toFixed(2) + ' of ' + need;
    return { got, need, detail };
  };

  // Proof the probe is looking: a clean report has to come with a count and the closest
  // thing to a failure it found, or it is indistinguishable from a probe that broke.
  let measured = 0;
  let named = 0;
  let tightest = { ratio: Infinity, where: '', detail: '' };

  // The map's picture is not measured; its controls and a popup laid over it are.
  const onCanvas = (el) => !!el.closest('.leaflet-container') && !el.closest('.leaflet-control-container, .leaflet-popup');
  // Visually hidden until focused, so its 1x1 box is the point rather than a defect.
  const offscreen = (el) => !!el.closest('.sr-only');
  const targets = [];

  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    const tag = el.tagName.toLowerCase();
    const hiddenFromAt = !!el.closest('[aria-hidden="true"], [inert]');

    // Text: only the element that directly owns it, so a wrapper is not blamed twice.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // A field's text and its placeholder have no text node to own, so they were never
    // measured: the search box, the two planner fields and their hint text all scored
    // nothing. The placeholder is read through its pseudo-element.
    const field = /^(input|textarea)$/.test(tag) && !/^(checkbox|radio|range|hidden|submit|button)$/.test(el.type || '');
    const texts = [];
    if (own && !onCanvas(el)) texts.push({ colour: style.color, what: '' });
    if (field) {
      if (el.value) texts.push({ colour: style.color, what: 'typed text ' });
      if (el.getAttribute('placeholder') && !el.value) texts.push({ colour: getComputedStyle(el, '::placeholder').color, what: 'placeholder ' });
    }
    for (const t of texts) {
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      if (size < 12) push('size', el, size.toFixed(1) + ' px');
      const { got, need, detail } = contrastOf(el, t.colour, size, weight, t.what);
      measured++;
      // Held against the body-text bar for reporting, so a heading that only clears the
      // large-text bar still shows up as the tightest thing on the screen.
      if (got < tightest.ratio) tightest = { ratio: got, where: label(el), detail };
      if (got < need) push('contrast', el, detail);
    }

    // Touch targets. The roles are the ones this app hands out; a div React made
    // clickable with no role is invisible here and to a screen reader alike, which is the
    // same defect, and the pointer check below is where it would show.
    const role = el.getAttribute('role') || '';
    const tappable =
      /^(button|a|input|select|textarea|summary|label)$/.test(tag) ||
      /^(button|link|tab|menuitem|option|checkbox|switch|radio)$/.test(role) ||
      el.hasAttribute('tabindex');
    if (tappable && !onCanvas(el) && !offscreen(el) && !hiddenFromAt && el.getAttribute('tabindex') !== '-1' && !(tag === 'a' && !el.hasAttribute('href'))) {
      // A link inside a sentence is exempt from 2.5.8; it is still under this project's bar.
      const inline = tag === 'a' && style.display === 'inline' && [...el.parentElement.childNodes].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim());
      targets.push({ el, box, inline });
    }

    // What a screen reader would announce for a control. An icon-only button with no
    // aria-label reads as "button", a link around an image as "link", a field with no
    // label as "edit text" -- and each of those looks perfectly fine on screen.
    const control =
      /^(button|select|textarea|summary)$/.test(tag) || (tag === 'a' && el.hasAttribute('href')) ||
      (tag === 'input' && !/^(hidden)$/.test(el.type || '')) ||
      /^(button|link|tab|menuitem|checkbox|switch|radio|textbox|searchbox|combobox)$/.test(role);
    if (control && !hiddenFromAt && !onCanvas(el)) {
      named++;
      if (!nameOf(el)) push('name', el, 'no accessible name');
      // 2.5.3: a control named apart from what it shows has to contain what it shows, or
      // "click 7" said to voice control finds nothing on a chip that reads 7.
      if ((el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) && !/^(input|select|textarea)$/.test(tag)) {
        const shown = shownWords(el);
        // Bracketed words out of the name first, as axe does: "Avisos (1)" does not contain the
        // 1 a badge shows, for a checker or for voice control software that reads it the same way.
        const name = words(nameOf(el).replace(/\\([^()]*\\)/g, ' '));
        if (shown && !(' ' + name + ' ').includes(' ' + shown + ' ')) push('label', el, 'shows "' + shown + '" but is named "' + name + '"');
      }
    }
    if (tag === 'img' && !hiddenFromAt && !el.hasAttribute('alt')) push('alt', el, (el.getAttribute('src') || '').split('/').pop() || 'img');

    // 2.1.1: something that answers a pointer and not the keyboard. The hand cursor is how
    // the app says "this does something"; under it there has to be a control. The map's
    // canvas is the one place a pointer does more, and its stops are lists elsewhere.
    if (style.cursor === 'pointer' && !onCanvas(el) && !el.closest(FOCUSABLE + ', label') && getComputedStyle(el.parentElement || el).cursor !== 'pointer') {
      push('keyboard', el, 'a pointer target with no keyboard way in');
    }
  }

  // 2.5.8: 24 by 24, or room enough that a 24 px circle on it touches no other target.
  const centre = (b) => [b.left + b.width / 2, b.top + b.height / 2];
  const distToBox = ([x, y], b) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
  for (const t of targets) {
    const side = Math.min(t.box.width, t.box.height);
    if (side < 44) push('target44', t.el, Math.round(t.box.width) + 'x' + Math.round(t.box.height));
    // A box inside its <label> is pressed by pressing the label: the label is the target.
    if (side >= 24 || t.inline || (t.el.tagName === 'INPUT' && t.el.closest('label'))) continue;
    const c = centre(t.box);
    const crowded = targets.some((o) => {
      if (o === t || o.el.contains(t.el) || t.el.contains(o.el)) return false;
      if (distToBox(c, o.box) < 12) return true;
      return Math.min(o.box.width, o.box.height) < 24 && Math.hypot(c[0] - centre(o.box)[0], c[1] - centre(o.box)[1]) < 24;
    });
    if (crowded) push('target', t.el, Math.round(t.box.width) + 'x' + Math.round(t.box.height) + ', and its 24 px circle reaches another target');
  }

  // The page as a whole, once per state.
  const root = document.documentElement;
  const overX = root.scrollWidth - root.clientWidth;
  if (overX > 1) push('overflow', document.body, 'the page is ' + overX + ' px wider than the viewport');
  // The screens scroll inside <main>, not the document, so a block wider than the phone
  // never reaches the root's scrollWidth: the planner's form once ran 200 px past the
  // right edge of a 375 px phone and this audit reported overflow 0.
  const mainEl = document.querySelector('main');
  const overMain = mainEl ? mainEl.scrollWidth - mainEl.clientWidth : 0;
  if (overMain > 1) push('overflow', mainEl, 'the screen is ' + overMain + ' px wider than its scroller');
  // Nor downwards: <main> is the only thing that scrolls, so a page taller than the screen
  // scrolls the bars with it. The lines tab once made the page 1,392 px taller, through the
  // screen-reader text of its cards placed against the page, and a desktop scrollbar
  // narrowed the bottom bar every time the tab opened.
  const overY = root.scrollHeight - root.clientHeight;
  if (overY > 1) push('overflow', document.body, 'the page is ' + overY + ' px taller than the viewport, and scrolls under its bars');
  const lang = (root.getAttribute('lang') || '').toLowerCase();
  if (lang !== expectLang) push('lang', root, '<html lang="' + lang + '">, the app speaks ' + expectLang);
  const h1s = document.querySelectorAll('h1').length;
  if (h1s !== 1) push('headings', document.body, h1s + ' <h1> elements');
  if (!document.title.trim()) push('title', document.body, 'the page has no title');
  // The navigation, in its order, wherever it is: 3.2.3 compares it across the states. By
  // where each link goes, since the Ruta link rightly adds "trip in progress" to its words.
  const nav = [...document.querySelectorAll('nav a[href]')].filter((a) => a.getClientRects().length).map((a) => new URL(a.href).pathname).join(' | ');

  return { findings, measured, named, tightest, title: document.title, nav };
}`;

/**
 * Words the reader cannot see, which no sideways scroll reports: inside <main>, which
 * clips, a name can be an ellipsis, spill over its neighbour, sit past the edge or be cut
 * off by a line clamp, and the page stays exactly as wide as the screen. A line's name was
 * "R…" at 200 %, and a route option printed its warning over its minutes. Judged on blocks
 * that hold words themselves; screen-reader text and the map clip on purpose.
 */
const LAYOUT = `async function (how) {
  const root = document.documentElement;
  let undo = () => {};
  if (how === 'text200') {
    root.style.fontSize = '200%';
    undo = () => { root.style.fontSize = ''; };
  }
  if (how === 'spacing') {
    // The four overrides of 1.4.12, as a reader's own style sheet would set them.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    undo = () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet); };
  }
  await new Promise((r) => setTimeout(r, 450));
  const applied = how !== 'spacing' || getComputedStyle(document.body).letterSpacing !== 'normal';
  const links = [...document.querySelectorAll('nav a[href]')].filter((a) => a.getBoundingClientRect().width > 0);
  const off = links.filter((a) => { const b = a.getBoundingClientRect(); return b.left < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1; }).length;
  const main = document.querySelector('main');
  const hasWords = (el) => [...el.childNodes].some((n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && getComputedStyle(n).display === 'inline' && n.textContent.trim()));
  const sideScroller = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { if (/auto|scroll/.test(getComputedStyle(n).overflowX) && n.scrollWidth > n.clientWidth + 1) return true; } return false; };
  const cut = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || el.closest('.sr-only, [aria-hidden="true"], [inert], .leaflet-container, .maplibregl-map, svg, input, textarea')) continue;
    const style = getComputedStyle(el);
    if (style.display === 'inline' || style.display === 'contents' || style.visibility === 'hidden') continue;
    const words = '"' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40) + '"';
    const over = el.scrollWidth - el.clientWidth;
    const past = Math.round(el.getBoundingClientRect().right - innerWidth);
    const clamped = style.webkitLineClamp && style.webkitLineClamp !== 'none' && el.scrollHeight - el.clientHeight > 1;
    if (style.textOverflow === 'ellipsis' && over > 1) cut.push({ words, how: 'cut by an ellipsis', px: over });
    else if (clamped) cut.push({ words, how: 'cut by a line clamp', px: el.scrollHeight - el.clientHeight });
    else if (hasWords(el) && style.overflowX === 'visible' && over > 1) cut.push({ words, how: 'spilling out of its box', px: over });
    else if (hasWords(el) && past > 1 && !sideScroller(el)) cut.push({ words, how: 'past the right edge', px: past });
  }
  const out = {
    applied,
    over: root.scrollWidth - root.clientWidth,
    overMain: main ? main.scrollWidth - main.clientWidth : 0,
    mainHeight: main ? main.clientHeight : 0,
    nav: links.length,
    off,
    cut,
  };
  undo();
  return out;
}`;

interface Layout {
  applied: boolean;
  over: number;
  overMain: number;
  mainHeight: number;
  nav: number;
  off: number;
  cut: { words: string; how: string; px: number }[];
}

/** One layout, read and reported in the words of the criterion it answers to. */
function layoutFindings(got: Layout, sc: string, condition: string): Finding[] {
  const out: Finding[] = [];
  if (!got.applied) out.push({ kind: 'reach', where: condition, detail: 'the override never reached the page, so this proved nothing' });
  if (got.over > 1) out.push({ kind: 'overflow', where: 'body', detail: `${sc}: ${condition}, the page is ${got.over} px wider than the viewport` });
  if (got.overMain > 1) out.push({ kind: 'overflow', where: 'main', detail: `${sc}: ${condition}, the screen is ${got.overMain} px wider than its scroller` });
  if (got.off > 0) out.push({ kind: 'overflow', where: 'nav', detail: `${sc}: ${condition}, ${got.off} of ${got.nav} navigation links sit off screen` });
  for (const c of got.cut) out.push({ kind: 'cut', where: c.words, detail: `${sc}: ${condition}, ${c.how} (${c.px} px)` });
  return out;
}

/** axe-core, injected through CDP (which the page's policy does not govern), every WCAG A and AA rule. */
async function axe(page: Session): Promise<{ findings: Finding[]; passed: number; review: string[] }> {
  await page.evaluate(AXE_SOURCE);
  const r = await page.evaluate<{ violations: { id: string; help: string; tags: string[]; nodes: { target: string[]; failureSummary?: string }[] }[]; passed: number; review: string[] }>(
    `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations', 'incomplete'] })
       .then((r) => ({ violations: r.violations.map((v) => ({ id: v.id, help: v.help, tags: v.tags, nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })) })),
                       passed: r.passes.length, review: r.incomplete.map((i) => i.id + ' x' + i.nodes.length) }))`,
  );
  const findings: Finding[] = [];
  for (const v of r.violations) {
    const sc = v.tags.filter((t) => /^wcag\d{3,4}$/.test(t)).map((t) => t.slice(4).split('').join('.')).join(', ');
    // A marker on a map sits where the thing it marks is: 2.5.8 exempts a target whose size
    // and place are essential to what it conveys, and a bus or a pin moved apart from its
    // neighbours to make room would be a lie about where it is.
    const nodes = v.id === 'target-size' ? v.nodes.filter((n) => !n.target.join(' ').includes('leaflet-marker-icon')) : v.nodes;
    for (const n of nodes) findings.push({ kind: 'axe', where: n.target.join(' '), detail: `${v.id} (${sc}): ${v.help}. ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 220)}` });
  }
  return { findings, passed: r.passed, review: r.review };
}

/* ------------------------------------------------------------------------------------- */
/* The focus, moved with the Tab key                                                     */
/* ------------------------------------------------------------------------------------- */

/** One key, down and up, through the browser's own focus handling. */
async function press(page: Session, key: string, code: number, modifiers = 0): Promise<void> {
  const event = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

/**
 * What every focusable thing looks like before the focus reaches it: the element, its
 * parent and its grandparent, because a field inside a bordered box shows its focus on the
 * box. The comparison afterwards is the whole test of 2.4.7: if nothing the eye can see
 * changed, there is no focus indicator, whatever the style sheet says.
 */
/**
 * Nothing focused while the "before" is taken: a control the setup had just pressed still
 * wore its ring, and compared with itself it showed no change. Not blur(): a time field keeps
 * the focus in its hour part and wore the ring through it. The focus goes to a stand-in at
 * the top of the page, which is then taken out, so the first Tab starts from the top. Run on
 * its own, before RECORD and a pause: a list that closes when the focus leaves it closes now,
 * and its rows are not counted as Tab stops the moment before they are gone.
 */
const UNFOCUS = `function () {
  const standIn = document.createElement('span');
  standIn.tabIndex = -1;
  document.body.prepend(standIn);
  standIn.focus({ preventScroll: true });
  standIn.remove();
}`;

const RECORD = `function () {
  ${HELPERS}
  for (const an of document.getAnimations()) { try { an.finish(); } catch (e) {} }
  const modal = document.querySelector('[role=dialog][aria-modal=true]');
  const scope = modal || document;
  // What can be seen, not what is declared: an outline whose style is none has a width and a
  // colour that draw nothing. The search fields got exactly that -- the focus rule set 2 px of
  // accent and a utility set the style to none -- and a raw comparison called it a change.
  const sig = (el) => [el, el.parentElement, el.parentElement && el.parentElement.parentElement].filter(Boolean).map((n) => {
    const s = getComputedStyle(n);
    const outline = s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0 ? 'none' : [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset].join(' ');
    const border = ['Top', 'Right', 'Bottom', 'Left'].map((side) => (parseFloat(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] !== 'none' ? s['border' + side + 'Width'] + ' ' + s['border' + side + 'Color'] : '-')).join(',');
    return [outline, s.boxShadow, border, s.backgroundColor, s.textDecorationLine, s.color].join('|');
  }).join('#');
  // Inside a closed <details> a control still has a box (the panel folds by height) but no
  // Tab stop, which is right; only its summary is reachable.
  const folded = (el) => { const d = el.closest('details:not([open])'); return !!d && !el.matches('summary') && el.closest('summary') === null; };
  const list = [...scope.querySelectorAll(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]') && !folded(el));
  window.__auditSig = new Map(list.map((el) => [el, sig(el)]));
  window.__auditList = list;
  window.__auditSigOf = sig;
  window.__auditRun = [];
  return { count: list.length, modal: !!modal, visible: document.visibilityState };
}`;

/** Where the focus is after a Tab, and what is wrong with how it shows. */
const CHECK = `function () {
  ${HELPERS}
  for (const an of document.getAnimations()) { try { an.finish(); } catch (e) {} }
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return { at: -1, where: 'body', issues: [] };
  const issues = [];
  const modal = document.querySelector('[role=dialog][aria-modal=true]');
  if (modal && !modal.contains(a)) issues.push('2.4.3: focus left the open dialog for ' + label(a));
  const before = window.__auditSig.get(a);
  const now = window.__auditSigOf(a);
  if (before !== undefined && before === now) issues.push('2.4.7: nothing visible changes when it takes focus (' + now.split('#')[0].slice(0, 90) + (a.matches(':focus-visible') ? ', :focus-visible' : ', not :focus-visible') + ')');
  const s = getComputedStyle(a);
  if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) {
    const got = ratio(rgba(s.outlineColor).slice(0, 3), backdrop(a.parentElement || a));
    if (got < 3) issues.push('1.4.11: the focus outline is ' + got.toFixed(2) + ':1 against what it sits on');
  }
  // 2.4.11: not entirely hidden. Five points across it; if none of them is the element or
  // inside it, something the page drew is on top of all of it.
  const b = a.getBoundingClientRect();
  if (b.width && b.height) {
    if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) issues.push('2.4.11: focused but off screen');
    else {
      const inset = (v, lo, hi) => Math.min(Math.max(v, lo + 1), hi - 1);
      const pts = [[b.left + b.width / 2, b.top + b.height / 2], [b.left + 2, b.top + 2], [b.right - 2, b.top + 2], [b.left + 2, b.bottom - 2], [b.right - 2, b.bottom - 2]]
        .map(([x, y]) => [inset(x, 0, innerWidth), inset(y, 0, innerHeight)]);
      const hits = pts.map(([x, y]) => document.elementFromPoint(x, y));
      const visible = hits.some((h) => h && (h === a || a.contains(h) || h.contains(a)));
      if (!visible) issues.push('2.4.11: entirely behind ' + (hits[0] ? label(hits[0]) : 'nothing'));
    }
  }
  // 1.3.2 / 2.4.3: Tab follows the page's order, and CSS order can draw a block above one that
  // comes before it. The map's sheet on a phone did: the focus went down past locate and centre
  // and then back up to the filters drawn above them. So a stop must not sit above one reached
  // before it in the same column, in the page's own coordinates (scrolled boxes put back) --
  // any one, not only the last: centre is in the other column of its row, and judged against
  // it alone the climb back to the filters passed. Not judged: what is pinned (fixed, sticky),
  // which has no place in the flow, and a map's markers, which are placed by geography.
  const at = window.__auditList.indexOf(a);
  const pinned = (el) => {
    if (el.closest('.leaflet-container')) return true;
    for (let n = el; n && n !== modal && n !== document.body; n = n.parentElement) if (/fixed|sticky/.test(getComputedStyle(n).position)) return true;
    return false;
  };
  let here = null;
  if (b.width && b.height && !pinned(a)) {
    let y = b.top, x = b.left;
    for (let n = a.parentElement; n; n = n.parentElement) { y += n.scrollTop; x += n.scrollLeft; }
    here = { at, top: y, left: x, right: x + b.width, label: label(a) };
  }
  // The run so far: it starts again where the order breaks (a wrap, a stop opened on the way,
  // something pinned).
  const run = window.__auditRun;
  // The same stop judged again, after a wait: judged against the ones before it, not itself.
  if (at >= 0 && run.length && run[run.length - 1].at === at) run.pop();
  const last = run[run.length - 1];
  if (!here || !last || at < 0 || at !== last.at + 1) run.length = 0;
  else {
    const over = run.find((s) => here.top < s.top - 8 && here.left < s.right && here.right > s.left);
    if (over) issues.push('2.4.3: this Tab stop is drawn ' + Math.round(over.top - here.top) + ' px above ' + over.label + ', which the focus reached before it, in the same column');
  }
  if (here) run.push(here);
  return { at, where: label(a), issues, map: !!a.closest('.leaflet-container') };
}`;

/**
 * A real Tab, as many times as there are things to reach and then some, through the
 * browser's own focus handling. Every stop is checked as it is reached; the ones never
 * reached are the 2.1.1 finding, and an open dialog has to keep the focus and give it back
 * on Escape.
 */
async function traverse(page: Session, dialog: boolean): Promise<{ findings: Finding[]; reached: number; of: number }> {
  const findings: Finding[] = [];
  await page.call(UNFOCUS);
  await sleep(300);
  const { count, modal, visible } = await page.call<{ count: number; modal: boolean; visible: string }>(RECORD);
  if (visible !== 'visible') findings.push({ kind: 'reach', where: 'page', detail: `the page is ${visible}: focus styles and frames are not what a reader gets` });
  const reached = new Set<number>();
  // Until every recorded stop has had the focus, with room for the ones a focus opens on its
  // way (a field's suggestions are Tab stops too), and a ceiling that a trap would hit.
  for (let i = 0; i < count * 2 + 20 && (reached.size < count || i < count); i++) {
    await press(page, 'Tab', 9);
    await sleep(60);
    let got = await page.call<{ at: number; where: string; issues: string[]; map: boolean }>(CHECK);
    // A marker taking the focus pans the map to itself, in a quarter of a second of Leaflet's
    // own animation: judged before that, every bus off the edge read as hidden. The same wait
    // for what is inside a map's popup, which the map pans into view as the focus goes in.
    if (got.issues.some((i) => i.startsWith('2.4.11')) && got.map) {
      await sleep(600);
      got = await page.call(CHECK);
    }
    // Inside a run Chrome sometimes withholds :focus-visible from a Tab into a time field, away
    // and back again included, where every reproduction outside one, and a screenshot, show it
    // given and the ring drawn. The question 2.4.7 asks is whether a keyboard focus shows, so
    // the state is put on the field the way DevTools' "force :focus-visible" does, and compared
    // again; a control with no focus style still fails.
    if (got.issues.some((i) => i.includes('not :focus-visible'))) {
      await page.send('DOM.getDocument', { depth: 0 });
      const { result } = await page.send<{ result: { objectId: string } }>('Runtime.evaluate', { expression: 'document.activeElement' });
      const { nodeId } = await page.send<{ nodeId: number }>('DOM.requestNode', { objectId: result.objectId });
      await page.send('CSS.enable');
      await page.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
      const forced = await page.call<{ at: number; where: string; issues: string[]; map: boolean }>(CHECK);
      await page.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      got = { ...forced, issues: forced.issues.filter((i) => !i.startsWith('2.4.7')).concat(forced.issues.some((i) => i.startsWith('2.4.7')) ? [`2.4.7: nothing visible changes even with :focus-visible forced on it`] : []) };
    }
    if (got.at >= 0) reached.add(got.at);
    for (const issue of got.issues) findings.push({ kind: issue.startsWith('2.4.3') ? 'keyboard' : 'focus', where: got.where, detail: issue });
  }
  if (count && reached.size < count) {
    const missed = await page.evaluate<string[]>(`window.__auditList.filter((el, i) => !(${JSON.stringify([...reached])}).includes(i)).slice(0, 6).map((el) => el.tagName.toLowerCase() + ' "' + ((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)) + '"')`);
    findings.push({ kind: 'keyboard', where: missed.join(', '), detail: `2.1.1: Tab reached ${reached.size} of ${count} focusable controls` });
  }
  if (dialog && !modal) findings.push({ kind: 'reach', where: 'dialog', detail: 'the dialog had closed before the keyboard reached it' });
  if (dialog && modal) {
    // The focus stays where the keyboard put it. Every open dialog put it back on its first
    // control whenever the page behind it re-rendered -- the map's clock, every 3 s -- so it is
    // left on the second control for longer than that tick and must still be there.
    await press(page, 'Tab', 9);
    await press(page, 'Tab', 9);
    const where = `(() => { const a = document.activeElement; return a ? a.tagName + ' ' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40) : ''; })()`;
    const before = await page.evaluate<string>(where);
    await sleep(3500);
    const later = await page.evaluate<string>(where);
    if (later !== before) findings.push({ kind: 'keyboard', where: before, detail: `2.4.3: with nothing pressed, the focus moved by itself to ${later}` });
    await press(page, 'Escape', 27);
    await sleep(400);
    const after = await page.evaluate<string>(
      `(() => { if (document.querySelector('[role=dialog][aria-modal=true]')) return 'the dialog is still open after Escape';
         const a = document.activeElement; return !a || a === document.body ? 'after Escape the focus fell to the page' : 'ok'; })()`,
    );
    if (after !== 'ok') findings.push({ kind: 'keyboard', where: 'dialog', detail: `2.1.2 / 2.4.3: ${after}` });
  }
  return { findings, reached: reached.size, of: count };
}

/* ------------------------------------------------------------------------------------- */
/* The states                                                                            */
/* ------------------------------------------------------------------------------------- */

/** In the page before every setup: find a control by what it says, type into a field, wait for something. */
const REACH = `
  // Shown, not only laid out: the map's sheet is visibility:hidden while closed and keeps its
  // boxes, and its own close button, "Pechar filtros e capas", came before the button that
  // opens it. Pressed instead, it closed a closed sheet, and the sheet was never audited.
  const all = () => [...document.querySelectorAll('button, a, [role=button], summary')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const seeText = (t) => all().find((e) => ((e.textContent || '').trim() + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase().includes(t.toLowerCase()));
  const byLabel = (t) => all().find((e) => (e.getAttribute('aria-label') || '').toLowerCase().startsWith(t.toLowerCase()));
  /** Opened the way a keyboard opens it: focus on the control, then the activation, so a dialog knows where to give the focus back. */
  const press = (e) => { if (!e) return false; e.focus(); e.click(); return true; };
  const fill = (el, value) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    el.focus();
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await pause(100); } return false; };
`;

/** The handful of interface words the setups look for, in the language of the pass. */
const words = (d: typeof gl) => ({
  menu: d.menu.open,
  favourites: d.favourites.title,
  qr: d.search.qr,
  byLine: d.arrivals.viewByLine,
  atTime: d.arrivals.atTimeSummary,
  onMap: d.arrivals.map,
  locate: d.stopHome.locate,
  buses: d.map.layerBuses,
  stopsLayer: d.map.layerStops,
  routesLayer: d.map.layerRoutes,
  controls: d.map.controls,
  calculate: d.planner.calculate,
  depart: d.planner.timeModes.depart,
  gps: d.planner.useMyLocation,
  start: d.companion.start,
  yesOnIt: d.companion.yesOnIt,
  clearRecent: d.stopHome.clearRecent,
  undoClear: d.planner.undoClear,
});
type Words = ReturnType<typeof words>;
const DICT: Record<Lang, typeof gl> = { gl, es, en };

interface State {
  screen: 'paradas' | 'linhas' | 'mapa' | 'ruta' | 'avisos' | 'tarifas';
  name: string;
  /** In the page; returns true, or what could not be found. Gets the interface words as T. */
  setup?: string;
  query?: string;
  stored?: Record<string, string>;
  geo?: 'granted' | 'denied';
  api?: Api;
  night?: boolean;
  phoneOnly?: boolean;
  desktopOnly?: boolean;
  /** An aria-modal dialog is open: Tab must stay in it, Escape must close it and hand the focus back. */
  dialog?: boolean;
  /** In the page, after the probes: what this state has to announce. Returns the failures. */
  expect?: string;
  /** After the setup, a real tap -- at the centre of the map, or on a bus -- which Leaflet answers and a scripted click does not. */
  tap?: 'mapCentre' | 'bus';
}

const savedBoard = `const card = document.querySelector('main ul li button');
  if (!card) return 'no saved stop on the home screen'; card.click();
  if (!(await until(() => document.querySelector('main h2') && /\\d/.test(document.querySelector('main').textContent)))) return 'the board never drew';
  await pause(500);`;
const planned = `const o = document.getElementById('input-origin-query'), d = document.getElementById('input-dest-query');
  if (!o || !d) return 'no planner fields';
  fill(o, 'Praza Maior'); await pause(500);
  let opt = [...o.parentElement.querySelectorAll('button')].find((b) => /Praza Maior/i.test(b.textContent)); if (opt) { opt.click(); await pause(300); }
  fill(d, 'HULA'); await pause(500);
  opt = [...d.parentElement.querySelectorAll('button')].find((b) => /HULA/i.test(b.textContent)); if (opt) { opt.click(); await pause(300); }
  // Picking a suggestion plans the trip and folds the form, "Calcular ruta" with it: pressed
  // only when it is still there to press.
  const go = seeText(T.calculate); if (go) press(go);
  if (!(await until(() => document.querySelector('main [tabindex="-1"]') && !document.querySelector('[aria-busy="true"]')))) return 'no answer';
  await pause(1200);`;

const STATES: State[] = [
  { screen: 'paradas', name: 'inicio' },
  { screen: 'paradas', name: 'gardadas', stored: REGULAR },
  {
    screen: 'paradas',
    name: 'busca',
    setup: `const i = document.getElementById('site-search'); if (!i) return 'no search box'; fill(i, 'catedral'); await pause(900); return true;`,
    expect: `const s = document.querySelector('header [role=status]'); return s && s.textContent.trim() ? [] : ['the result kinds are not in a live region'];`,
  },
  {
    screen: 'paradas',
    name: 'busca baleira',
    setup: `const i = document.getElementById('site-search'); if (!i) return 'no search box'; fill(i, 'zzqx'); await pause(900); return true;`,
    expect: `const s = document.querySelector('header [role=status]'); return s && s.textContent.trim() ? [] : ['"nothing matches" is not in a live region'];`,
  },
  { screen: 'paradas', name: 'parada', stored: REGULAR, setup: `${savedBoard} return true;` },
  {
    screen: 'paradas',
    name: 'parada por linha',
    stored: REGULAR,
    setup: `${savedBoard} if (!press(seeText(T.byLine))) return 'no by-line toggle'; await pause(500); return true;`,
  },
  {
    screen: 'paradas',
    name: 'parada outra hora',
    stored: REGULAR,
    setup: `${savedBoard} const s = seeText(T.atTime); if (!s) return 'no time disclosure'; s.click(); await pause(300);
      const t = document.querySelector('main input[type=time]'); if (!t) return 'no time field'; fill(t, '23:59'); await pause(700); return true;`,
  },
  { screen: 'paradas', name: 'parada qr', query: '?parada=uilP', setup: `if (!(await until(() => /HULA/.test(document.querySelector('main').textContent)))) return 'the operator block never drew'; return true;` },
  {
    screen: 'paradas',
    name: 'preto',
    geo: 'granted',
    setup: `if (!press(seeText(T.locate))) return 'no locate button'; if (!(await until(() => document.querySelectorAll('main ul li').length > 2))) return 'no nearby list'; await pause(1500); return true;`,
  },
  {
    screen: 'paradas',
    name: 'preto denegado',
    geo: 'denied',
    setup: `if (!press(seeText(T.locate))) return 'no locate button'; if (!(await until(() => document.querySelector('main [role=alert]')))) return 'no error shown'; return true;`,
    expect: `const a = document.querySelector('main [role=alert]'); return a && a.textContent.trim() ? [] : ['the refusal is not announced'];`,
  },
  { screen: 'paradas', name: 'menu', phoneOnly: true, dialog: true, setup: `if (!press(byLabel(T.menu))) return 'no menu button'; await pause(500); return true;` },
  { screen: 'paradas', name: 'favoritos', stored: REGULAR, dialog: true, setup: `if (!press(byLabel(T.favourites))) return 'no favourites button'; await pause(500); return true;` },
  { screen: 'paradas', name: 'favoritos baleiro', dialog: true, setup: `if (!press(byLabel(T.favourites))) return 'no favourites button'; await pause(500); return true;` },
  { screen: 'paradas', name: 'qr', dialog: true, setup: `if (!press(byLabel(T.qr))) return 'no QR button'; await pause(500); return true;` },
  {
    screen: 'paradas',
    name: 'qr erro',
    dialog: true,
    setup: `if (!press(byLabel(T.qr))) return 'no QR button'; await pause(400);
      const i = document.getElementById('qr-manual-input'); if (!i) return 'no code field'; fill(i, 'zzqx');
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(400); return true;`,
    expect: `const i = document.getElementById('qr-manual-input'); const out = [];
      const live = [...document.querySelectorAll('[role=alert], [role=status], [aria-live]')].some((n) => n.textContent.trim());
      if (!live) out.push('the "not found" error is not announced');
      if (!i || i.getAttribute('aria-invalid') !== 'true') out.push('the code field does not say it is invalid');
      const by = i && i.getAttribute('aria-describedby'); if (!by || !document.getElementById(by)) out.push('the error is not tied to the field');
      return out;`,
  },
  { screen: 'linhas', name: 'lista' },
  {
    screen: 'linhas',
    name: 'linha aberta',
    setup: `const c = document.querySelector('main button[id^="line-card-"]'); if (!c) return 'no line card'; c.click(); await pause(1000); return true;`,
  },
  {
    screen: 'linhas',
    name: 'busca baleira',
    setup: `const i = document.getElementById('search-line-input'); if (!i) return 'no line search'; fill(i, 'zzqx'); await pause(500); return true;`,
  },
  { screen: 'mapa', name: 'mapa' },
  // The buses start hidden; switched on, the map carries the sentence that they are the
  // timetable's, and that sentence and its close button are measured like everything else.
  {
    screen: 'mapa',
    name: 'buses',
    setup: `const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => x.textContent.trim() === T.buses);
      if (!b) return 'no buses layer button'; b.click(); await pause(900); return true;`,
  },
  // A bus tapped: its popup, with the line, the next stop and the sentence that says the
  // position is the timetable's, and a button to the line.
  {
    screen: 'mapa',
    name: 'bus aberto',
    setup: `const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => x.textContent.trim() === T.buses);
      if (!b) return 'no buses layer button'; b.click(); await pause(1500); return true;`,
    tap: 'bus',
  },
  { screen: 'mapa', name: 'filtros', phoneOnly: true, dialog: true, setup: `if (!press(seeText(T.controls))) return 'no controls button'; await pause(600); return true;` },
  // A stop opened on the map: the board sends the map to its stop, which is then at the
  // centre, and a click there on Leaflet's canvas is what a tap on the stop is.
  {
    screen: 'paradas',
    name: 'mapa ficha',
    stored: REGULAR,
    dialog: true,
    setup: `${savedBoard} if (!press(byLabel(T.onMap))) return 'no map button'; await pause(2500); return true;`,
    tap: 'mapCentre',
  },
  { screen: 'ruta', name: 'baleiro' },
  {
    screen: 'ruta',
    name: 'suxestions',
    setup: `const o = document.getElementById('input-origin-query'); if (!o) return 'no origin field'; fill(o, 'Praza'); await pause(700);
      if (!o.parentElement.querySelector('button + div button, div.absolute button')) return 'no suggestions'; return true;`,
    expect: `const s = [...document.querySelectorAll('main [role=status]')].some((n) => n.textContent.trim()); return s ? [] : ['the number of suggestions is not announced'];`,
  },
  { screen: 'ruta', name: 'planificada', setup: `${planned} return true;` },
  {
    // 3.3.4 and 2.4.3: "Borrar" wiped the recent routes with no way back, and the button that
    // had the focus went with the list.
    screen: 'ruta',
    name: 'recentes borradas',
    stored: { 'urbanos-lugo-recent-routes': JSON.stringify([{ from: 'Praza Maior', to: 'HULA' }, { from: 'Estación de autobuses', to: 'Campus' }]) },
    setup: `if (!press(all().find((b) => b.textContent.trim() === T.clearRecent))) return 'no button to clear the recent routes'; await pause(400); return true;`,
    expect: `const a = document.activeElement, fails = [];
      if (!a || a.textContent.trim() !== T.undoClear) fails.push('after clearing the recent routes the focus is not on the way back, but on ' + (a ? a.tagName + ' ' + a.textContent.trim().slice(0, 30) : 'nothing'));
      if (![...document.querySelectorAll('main [role=status]')].some((n) => n.textContent.trim())) fails.push('clearing the recent routes is not announced');
      return fails;`,
  },
  { screen: 'ruta', name: 'hora', setup: `if (!press(seeText(T.depart))) return 'no depart-at mode'; await pause(400); return document.querySelector('main input[type=time]') ? true : 'no time field';` },
  {
    screen: 'ruta',
    name: 'sen ruta',
    setup: `const o = document.getElementById('input-origin-query'), d = document.getElementById('input-dest-query'); if (!o || !d) return 'no planner fields';
      fill(o, 'zzqx'); fill(d, 'zzqy'); await pause(300); if (!press(seeText(T.calculate))) return 'no calculate button'; await pause(1500); return true;`,
  },
  {
    screen: 'ruta',
    name: 'gps denegado',
    geo: 'denied',
    setup: `if (!press(byLabel(T.gps))) return 'no GPS button'; if (!(await until(() => document.querySelector('main [role=alert]')))) return 'no refusal shown'; return true;`,
  },
  {
    screen: 'ruta',
    name: 'viaxe',
    geo: 'granted',
    setup: `${planned} const s = all().find((b) => b.textContent.trim() === T.start); if (!s) return 'no ride button'; s.click();
      if (!(await until(() => document.querySelector('main ol')))) return 'the ride screen never drew'; await pause(1200); return true;`,
  },
  {
    // On the bus: the clock forty minutes on, past the departure, and "Si, vou nel" answered.
    // The one screen where a stop pulses; motion() measures 2.2.2 on it.
    screen: 'ruta',
    name: 'a bordo',
    geo: 'granted',
    setup: `${planned} const s = all().find((b) => b.textContent.trim() === T.start); if (!s) return 'no ride button'; s.click();
      if (!(await until(() => document.querySelector('main ol')))) return 'the ride screen never drew';
      window.__auditLater(40 * 60000);
      const yes = () => all().find((b) => b.textContent.trim() === T.yesOnIt);
      if (!(await until(yes, 20000))) return 'the ride never asked whether the bus was caught'; press(yes());
      if (!(await until(() => document.querySelector('.live-dot')))) return 'no stop is next on the bus'; await pause(600); return true;`,
  },
  { screen: 'avisos', name: 'avisos' },
  { screen: 'avisos', name: 'sen avisos', api: 'quiet' },
  { screen: 'avisos', name: 'servidor caido', api: 'down', setup: `await pause(800); return true;` },
  { screen: 'avisos', name: 'sen rede', api: 'offline', setup: `await pause(2500); return true;` },
  {
    screen: 'avisos',
    name: 'comprobando',
    api: 'slow',
    setup: `await pause(3500); const b = document.getElementById('sync-alerts-btn'); if (!b) return 'no refresh button'; b.focus(); b.click(); await pause(300); return true;`,
    expect: `return [...document.querySelectorAll('main [role=status], main [aria-live]')].some((n) => n.textContent.trim()) ? [] : ['the check in progress is not announced'];`,
  },
  { screen: 'tarifas', name: 'tarifas' },
  { screen: 'paradas', name: 'noite', night: true, stored: REGULAR },
  { screen: 'paradas', name: 'noite parada', night: true, stored: REGULAR, setup: `${savedBoard} return true;` },
  { screen: 'ruta', name: 'noite planificada', night: true, setup: `${planned} return true;` },
];

/* ------------------------------------------------------------------------------------- */
/* Running a state                                                                       */
/* ------------------------------------------------------------------------------------- */

interface Pass {
  name: string;
  desktop: boolean;
  lang: Lang;
  themes: Theme[];
  /** Tab through it and the layouts: the two Galician passes, which carry every state. */
  deep: boolean;
}

interface Result {
  pass: string;
  state: string;
  theme: Theme;
  findings: Finding[];
  measured: number;
  named: number;
  tightest: number;
  axePassed: number;
  review: string[];
  title: string;
  nav: string;
  focus?: { reached: number; of: number };
}

const noise = /\[vite\]|React DevTools|Download the React/;
/** What refusing every other host makes the page say, which is this audit's doing and not the app's. */
const refused = /ERR_BLOCKED_BY_CLIENT|ERR_INTERNET_DISCONNECTED|openfreemap|tile\.openstreetmap|Failed to fetch|AJAXError|NetworkError|status code 500|500 \(Internal Server Error\)/;

interface Worker {
  page: Session;
  api: Api;
  logged: string[];
  thrown: string[];
}

async function worker(browser: Browser): Promise<Worker> {
  // Isolated: the pages run side by side and one origin's storage is shared by every page in
  // a context, so one state's preparation cleared another's saved stops and language mid-load.
  const page = await browser.newPage(true);
  const w: Worker = { page, api: 'incidents', logged: [], thrown: page.uncaught() };
  await guard(page, () => w.api);
  await page.onNewDocument(PREPARE);
  // Focus as if the window were in front: :focus-visible is off in a page that thinks it is
  // in the background, and four of these run side by side.
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  page.on('Runtime.consoleAPICalled', (p) => {
    const kind = String(p.type);
    if (kind !== 'error' && kind !== 'warning') return;
    const text = ((p.args as { value?: unknown; description?: string }[]) ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 220);
    if (!noise.test(text)) w.logged.push(`${kind}: ${text}`);
  });
  page.on('Log.entryAdded', (p) => {
    const entry = p.entry as { level: string; text: string; url?: string };
    if (entry.level === 'error' && !refused.test(`${entry.text} ${entry.url ?? ''}`)) w.logged.push(`log: ${entry.text.slice(0, 200)}`);
  });
  await page.send('Log.enable');
  return w;
}

async function runState(w: Worker, pass: Pass, state: State): Promise<Result[]> {
  const { page } = w;
  w.api = state.api ?? 'incidents';
  w.logged.length = w.thrown.length = 0;
  await page.send('Emulation.setDeviceMetricsOverride', pass.desktop ? DESKTOP : PHONE);
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  const prepared: Prepared = {
    clock: state.night ? NIGHT : DAY,
    stored: { ...(state.stored ?? {}), 'urbanos-lugo-lang': pass.lang, 'urbanos-lugo-theme': pass.themes[0] },
    geo: state.geo ?? 'none',
    at: LUGO_CENTER,
  };
  const path = state.screen === 'paradas' ? '' : `${state.screen}/`;
  // Through a blank page: two states on the same address differ only in the fragment, and a
  // fragment change is not a navigation -- no new document, no load event, no preparation.
  await page.goto('about:blank');
  await page.goto(`${BASE}/${path}${state.query ?? ''}#audit=${encodeURIComponent(JSON.stringify(prepared))}`);
  const findings: Finding[] = [];
  try {
    await page.waitFor('document.querySelector("main h1")', 15_000);
  } catch {
    return [{ pass: pass.name, state: label(state), theme: pass.themes[0], findings: [{ kind: 'reach', where: label(state), detail: 'the app never drew' }], measured: 0, named: 0, tightest: Infinity, axePassed: 0, review: [], title: '', nav: '' }];
  }
  await sleep(state.screen === 'mapa' ? 1800 : 900);
  if (state.setup) {
    const got = await page.call<true | string>(`async function (T) {${REACH}${state.setup}}`, words(DICT[pass.lang]));
    if (got !== true) findings.push({ kind: 'reach', where: label(state), detail: String(got) });
    await sleep(500);
  }
  // A setup that says it opened a dialog and did not leaves the page under the dialog's name,
  // and every measure of it passes: the map's sheet did, for as long as the state existed.
  const modalOpen = `!!document.querySelector('[role=dialog][aria-modal=true]')`;
  if (state.dialog && !state.tap && !findings.length && !(await page.evaluate<boolean>(modalOpen))) findings.push({ kind: 'reach', where: label(state), detail: 'no dialog is open after the setup' });
  if (state.tap && !findings.length) {
    // The centre of the map, where the stop the board sent it to sits; or the middle of a bus
    // that is wholly on the map and not under one of the buttons that float on it.
    const box = await page.evaluate<{ x: number; y: number } | null>(
      state.tap === 'mapCentre'
        ? `(() => { const m = [...document.querySelectorAll('.leaflet-container')].find((e) => e.getBoundingClientRect().width > 300); if (!m) return null; const b = m.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`
        : `(() => { const m = [...document.querySelectorAll('.leaflet-container')].find((e) => e.getBoundingClientRect().width > 300); if (!m) return null; const mb = m.getBoundingClientRect();
             for (const bus of document.querySelectorAll('.custom-bus-marker')) { const b = bus.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;
               if (b.left > mb.left + 60 && b.right < mb.right - 60 && b.top > mb.top + 80 && b.bottom < mb.bottom - 80) { const hit = document.elementFromPoint(x, y); if (hit && bus.contains(hit)) return { x, y }; } }
             return null; })()`,
    );
    if (box) {
      await mouse(page, 'mouseMoved', box.x, box.y);
      await mouse(page, 'mousePressed', box.x, box.y);
      await mouse(page, 'mouseReleased', box.x, box.y);
    }
    try {
      // The stop sheet is drawn beside Leaflet's container, inside the map's card, not inside the map.
      await page.waitFor(state.tap === 'mapCentre' ? `document.querySelector('[role=dialog][aria-modal=true]')` : `document.querySelector('.leaflet-popup')`, 5000);
      await sleep(500);
    } catch {
      findings.push({ kind: 'reach', where: label(state), detail: state.tap === 'mapCentre' ? 'the stop sheet never opened' : box ? 'the bus popup never opened' : 'no bus wholly on the map to tap' });
    }
  }

  const results: Result[] = [];
  for (const theme of pass.themes) {
    if (theme !== pass.themes[0]) {
      // The app's own switch does exactly this, without a reload: the class on <html>, which
      // every token and the map's palette follow. Then a pause, because a colour caught
      // mid-transition reads as a contrast failure that nobody sees.
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`);
      await sleep(250);
    }
    await page.evaluate(SETTLE);
    const probe = await page.call<{ findings: Finding[]; measured: number; named: number; tightest: { ratio: number }; title: string; nav: string }>(PROBE, pass.lang);
    const a = await axe(page);
    const own: Finding[] = [...(theme === pass.themes[0] ? findings : []), ...probe.findings, ...a.findings];
    results.push({ pass: pass.name, state: label(state), theme, findings: own, measured: probe.measured, named: probe.named, tightest: probe.tightest.ratio, axePassed: a.passed, review: a.review, title: probe.title, nav: probe.nav });
  }
  const first = results[0];

  if (state.expect) {
    const failed = await page.call<string[]>(`function (T) {${state.expect}}`, words(DICT[pass.lang]));
    for (const f of failed) first.findings.push({ kind: 'status', where: label(state), detail: f });
  }

  // The layouts, in the first theme only: the shape of the page does not change with its colours.
  const metrics = pass.desktop ? DESKTOP : PHONE;
  await page.send('Emulation.setDeviceMetricsOverride', { ...metrics, width: 320 });
  await sleep(350);
  first.findings.push(...layoutFindings(await page.call<Layout>(LAYOUT, 'reflow'), '1.4.10', 'at 320 px wide'));
  // 1.4.4 is met through the browser's own zoom, and 200 % on a desktop is the page drawn
  // 640 px wide at twice the pixels. A phone is different: its "larger text" setting scales
  // the type and leaves the layout's width alone, so there the text alone goes to 200 %.
  if (pass.desktop) {
    await page.send('Emulation.setDeviceMetricsOverride', { ...metrics, width: metrics.width / 2, height: metrics.height / 2, deviceScaleFactor: 2 });
    await sleep(350);
    first.findings.push(...layoutFindings(await page.call<Layout>(LAYOUT, 'zoom200'), '1.4.4', 'zoomed to 200 %'));
  }
  await page.send('Emulation.setDeviceMetricsOverride', metrics);
  await sleep(300);
  if (!pass.desktop) first.findings.push(...layoutFindings(await page.call<Layout>(LAYOUT, 'text200'), '1.4.4', 'with the text at 200 %'));
  first.findings.push(...layoutFindings(await page.call<Layout>(LAYOUT, 'spacing'), '1.4.12', 'with the text-spacing overrides'));
  if (pass.deep) {
    // 1.3.4: a phone turned sideways. And a desktop at 400 % on a 1024 px tall screen, 320 by
    // 256 CSS pixels: 1.4.10 asks 320 px of width of content that scrolls down, and nothing of
    // its height, so what the bars leave of the screen is this project's measure, not WCAG's.
    const turned = pass.desktop ? { ...DESKTOP, width: 320, height: 256 } : { ...PHONE, width: PHONE.height, height: PHONE.width };
    await page.send('Emulation.setDeviceMetricsOverride', turned);
    await sleep(400);
    const got = await page.call<Layout>(LAYOUT, 'turned');
    const condition = pass.desktop ? 'at 320 by 256' : 'turned sideways';
    first.findings.push(...layoutFindings({ ...got, cut: [] }, pass.desktop ? '1.4.10' : '1.3.4', condition));
    if (got.mainHeight < 48) first.findings.push({ kind: 'room', where: 'main', detail: `${condition}, the bars leave the screen ${got.mainHeight} px` });
    await page.send('Emulation.setDeviceMetricsOverride', metrics);
    await sleep(350);
    if (state.tap === 'bus') {
      // A popup half off the map: focusing its close button scrolled the map's own box, Leaflet
      // put the scroll back, and the button stayed past the edge of the screen -- once in five
      // runs, wherever the bus had left it. Three of the map's own arrow keys put it there every
      // time: 240 px, with a pause after each, since Leaflet drops a key while it is still panning.
      await page.evaluate(`document.querySelector('.leaflet-container').focus()`);
      for (let i = 0; i < 3; i++) {
        await press(page, 'ArrowLeft', 37);
        await sleep(400);
      }
    }
    await page.evaluate(SETTLE);
    const tab = await traverse(page, !!state.dialog);
    first.findings.push(...tab.findings);
    first.focus = { reached: tab.reached, of: tab.of };
  }

  for (const line of new Set([...w.logged.filter((l) => !refused.test(l)), ...w.thrown.map((l) => `uncaught: ${l}`)])) first.findings.push({ kind: 'console', where: label(state), detail: line });
  return results;
}

const label = (s: State) => `${s.screen}/${s.name}`;

/**
 * Every transition and entrance where it ends, which is what the reader sees a quarter of a
 * second later. Four pages run side by side, a page in the background gets no frames, and
 * its transitions stand still at their first one: a card's fill caught on its way from
 * light to dark measured 1.03:1 against its own text. The loops cannot be finished and are
 * left alone; they are waits, and never what text sits on.
 */
const SETTLE = `(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) {} } return true; })()`;

/* ------------------------------------------------------------------------------------- */
/* What a state cannot show                                                              */
/* ------------------------------------------------------------------------------------- */

/** A real mouse, moved or clicked at a point of the page. */
async function mouse(page: Session, type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number): Promise<void> {
  await page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
}

/**
 * The map with a pointer. 1.4.13: a stop's name shown on hover has to stay while the
 * pointer moves onto it, and leave on Escape without the pointer moving. 2.5.7: the view
 * has to move without a drag. The stop the board sent the map to is at its centre, so the
 * centre is where the pointer goes; for the pan, the stops and the routes are switched off
 * first so the click lands on nothing.
 */
async function mapPointer(browser: Browser): Promise<Finding[]> {
  const w = await worker(browser);
  const { page } = w;
  const findings: Finding[] = [];
  const at = (what: string, detail: string) => findings.push({ kind: what as Kind, where: 'mapa', detail });
  const state: State = { screen: 'paradas', name: 'mapa da parada', stored: REGULAR };
  await runState(w, { name: 'pointer', desktop: true, lang: 'gl', themes: ['light'], deep: false }, state).catch(() => undefined);
  const T = words(gl);
  const moved = await page.call<true | string>(`async function (T) {${REACH}${savedBoard} if (!press(byLabel(T.onMap))) return 'no map button'; await pause(2500); return true;}`, T);
  if (moved !== true) return [{ kind: 'reach', where: 'mapa', detail: `the map pointer checks: ${moved}` }];
  const box = await page.evaluate<{ x: number; y: number; w: number; h: number } | null>(
    `(() => { const m = [...document.querySelectorAll('.leaflet-container')].find((e) => e.getBoundingClientRect().width > 300); if (!m) return null; const b = m.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`,
  );
  if (!box) return [{ kind: 'reach', where: 'mapa', detail: 'no map on screen' }];
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const tooltip = `(() => { const t = [...document.querySelectorAll('.leaflet-tooltip')].find((e) => getComputedStyle(e).opacity !== '0' && e.getClientRects().length); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`;

  await mouse(page, 'mouseMoved', cx - 30, cy - 30);
  await mouse(page, 'mouseMoved', cx, cy);
  await sleep(400);
  if (!(await page.evaluate(tooltip))) at('reach', 'no hover label came up over the stop at the centre, so 1.4.13 was not tested');
  else {
    await press(page, 'Escape', 27);
    await sleep(300);
    if (await page.evaluate(tooltip)) at('hover', '1.4.13: Escape does not put the hover label away');
    await mouse(page, 'mouseMoved', cx + 30, cy + 30);
    await mouse(page, 'mouseMoved', cx, cy);
    await sleep(400);
    const tip = await page.evaluate<{ x: number; y: number } | null>(tooltip);
    if (tip) {
      for (let i = 1; i <= 4; i++) await mouse(page, 'mouseMoved', cx + ((tip.x - cx) * i) / 4, cy + ((tip.y - cy) * i) / 4);
      await sleep(500);
      if (!(await page.evaluate(tooltip))) at('hover', '1.4.13: the hover label disappears when the pointer moves onto it');
    }
  }

  // The pan. Stops and routes off (the controls are a column beside the map on a desktop),
  // then one click on an empty part of the map, and the map has to have moved.
  await page.call(`async function (T) {${REACH} for (const t of [T.stopsLayer, T.routesLayer]) { const b = [...document.querySelectorAll('button[aria-pressed="true"]')].find((x) => x.textContent.trim() === t); if (b) b.click(); await pause(300); } }`, T);
  await sleep(600);
  const pane = `getComputedStyle(document.querySelector('.leaflet-map-pane')).transform`;
  const before = await page.evaluate<string>(pane);
  await mouse(page, 'mouseMoved', box.x + 70, box.y + box.h - 90);
  await mouse(page, 'mousePressed', box.x + 70, box.y + box.h - 90);
  await mouse(page, 'mouseReleased', box.x + 70, box.y + box.h - 90);
  await sleep(1200);
  if ((await page.evaluate<string>(pane)) === before) at('drag', '2.5.7: a click on the map does not move it, so a drag is the only way to pan');
  await page.close();
  return findings;
}

/**
 * Forced colours, as Windows' contrast themes and some readers' own settings impose them:
 * every colour the page chose is replaced by the system's few. Whatever said "this one is
 * pressed" or "you are here" with a fill or a tint is gone, so each pressed or current
 * control is compared with one of its siblings on what survives: if nothing differs, the
 * state is invisible.
 */
async function forced(browser: Browser): Promise<Finding[]> {
  const w = await worker(browser);
  const findings: Finding[] = [];
  const pass: Pass = { name: 'forced', desktop: false, lang: 'gl', themes: ['dark'], deep: false };
  for (const name of ['parada', 'lista', 'linha aberta', 'baleiro', 'planificada', 'menu', 'filtros']) {
    const state = STATES.find((s) => s.name === name)!;
    await runState(w, pass, { ...state, expect: undefined });
    await w.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await sleep(400);
    const got = await w.page.evaluate<string[] | string>(`(() => {
      if (!matchMedia('(forced-colors: active)').matches) return 'forced colours never reached the page';
      const sig = (el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.borderTopColor + ' ' + s.borderTopWidth + ' ' + s.borderTopStyle, s.borderLeftWidth, s.outlineStyle + ' ' + s.outlineWidth, s.textDecorationLine].join('|'); };
      const out = [];
      const on = [...document.querySelectorAll('[aria-pressed="true"], [aria-current]:not([aria-current="false"])')].filter((e) => e.getClientRects().length);
      for (const el of on) {
        // Its own kind: a sibling first, then one under the grandparent, never another pressed or
        // current one (the current line card was compared with the pressed "Todas" filter).
        const kind = (p) => p !== el && p.tagName === el.tagName && p.getClientRects().length && !p.matches('[aria-pressed="true"], [aria-current]:not([aria-current="false"])') && p.hasAttribute('aria-pressed') === el.hasAttribute('aria-pressed');
        const peer = [...el.parentElement.children].find(kind) || [...el.parentElement.parentElement.querySelectorAll(el.tagName)].find(kind);
        if (peer && sig(peer) === sig(el)) out.push(el.tagName.toLowerCase() + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) + '" looks like "' + (peer.getAttribute('aria-label') || peer.textContent || '').trim().slice(0, 30) + '"');
      }
      return out;
    })()`);
    if (typeof got === 'string') findings.push({ kind: 'reach', where: name, detail: got });
    else for (const g of new Set(got)) findings.push({ kind: 'forced', where: name, detail: `pressed or current, and indistinguishable in forced colours: ${g}` });
  }
  await w.page.close();
  return findings;
}

/**
 * Reduced motion, honoured rather than declared.
 *
 * index.css has the media query that stops every animation and transition, and a grep
 * would find it. What a grep cannot see is a later rule with a longer duration and its
 * own !important, or a library animating from JavaScript. So the preference is emulated
 * and the page asked what is still moving: every running animation must be over in a
 * millisecond, on the screens that animate the most, the ride included.
 */
async function motion(browser: Browser): Promise<Finding[]> {
  const w = await worker(browser);
  const findings: Finding[] = [];
  const pass: Pass = { name: 'motion', desktop: false, lang: 'gl', themes: ['light'], deep: false };
  for (const name of ['parada', 'mapa', 'planificada', 'viaxe']) {
    const state = STATES.find((s) => s.name === name)!;
    await w.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    // runState clears the emulated media for its own sake; the preference has to hold across the setup.
    const original = w.page.send.bind(w.page);
    w.page.send = ((method: string, params?: Record<string, unknown>) =>
      method === 'Emulation.setEmulatedMedia' ? original(method, { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }) : original(method, params)) as typeof w.page.send;
    await runState(w, pass, { ...state, expect: undefined });
    w.page.send = original;
    const moving = await w.page.evaluate<string[]>(`(() => {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) return ['the preference did not reach the page'];
      return document.getAnimations()
        .filter((a) => a.playState === 'running' && (a.effect.getTiming().duration || 0) > 1)
        .map((a) => { const t = a.effect.target; return (t ? t.tagName.toLowerCase() + '.' + String(t.className).split(' ').slice(0, 2).join('.') : '?') + ' ' + (a.animationName || a.transitionProperty || a.constructor.name) + ' ' + a.effect.getTiming().duration + ' ms'; })
        .slice(0, 6);
    })()`);
    for (const m of moving) findings.push({ kind: 'motion', where: name, detail: m });
  }
  // 2.2.2 with the preference left alone: on the ride nothing moves for more than five seconds
  // but the waits, which end with the wait. The next stop's pulse looped for the whole ride
  // until 8 October 2026; it beats twice now. A finished beat has left the page by the time
  // this looks, so what is here and longer than five seconds is a loop.
  const ride = STATES.find((s) => s.name === 'a bordo')!;
  await runState(w, pass, { ...ride, expect: undefined });
  const endless = await w.page.evaluate<string[]>(`document.getAnimations()
    .filter((a) => !['dot-bounce', 'pulse', 'spin'].includes(a.animationName) && a.effect.getComputedTiming().activeDuration > 5000)
    .map((a) => (a.animationName || a.constructor.name) + ' runs ' + a.effect.getComputedTiming().activeDuration + ' ms')`);
  for (const e of endless) findings.push({ kind: 'motion', where: 'a bordo', detail: `2.2.2: ${e}, and nothing on the page stops it` });
  await w.page.close();
  return findings;
}

/**
 * Two things the keyboard has to do, done with the keyboard.
 *
 * tools/test.ts checks that the dialog hook and the planner *contain* the code for these;
 * a grep proves the text exists, not that focus moves. Every dialog state above already
 * has its Tab walked and its Escape pressed; this keeps the menu's full round in both
 * directions, and a planned trip has to land focus on the answer rather than leave it on
 * the button.
 */
async function keyboard(browser: Browser): Promise<{ findings: Finding[]; visited: string }> {
  const w = await worker(browser);
  const { page } = w;
  const findings: Finding[] = [];
  const pass: Pass = { name: 'keyboard', desktop: false, lang: 'gl', themes: ['light'], deep: false };
  const tab = (back = false) => press(page, 'Tab', 9, back ? 8 : 0);
  const active = () =>
    page.evaluate<string>(
      `(() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
         return (a.closest('[role=dialog]') ? 'dialog:' : 'outside:') + a.tagName.toLowerCase() + ' "' + ((a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24)) + '"'; })()`,
    );
  let visited = 'menu not opened';
  await runState(w, pass, STATES.find((s) => s.name === 'menu')!);
  const count = await page.evaluate<number>(
    `(() => { const d = document.querySelector('[role=dialog]'); return d ? [...d.querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.matches(':disabled')).length : 0; })()`,
  );
  if (!count) findings.push({ kind: 'reach', where: 'menu', detail: 'the menu did not open' });
  else {
    const stops = new Set<string>();
    for (let i = 0; i < count + 2; i++) {
      await tab();
      const at = await active();
      stops.add(at);
      if (!at.startsWith('dialog:')) findings.push({ kind: 'keyboard', where: 'menu', detail: `2.4.3: Tab ${i + 1} of ${count + 2} left the menu: focus on ${at}` });
    }
    for (let i = 0; i < count + 2; i++) {
      await tab(true);
      const at = await active();
      stops.add(at);
      if (!at.startsWith('dialog:')) findings.push({ kind: 'keyboard', where: 'menu', detail: `2.4.3: Shift+Tab ${i + 1} of ${count + 2} left the menu: focus on ${at}` });
    }
    // Proof the key did something: the hook focuses the first control when the menu
    // opens, so a Tab that moved nothing would also never leave the dialog.
    visited = `${stops.size} distinct controls of ${count} in the menu`;
    if (stops.size < Math.min(count, 3)) findings.push({ kind: 'reach', where: 'menu', detail: `Tab visited ${stops.size} distinct controls of ${count}: the key is not moving focus, so this proved nothing` });
    await press(page, 'Escape', 27);
    await sleep(500);
    const after = await page.evaluate<string>(
      `(() => { if (document.querySelector('[role=dialog]')) return 'the menu is still open';
         const a = document.activeElement; if (!a || a === document.body) return 'focus fell to body';
         return (a.getAttribute('aria-label') || '').startsWith(${JSON.stringify(gl.menu.open)}) ? 'ok' : 'focus on ' + a.tagName.toLowerCase() + ' "' + ((a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24)) + '"'; })()`,
    );
    if (after !== 'ok') findings.push({ kind: 'keyboard', where: 'menu', detail: `after Escape: ${after}` });
  }

  await runState(w, pass, STATES.find((s) => s.name === 'planificada')!);
  const where = await page.evaluate<string>(
    `(() => { const a = document.activeElement; const main = document.querySelector('main');
       if (!a || a === document.body) return 'body';
       if (!main.contains(a)) return 'outside main: ' + a.tagName;
       return a.tabIndex === -1 && a.tagName === 'DIV' && a.textContent.trim().length > 50 ? 'answer' : a.tagName.toLowerCase() + ' "' + (a.textContent || '').trim().slice(0, 24) + '"'; })()`,
  );
  if (where !== 'answer') findings.push({ kind: 'keyboard', where: 'ruta', detail: `2.4.3: after planning, focus is on ${where}, not the answer` });
  await page.close();
  return { findings, visited };
}

/**
 * The app with site data refused -- Chrome's "don't allow sites to save data", which some
 * readers turn on and some webviews ship with. Reading `window.localStorage` then throws,
 * and one read left outside a try blanked the whole page. A browser of its own, because the
 * setting is read when the profile opens; a getter faked in the page is not the same thing.
 */
async function siteDataRefused(): Promise<Finding[]> {
  const executable = findChromium();
  if (!executable) return [{ kind: 'reach', where: 'storage', detail: 'no Chromium to launch with the setting' }];
  const browser = await launch(executable, true, { profile: { default_content_setting_values: { cookies: 2 } } });
  const findings: Finding[] = [];
  try {
    const page = await browser.newPage();
    await guard(page, () => 'incidents');
    await page.send('Emulation.setDeviceMetricsOverride', PHONE);
    const errors = page.uncaught();
    await page.goto(`${BASE}/`);
    await sleep(2500);
    const state = await page.evaluate<{ refused: boolean; nav: number }>(
      `(() => { let refused = false; try { window.localStorage; } catch (e) { refused = true; } return { refused, nav: document.querySelectorAll('nav a, nav button').length }; })()`,
    );
    if (!state.refused) findings.push({ kind: 'reach', where: 'storage', detail: 'the setting never reached the page: localStorage was readable, so this proved nothing' });
    if (state.nav === 0) findings.push({ kind: 'console', where: 'storage', detail: 'nothing rendered: the page has no navigation' });
    // The same setting refuses the service worker's registration, and the browser says so; that is its answer, not a fault.
    for (const line of errors.filter((e) => !/ServiceWorker/.test(e))) findings.push({ kind: 'console', where: 'storage', detail: `uncaught: ${line}` });
  } finally {
    browser.close();
  }
  return findings;
}

/* ------------------------------------------------------------------------------------- */
/* The run                                                                               */
/* ------------------------------------------------------------------------------------- */

const quick = process.argv[2] === 'quick';
const PASSES: Pass[] = quick
  ? [{ name: 'phone gl', desktop: false, lang: 'gl', themes: ['light', 'dark'], deep: true }]
  : [
      { name: 'phone gl', desktop: false, lang: 'gl', themes: ['light', 'dark'], deep: true },
      { name: 'phone es', desktop: false, lang: 'es', themes: ['light'], deep: false },
      { name: 'phone en', desktop: false, lang: 'en', themes: ['light'], deep: false },
      { name: 'desktop gl', desktop: true, lang: 'gl', themes: ['light', 'dark'], deep: true },
    ];
const PAGES = Number(process.env.AUDIT_PAGES ?? 4);

let ran = false;
const started = Date.now();
await withBrowser(async (browser) => {
  ran = true;
  // For an edit loop: AUDIT_STATES and AUDIT_PASSES take a pattern for the state ("ruta/hora")
  // and the pass ("desktop"); the sequences after the states run whatever these say.
  const only = (pattern: string | undefined, value: string) => !pattern || new RegExp(pattern).test(value);
  const jobs = PASSES.filter((pass) => only(process.env.AUDIT_PASSES, pass.name)).flatMap((pass) =>
    STATES.filter((s) => !(pass.desktop && s.phoneOnly) && !(!pass.desktop && s.desktopOnly) && only(process.env.AUDIT_STATES, label(s))).map((state) => ({ pass, state })),
  );
  const results: Result[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PAGES, jobs.length) }, async () => {
      const w = await worker(browser);
      while (next < jobs.length) {
        const { pass, state } = jobs[next++];
        try {
          results.push(...(await runState(w, pass, state)));
        } catch (error) {
          results.push({ pass: pass.name, state: label(state), theme: pass.themes[0], findings: [{ kind: 'reach', where: label(state), detail: `the run broke: ${String(error).slice(0, 200)}` }], measured: 0, named: 0, tightest: Infinity, axePassed: 0, review: [], title: '', nav: '' });
        }
      }
      await w.page.close();
    }),
  );
  const extra: { name: string; findings: Finding[] }[] = [];
  /** A sequence that breaks is a check that did not run, which is a finding, not a crash. */
  const sequence = async (name: string, run: () => Promise<Finding[]>) => {
    try {
      extra.push({ name, findings: await run() });
    } catch (error) {
      extra.push({ name, findings: [{ kind: 'reach', where: name, detail: `the run broke: ${String(error).slice(0, 200)}` }] });
    }
  };
  let visited = 'menu not opened';
  await sequence('keyboard: the menu, both ways, and the planner', async () => {
    const kb = await keyboard(browser);
    visited = kb.visited;
    return kb.findings;
  });
  await sequence('map: hover labels and panning without a drag', () => mapPointer(browser));
  await sequence('forced colours', () => forced(browser));
  await sequence('reduced motion', () => motion(browser));
  await sequence('site data refused', () => siteDataRefused());

  // 3.2.3 and 2.4.2, across the states of a pass: the navigation is the same in the same
  // order everywhere, and each screen has a title of its own.
  for (const pass of PASSES) {
    const mine = results.filter((r) => r.pass === pass.name && r.theme === pass.themes[0]);
    const navs = new Map<string, string[]>();
    for (const r of mine) if (r.nav) navs.set(r.nav, [...(navs.get(r.nav) ?? []), r.state]);
    if (navs.size > 1) extra.push({ name: `${pass.name}: navigation`, findings: [{ kind: 'nav', where: pass.name, detail: `the navigation differs between states: ${[...navs.entries()].map(([n, s]) => `"${n}" on ${s.slice(0, 3).join(', ')}`).join(' / ')}` }] });
    const titles = new Map<string, Set<string>>();
    // A state that never drew has no title to share; the reach finding already says so.
    for (const r of mine) if (r.title) titles.set(r.state.split('/')[0], (titles.get(r.state.split('/')[0]) ?? new Set()).add(r.title));
    const perScreen = [...titles.entries()].map(([screen, set]) => [screen, [...set][0]] as const);
    const shared = perScreen.filter(([, t], i) => perScreen.findIndex(([, u]) => u === t) !== i);
    if (shared.length) extra.push({ name: `${pass.name}: titles`, findings: shared.map(([screen, t]) => ({ kind: 'title' as Kind, where: screen, detail: `2.4.2: "${t}" is the title of another screen too` })) });
  }

  /* --- the report --- */
  results.sort((a, b) => (a.pass + a.state + a.theme).localeCompare(b.pass + b.state + b.theme));
  console.log('\n=== what was looked at ===');
  for (const pass of PASSES) {
    console.log(`\n  ${pass.name}`);
    for (const r of results.filter((x) => x.pass === pass.name)) {
      const reach = r.findings.filter((f) => f.kind === 'reach');
      console.log(
        `    ${r.state.padEnd(26)} ${r.theme.padEnd(5)} ${String(r.measured).padStart(4)} texts, tightest ${r.tightest === Infinity ? '  - ' : r.tightest.toFixed(2)}, ${String(r.named).padStart(3)} named, axe ${String(r.axePassed).padStart(2)} rules passed` +
          (r.focus ? `, Tab ${r.focus.reached}/${r.focus.of}` : '') +
          (reach.length ? `  [NOT REACHED: ${reach.map((f) => f.detail).join('; ')}]` : ''),
      );
    }
  }

  const all = [...results.flatMap((r) => r.findings.map((f) => ({ ...f, at: `${r.pass} · ${r.state} · ${r.theme}` }))), ...extra.flatMap((e) => e.findings.map((f) => ({ ...f, at: e.name })))];
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const rows = all.filter((f) => f.kind === kind);
    console.log(`\n=== ${KINDS[kind]} ===${rows.length ? `  ${rows.length}` : '  none'}`);
    // The same defect in every theme and pass is one defect: grouped by where and what.
    const grouped = new Map<string, string[]>();
    for (const f of rows) grouped.set(`${f.where}\n      ${f.detail}`, [...(grouped.get(`${f.where}\n      ${f.detail}`) ?? []), f.at]);
    for (const [what, where] of [...grouped.entries()].slice(0, 60)) console.log(`    ${what}\n      in ${where.length > 3 ? `${where.slice(0, 3).join('; ')} and ${where.length - 3} more` : where.join('; ')}`);
    if (grouped.size > 60) console.log(`    ... and ${grouped.size - 60} more`);
  }

  const review = new Map<string, number>();
  for (const r of results) for (const item of r.review) review.set(item.split(' ')[0], (review.get(item.split(' ')[0]) ?? 0) + 1);
  console.log('\n=== axe could not decide (needs a look, not a failure) ===');
  console.log(review.size ? `  ${[...review.entries()].map(([id, n]) => `${id} in ${n} state${n === 1 ? '' : 's'}`).join(', ')}` : '  nothing');
  console.log(`\n=== keyboard ===\n  ${visited}`);

  // Everything, for whoever wants to count or compare two runs: AUDIT_JSON=path.
  if (process.env.AUDIT_JSON) writeFileSync(process.env.AUDIT_JSON, JSON.stringify({ results: results.map(({ review: _, ...r }) => r), extra }, null, 1));

  const gated = all.filter((f) => !HOUSE.includes(f.kind));
  console.log('\n=== totals ===');
  console.log(`  ${results.length} state-theme measurements over ${new Set(results.map((r) => r.pass + r.state)).size} states and ${PASSES.length} passes, in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`  ${results.reduce((s, r) => s + r.measured, 0)} texts measured, ${results.reduce((s, r) => s + r.named, 0)} controls named`);
  console.log(`  WCAG 2.2 A/AA: ${gated.length} finding${gated.length === 1 ? '' : 's'}${gated.length ? ` (${(Object.keys(KINDS) as Kind[]).filter((k) => !HOUSE.includes(k)).map((k) => [k, gated.filter((f) => f.kind === k).length] as const).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`);
  console.log(`  house bar: under 12 px ${all.filter((f) => f.kind === 'size').length}, under 44 px ${all.filter((f) => f.kind === 'target44').length}, under 48 px between the bars ${all.filter((f) => f.kind === 'room').length}`);
  if (gated.length) process.exitCode = 1;
});
// Under CI a run that could not start is a failure: the gate would otherwise pass by not looking.
if (!ran && process.env.CI) process.exitCode = 1;
