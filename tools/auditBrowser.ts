/**
 * What the app looks like against its own bar, in both themes.
 *
 *   pnpm build && PORT=3002 pnpm start     # in another terminal
 *   pnpm run audit:browser                 # every screen, light and dark
 *   pnpm run audit:browser light           # one theme
 *
 * The bar: nothing interactive under 44x44, no text under 12 px, no contrast failure
 * (WCAG: 4.5 for body text, 3.0 for large), every control named, every image described,
 * no sideways scroll at 320 px or at 200% text, one <h1>, the document's lang the app's,
 * nothing animating under reduced motion. Colours are resolved by painting them to a
 * canvas and reading the pixel back, because the app is written in oklch() and a regex
 * over rgb() silently scores 1.00 everywhere. Run by hand or by the weekly measure
 * workflow, not a gate: the bar is this project's own.
 */
import { BASE, PHONE, phonePage, withBrowser, type Browser, type Session } from './cdp';
import { sleep } from './lib';

const SCREENS = ['paradas', 'linhas', 'mapa', 'ruta', 'avisos', 'tarifas'];

/**
 * What a finding can be. The first three are the bar the header describes; the rest
 * are the things a contrast-and-size probe never looks at and a person never notices
 * until a screen reader or a narrow phone does.
 *
 *   name      a control with nothing to announce: a button with only an icon, a link
 *             with only an image, a field with no label
 *   alt       an <img> with no alt attribute at all (alt="" is decorative, and fine)
 *   overflow  the page scrolls sideways, which on a phone is content off the edge
 *   lang      the document says it is in one language while the app speaks another
 *   headings  not exactly one <h1>, so the page has no single name for a screen reader
 */
type Kind = 'contrast' | 'size' | 'target' | 'name' | 'alt' | 'overflow' | 'lang' | 'headings';
const KINDS: Kind[] = ['contrast', 'size', 'target', 'name', 'alt', 'overflow', 'lang', 'headings'];

interface Finding {
  kind: Kind;
  where: string;
  detail: string;
  value: number;
  need: number;
}

const PROBE = `(() => {
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
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34);
    return el.tagName.toLowerCase() + id + cls + (text ? ' "' + text + '"' : '');
  };

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
      .map((n) => (n.getAttribute('alt') || n.getAttribute('aria-label') || '').trim())
      .join(' ');
    return ((el.textContent || '') + ' ' + inner + ' ' + (el.getAttribute('title') || '')).trim();
  };

  const seen = new Set();
  const findings = [];
  const push = (kind, el, detail, value, need) => {
    const key = kind + '|' + detail + '|' + value.toFixed(2);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, where: label(el), detail, value, need });
  };
  /** Contrast of one colour over the backdrop of the element, dimmed by the opacity in force. */
  const contrastOf = (el, colour, size, weight, what) => {
    const bg = backdrop(el);
    const raw = rgba(colour);
    const o = opacityOf(el);
    const fg = over([raw[0], raw[1], raw[2], raw[3] * o], bg);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    const detail = what + colour + (o < 1 ? ' at opacity ' + o.toFixed(2) : '') + ' on rgb(' + bg.map(Math.round).join(',') + ')';
    return { got, need, detail };
  };

  // Proof the probe is looking: a clean report has to come with a count and the closest
  // thing to a failure it found, or it is indistinguishable from a probe that broke.
  let measured = 0;
  let named = 0;
  let tightest = { ratio: Infinity, where: '', detail: '' };
  let smallest = Infinity;
  // The audit sets the app to Galician before every load (see audit() below), so this is
  // what <html lang> has to say once the app has taken over the document.
  const EXPECT_LANG = 'gl';

  const onCanvas = (el) => !!el.closest('.leaflet-container');
  // Visually hidden until focused, so its 1x1 box is the point rather than a defect.
  const offscreen = (el) => !!el.closest('.sr-only');

  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    const tag = el.tagName.toLowerCase();
    const hiddenFromAt = !!el.closest('[aria-hidden="true"]');

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
      if (el.getAttribute('placeholder')) {
        texts.push({ colour: getComputedStyle(el, '::placeholder').color, what: 'placeholder ' });
      }
    }
    for (const t of texts) {
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      if (size < 12) push('size', el, size.toFixed(1) + ' px', size, 12);
      const { got, need, detail } = contrastOf(el, t.colour, size, weight, t.what);
      measured++;
      smallest = Math.min(smallest, size);
      // Held against the body-text bar for reporting, so a heading that only clears the
      // large-text bar still shows up as the tightest thing on the screen.
      if (got < tightest.ratio) tightest = { ratio: got, where: label(el), detail };
      if (got < need) push('contrast', el, detail, got, need);
    }

    // Touch targets. The roles are the ones this app hands out; a div React made
    // clickable with no role is invisible here and to a screen reader alike, which is the
    // same defect, and the name check below is where it would show.
    const role = el.getAttribute('role') || '';
    const tappable =
      /^(button|a|input|select|textarea|summary|label)$/.test(tag) ||
      /^(button|link|tab|menuitem|option|checkbox|switch|radio)$/.test(role) ||
      el.hasAttribute('tabindex');
    if (tappable && !onCanvas(el) && !offscreen(el) && el.getAttribute('tabindex') !== '-1' && !(tag === 'a' && !el.hasAttribute('href'))) {
      const side = Math.min(box.width, box.height);
      if (side < 44) push('target', el, Math.round(box.width) + 'x' + Math.round(box.height), side, 44);
    }

    // What a screen reader would announce for a control. An icon-only button with no
    // aria-label reads as "button", a link around an image as "link", a field with no
    // label as "edit text" -- and each of those looks perfectly fine on screen.
    const control =
      /^(button|select|textarea)$/.test(tag) || (tag === 'a' && el.hasAttribute('href')) ||
      (tag === 'input' && !/^(hidden)$/.test(el.type || '')) ||
      /^(button|link|tab|menuitem|checkbox|switch|radio|textbox|searchbox|combobox)$/.test(role);
    if (control && !hiddenFromAt && !onCanvas(el)) {
      named++;
      if (!nameOf(el)) push('name', el, 'no accessible name', 0, 1);
    }
    if (tag === 'img' && !hiddenFromAt && !el.hasAttribute('alt')) {
      push('alt', el, (el.getAttribute('src') || '').split('/').pop() || 'img', 0, 1);
    }
  }

  // The page as a whole, once per state.
  const root = document.documentElement;
  const over_ = root.scrollWidth - root.clientWidth;
  if (over_ > 1) push('overflow', document.body, 'the page is ' + over_ + ' px wider than the viewport', root.scrollWidth, root.clientWidth);
  // The screens scroll inside <main>, not the document, so a block wider than the phone
  // never reaches the root's scrollWidth: the planner's form once ran 200 px past the
  // right edge of a 375 px phone and this audit reported overflow 0.
  const mainEl = document.querySelector('main');
  const overMain = mainEl ? mainEl.scrollWidth - mainEl.clientWidth : 0;
  if (overMain > 1) push('overflow', mainEl, 'the screen is ' + overMain + ' px wider than its scroller', mainEl.scrollWidth, mainEl.clientWidth);
  const lang = (root.getAttribute('lang') || '').toLowerCase();
  if (lang !== EXPECT_LANG) push('lang', root, '<html lang="' + lang + '">, the app speaks ' + EXPECT_LANG, 0, 1);
  const h1s = document.querySelectorAll('h1').length;
  if (h1s !== 1) push('headings', document.body, h1s + ' <h1> elements: ' + [...document.querySelectorAll('h1')].map((h) => '"' + (h.textContent || '').trim().slice(0, 30) + '"').join(', '), h1s, 1);

  return { findings, measured, named, tightest, smallest };
})()`;

/**
 * Six routes is not the app.
 *
 * Most of this interface is behind an interaction -- the search results, an open stop,
 * a planned trip, the menu where the theme switch itself lives -- and a probe that only
 * visits URLs reports a clean bill for the half it never saw. Each state below says how
 * to reach it, and says so out loud when it could not.
 */
const REACH = `
  const seeText = (t) => [...document.querySelectorAll('button, a, [role=button], summary')]
    .find((e) => new RegExp(t, 'i').test((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '')));
  const hit = (t) => { const e = seeText(t); if (e) { e.click(); return true; } return false; };
  const fill = (el, value) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
`;

interface State {
  screen: string;
  name: string;
  setup?: string;
}
const STATES: State[] = [
  { screen: 'paradas', name: 'lista' },
  {
    screen: 'paradas',
    name: 'busca',
    setup: `const i = document.querySelector('input[type=search], input[type=text]');
            if (!i) return 'no search box'; fill(i, 'catedral'); await pause(900); return true;`,
  },
  {
    screen: 'paradas',
    name: 'parada aberta',
    setup: `const row = document.querySelector('main li button, main [role=listitem] button, main article button');
            if (!row) return 'no stop row'; row.click(); await pause(1200); return true;`,
  },
  {
    screen: 'paradas',
    name: 'menu',
    setup: `if (!hit('men|abrir')) return 'no menu button'; await pause(600); return true;`,
  },
  { screen: 'linhas', name: 'lista' },
  {
    screen: 'linhas',
    name: 'linha aberta',
    setup: `const c = document.querySelector('main button[id^="line-card-"]');
            if (!c) return 'no line card'; c.click(); await pause(1200); return true;`,
  },
  { screen: 'mapa', name: 'mapa' },
  {
    screen: 'mapa',
    name: 'filtros',
    setup: `if (!hit('filtros|capas')) return 'no filters button'; await pause(700); return true;`,
  },
  { screen: 'ruta', name: 'baleiro' },
  {
    screen: 'ruta',
    name: 'planificada',
    setup: `const ins = [...document.querySelectorAll('input')].filter((i) => i.type !== 'checkbox' && i.type !== 'radio');
            if (ins.length < 2) return 'no two fields (' + ins.length + ')';
            fill(ins[0], 'Praza Maior'); await pause(700);
            let opt = document.querySelector('[role=option], ul[role=listbox] li button, .autocomplete button');
            if (opt) { opt.click(); await pause(400); }
            fill(ins[1], 'HULA'); await pause(700);
            opt = document.querySelector('[role=option], ul[role=listbox] li button, .autocomplete button');
            if (opt) { opt.click(); await pause(400); }
            if (!hit('buscar|planificar|ver rutas|calcular')) return 'no plan button';
            await pause(2500); return true;`,
  },
  { screen: 'avisos', name: 'avisos' },
  { screen: 'tarifas', name: 'tarifas' },
];

/** A screen, once the app has drawn it and run the idle work it schedules on mount. */
async function open(page: Session, screen: string, settle = 2200): Promise<void> {
  await page.goto(`${BASE}/${screen}`);
  await page.waitFor('document.querySelector("main")');
  await sleep(settle);
}

/** One key, down and up, through the browser's own focus handling. */
async function press(page: Session, key: string, code: number, modifiers = 0): Promise<void> {
  const event = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

interface Report {
  findings: Finding[];
  measured: number;
  /** Controls whose accessible name was computed, so a clean 'name' column has a count behind it. */
  named: number;
  tightest: { ratio: number; where: string; detail: string };
  smallest: number;
}

async function audit(browser: Browser, theme: 'light' | 'dark') {
  // Two fixed scripts rather than one built around the argument: code assembled from a
  // value is what CodeQL flags, rightly, elsewhere.
  const page = await phonePage(
    browser,
    theme === 'dark' ? "try { localStorage.setItem('urbanos-lugo-theme', 'dark'); } catch (e) {}" : "try { localStorage.setItem('urbanos-lugo-theme', 'light'); } catch (e) {}",
  );

  // Errors and warnings the page logs, and exceptions nobody caught: what a screenshot
  // never shows. Vite's own chatter is not the app's.
  const noise = /\[vite\]|React DevTools|Download the React/;
  const thrown = page.uncaught();
  const logged: string[] = [];
  page.on('Runtime.consoleAPICalled', (p) => {
    const kind = String(p.type);
    if (kind !== 'error' && kind !== 'warning') return;
    const text = ((p.args as { value?: unknown; description?: string }[]) ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 220);
    if (!noise.test(text)) logged.push(`${kind}: ${text}`);
  });

  const out = new Map<string, Report & { reached: string; console: string[] }>();
  for (const state of STATES) {
    logged.length = thrown.length = 0;
    await open(page, state.screen);
    let reached = 'ok';
    if (state.setup) {
      const got = await page.evaluate<true | string>(`(async () => {${REACH}${state.setup}})()`);
      if (got !== true) reached = String(got);
      await sleep(700);
    }
    const report = await page.evaluate<Report>(PROBE);

    // The same state, squeezed and enlarged. 320 px is WCAG's reflow width and the
    // narrowest phone still in use; a page that scrolls sideways there has content off
    // the edge. Then the type at twice the size, which is what a phone's "larger text"
    // setting does to every rem in the layout: the bottom bar has to keep its four
    // destinations on screen, or the reader who needs big type loses the navigation.
    await page.send('Emulation.setDeviceMetricsOverride', { ...PHONE, width: 320 });
    await sleep(500);
    const narrow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    await page.send('Emulation.setDeviceMetricsOverride', PHONE);
    if (narrow > 1) report.findings.push({ kind: 'overflow', where: 'body', detail: `at 320 px the page is ${narrow} px wider than the viewport`, value: 320 + narrow, need: 320 });
    const large = await page.evaluate<{ over: number; nav: number; off: number; culprit: string }>(`(async () => {
      document.documentElement.style.fontSize = '200%';
      await new Promise((r) => setTimeout(r, 400));
      const root = document.documentElement;
      const links = [...document.querySelectorAll('nav a[href]')].filter((a) => a.getBoundingClientRect().width > 0);
      const off = links.filter((a) => { const b = a.getBoundingClientRect(); return b.left < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1; }).length;
      // The widest thing sticking out that no ancestor clips or scrolls: that is what
      // made the page scroll, and the name that goes in the report.
      const clipped = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') return true; } return false; };
      const describe = (el, b) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 3).join('.') + ' "' + (el.textContent || '').trim().slice(0, 30) + '" right edge at ' + Math.round(b.right) + ' px';
      let culprit = '', right = root.clientWidth + 1;
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.right <= right || clipped(el)) continue;
        right = b.right;
        culprit = describe(el, b);
      }
      // Nothing in flow explains it: an absolutely positioned box escapes a scroll
      // container that is not itself positioned and widens the document from outside
      // it. The first one found was a 1 px sr-only span, invisible and 42 px past the
      // edge, which is not a thing anyone finds by looking.
      if (!culprit) {
        for (const el of document.querySelectorAll('body *')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.right <= right || !/absolute|fixed/.test(getComputedStyle(el).position)) continue;
          right = b.right;
          culprit = describe(el, b) + ' (positioned, escapes its scroll container)';
        }
      }
      const out = { over: root.scrollWidth - root.clientWidth, nav: links.length, off, culprit };
      document.documentElement.style.fontSize = '';
      return out;
    })()`);
    if (large.over > 1) report.findings.push({ kind: 'overflow', where: large.culprit || 'body', detail: `at 200% text the page is ${large.over} px wider than the viewport`, value: large.over, need: 0 });
    if (large.off > 0) report.findings.push({ kind: 'overflow', where: 'nav', detail: `at 200% text ${large.off} of ${large.nav} navigation links sit off screen`, value: large.off, need: 0 });

    out.set(`${state.screen}/${state.name}`, { ...report, reached, console: [...new Set([...logged, ...thrown.map((line) => `uncaught: ${line}`)])] });
  }
  return out;
}

/**
 * Reduced motion, honoured rather than declared.
 *
 * index.css has the media query that stops every animation and transition, and a grep
 * would find it. What a grep cannot see is a later rule with a longer duration and its
 * own !important, or a library animating from JavaScript. So the preference is emulated
 * and the page asked what is still moving: every running animation must be over in a
 * millisecond, on the two screens that animate the most.
 */
async function motion(browser: Browser): Promise<string[]> {
  const page = await phonePage(browser);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const failures: string[] = [];
  for (const screen of ['paradas', 'mapa']) {
    await open(page, screen, 2500);
    const moving = await page.evaluate<string[]>(`(() => {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) return ['the preference did not reach the page'];
      return document.getAnimations()
        .filter((a) => a.playState === 'running' && (a.effect.getTiming().duration || 0) > 1)
        .map((a) => { const t = a.effect.target; return (t ? t.tagName.toLowerCase() + '.' + String(t.className).split(' ').slice(0, 2).join('.') : '?') + ' ' + (a.animationName || a.transitionProperty || a.constructor.name) + ' ' + a.effect.getTiming().duration + ' ms'; })
        .slice(0, 6);
    })()`);
    for (const m of moving) failures.push(`${screen}: ${m}`);
  }
  await page.close();
  return failures;
}

/**
 * Two things the keyboard has to do, done with the keyboard.
 *
 * tools/test.ts checks that the dialog hook and the planner *contain* the code for these;
 * a grep proves the text exists, not that focus moves. So here a real Tab goes through
 * the browser's own focus handling: it must not leave the open menu, forwards or back,
 * and a planned trip must land focus on the answer rather than leave it on the button.
 */
async function keyboard(browser: Browser): Promise<{ failures: string[]; visited: string }> {
  const page = await phonePage(browser);
  const tab = (back = false) => press(page, 'Tab', 9, back ? 8 : 0);
  const active = () =>
    page.evaluate<string>(
      `(() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
         return (a.closest('[role=dialog]') ? 'dialog:' : 'outside:') + a.tagName.toLowerCase() + ' "' + ((a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24)) + '"'; })()`,
    );
  const failures: string[] = [];
  let visited = 'menu not opened';

  await open(page, 'paradas');
  // Opened the way a keyboard opens it: focus on the button, then the activation. A
  // script's click() leaves focus on <body>, so the hook remembers <body> as the opener
  // and the Escape check below would fail for a reason no keyboard user ever meets.
  const opened = await page.evaluate<true | string>(`(async () => {${REACH} const b = seeText('men|abrir'); if (!b) return 'no menu button'; b.focus(); b.click(); await pause(600); return true;})()`);
  if (opened !== true) failures.push(`menu: ${opened}`);
  else {
    const count = await page.evaluate<number>(
      `[...document.querySelector('[role=dialog]').querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.matches(':disabled')).length`,
    );
    // Forwards past the last one, then back past the first: every stop is in the dialog.
    const stops = new Set<string>();
    visited = '';
    for (let i = 0; i < count + 2; i++) {
      await tab();
      const at = await active();
      stops.add(at);
      if (!at.startsWith('dialog:')) failures.push(`Tab ${i + 1} of ${count + 2} left the menu: focus on ${at}`);
    }
    for (let i = 0; i < count + 2; i++) {
      await tab(true);
      const at = await active();
      stops.add(at);
      if (!at.startsWith('dialog:')) failures.push(`Shift+Tab ${i + 1} of ${count + 2} left the menu: focus on ${at}`);
    }
    // Proof the key did something: the hook focuses the first control when the menu
    // opens, so a Tab that moved nothing would also never leave the dialog.
    visited = `${stops.size} distinct controls of ${count} in the menu`;
    if (stops.size < Math.min(count, 3)) failures.push(`Tab visited ${stops.size} distinct controls of ${count}: the key is not moving focus, so this proved nothing`);

    // And out again. Escape has to close the menu, and focus has to land back on the
    // button that opened it -- a dialog that closes and drops focus on <body> sends a
    // keyboard reader back to the top of the page to find their place.
    await press(page, 'Escape', 27);
    await sleep(500);
    const after = await page.evaluate<string>(
      `(() => { if (document.querySelector('[role=dialog]')) return 'the menu is still open';
         const a = document.activeElement; if (!a || a === document.body) return 'focus fell to body';
         const opener = /men|abrir/i.test((a.getAttribute('aria-label') || '') + ' ' + (a.textContent || ''));
         return opener ? 'ok' : 'focus on ' + a.tagName.toLowerCase() + ' "' + ((a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24)) + '"'; })()`,
    );
    if (after !== 'ok') failures.push(`after Escape: ${after}`);
  }

  await open(page, 'ruta');
  const planned = await page.evaluate<true | string>(`(async () => {${REACH}${STATES.find((s) => s.name === 'planificada')!.setup}})()`);
  if (planned !== true) failures.push(`planner: ${planned}`);
  else {
    const where = await page.evaluate<string>(
      `(() => { const a = document.activeElement; const main = document.querySelector('main');
         if (!a || a === document.body) return 'body';
         if (!main.contains(a)) return 'outside main: ' + a.tagName;
         return a.tabIndex === -1 && a.tagName === 'DIV' && a.textContent.trim().length > 50 ? 'answer' : a.tagName.toLowerCase() + ' "' + (a.textContent || '').trim().slice(0, 24) + '"'; })()`,
    );
    if (where !== 'answer') failures.push(`after planning, focus is on ${where}, not the answer`);
  }
  return { failures, visited };
}

const only = process.argv[2] === 'light' || process.argv[2] === 'dark' ? process.argv[2] : undefined;
const themes: ('light' | 'dark')[] = only ? [only] : ['light', 'dark'];

await withBrowser(async (browser) => {
  const results = new Map<string, Awaited<ReturnType<typeof audit>>>();
  for (const theme of themes) results.set(theme, await audit(browser, theme));
  const { failures: keyboardFailures, visited: keyboardVisited } = await keyboard(browser);
  const motionFailures = await motion(browser);

  const keys = [...results.get(themes[0])!.keys()];

  console.log('\n=== what was actually looked at ===');
  for (const key of keys) {
    const cells = themes.map((t) => {
      const r = results.get(t)!.get(key)!;
      return `${t} ${String(r.measured).padStart(4)} texts, tightest ${r.tightest.ratio === Infinity ? '-' : r.tightest.ratio.toFixed(2)}, ${String(r.named).padStart(3)} named` +
        (r.reached === 'ok' ? '' : `  [NOT REACHED: ${r.reached}]`);
    });
    console.log(`  ${key.padEnd(22)} ${cells.join('   |   ')}`);
  }

  for (const kind of KINDS) {
    const any = keys.some((k) => themes.some((t) => results.get(t)!.get(k)!.findings.some((f) => f.kind === kind)));
    console.log(`\n=== ${kind} ===${any ? '' : '  none'}`);
    for (const key of keys) {
      const rows = themes.map((t) => results.get(t)!.get(key)!.findings.filter((f) => f.kind === kind));
      if (rows.every((r) => r.length === 0)) continue;
      console.log(`\n  ${key}`);
      themes.forEach((theme, i) => {
        const other = themes.length === 2 ? results.get(themes[1 - i])!.get(key)!.findings.filter((f) => f.kind === kind) : [];
        for (const f of rows[i]) {
          const flag = themes.length === 2 && !other.some((o) => o.where === f.where) ? `  <-- ${theme} only` : '';
          console.log(`    ${theme.padEnd(5)} ${f.value.toFixed(2).padStart(6)} / ${f.need}   ${f.where}${flag}`);
          console.log(`             ${f.detail}`);
        }
      });
    }
  }

  console.log('\n=== console: errors, warnings and uncaught exceptions, per fresh load ===');
  let noisy = 0;
  for (const key of keys) {
    for (const theme of themes) {
      const lines = results.get(theme)!.get(key)!.console;
      if (!lines.length) continue;
      noisy++;
      console.log(`\n  ${key}  (${theme})`);
      for (const line of lines) console.log(`    ${line}`);
    }
  }
  if (!noisy) console.log('  clean: nothing logged above info level on any state, either theme');

  console.log('\n=== keyboard: Tab stays in the menu, Escape closes it and hands focus back, a planned trip takes focus ===');
  if (!keyboardFailures.length) console.log(`  all three hold (${keyboardVisited})`);
  else console.log(`  (${keyboardVisited})`);
  for (const line of keyboardFailures) console.log(`  ${line}`);

  console.log('\n=== reduced motion: with the preference on, nothing keeps animating ===');
  if (!motionFailures.length) console.log('  holds on paradas and mapa');
  for (const line of motionFailures) console.log(`  ${line}`);

  console.log('\n=== totals ===');
  for (const theme of themes) {
    const all = [...results.get(theme)!.values()];
    const n = (k: string) => all.flatMap((r) => r.findings).filter((f) => f.kind === k).length;
    console.log(
      `  ${theme.padEnd(6)} ${all.reduce((s, r) => s + r.measured, 0)} texts, ${all.reduce((s, r) => s + r.named, 0)} controls   ` +
        `contrast ${n('contrast')}   under 12 px ${n('size')}   under 44 px ${n('target')}   ` +
        `unnamed ${n('name')}   no alt ${n('alt')}   overflow ${n('overflow')}   lang ${n('lang')}   headings ${n('headings')}`,
    );
  }
});
