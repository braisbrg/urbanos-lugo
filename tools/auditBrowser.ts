/**
 * What the app looks like against its own bar, in both themes.
 *
 *   pnpm build && PORT=3002 pnpm start     # in another terminal
 *   pnpm run audit:browser                 # every screen, light and dark
 *   pnpm run audit:browser light           # one theme
 *
 * The bar: nothing interactive under 44x44, no text under 12 px, no contrast failure
 * (WCAG: 4.5 for body text, 3.0 for large). Colours are resolved by painting them to a
 * canvas and reading the pixel back, because the app is written in oklch() and a regex
 * over rgb() silently scores 1.00 everywhere. Run by hand or by the weekly measure
 * workflow, not a gate: the bar is this project's own.
 */
import { BASE, phonePage, withBrowser, type Browser } from './cdp';
import { sleep } from './lib';

interface Finding {
  kind: 'contrast' | 'size' | 'target';
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

  const seen = new Set();
  const findings = [];
  const push = (kind, el, detail, value, need) => {
    const key = kind + '|' + detail + '|' + value.toFixed(2);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, where: label(el), detail, value, need });
  };

  // Proof the probe is looking: a clean report comes with a count and the closest thing
  // to a failure it found, or it is indistinguishable from a probe that broke.
  let measured = 0;
  let tightest = { ratio: Infinity, where: '', detail: '' };
  let smallest = Infinity;

  const onCanvas = (el) => !!el.closest('.leaflet-container');
  // Visually hidden until focused, so its 1x1 box is the point rather than a defect.
  const offscreen = (el) => !!el.closest('.sr-only');

  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    // Text: only the element that directly owns it, so a wrapper is not blamed twice.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && !onCanvas(el)) {
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      if (size < 12) push('size', el, size.toFixed(1) + ' px', size, 12);

      const bg = backdrop(el);
      const fg = over(rgba(style.color), bg);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const got = ratio(fg, bg);
      measured++;
      smallest = Math.min(smallest, size);
      // Held against the body-text bar, so a heading that only clears the large-text bar
      // still shows up as the tightest thing on the screen.
      if (got < tightest.ratio) {
        tightest = { ratio: got, where: label(el), detail: style.color + ' on rgb(' + bg.map(Math.round).join(',') + ')' };
      }
      if (got < need) {
        push('contrast', el, style.color + ' on rgb(' + bg.map(Math.round).join(',') + ')', got, need);
      }
    }

    const tappable =
      /^(button|a|input|select|textarea|summary)$/.test(el.tagName.toLowerCase()) ||
      el.getAttribute('role') === 'button' ||
      el.hasAttribute('tabindex');
    if (tappable && !onCanvas(el) && !offscreen(el) && el.getAttribute('tabindex') !== '-1') {
      const side = Math.min(box.width, box.height);
      if (side < 44) push('target', el, Math.round(box.width) + 'x' + Math.round(box.height), side, 44);
    }
  }
  return { findings, measured, tightest, smallest };
})()`;

/**
 * Most of this interface is behind an interaction, and a probe that only visits URLs
 * reports a clean bill for the half it never saw. Each state says how to reach it, and
 * says so out loud when it could not.
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

const OPEN_MENU = `if (!hit('men|abrir')) return 'no menu button'; await pause(600); return true;`;
const PLAN_TRIP = `const ins = [...document.querySelectorAll('input')].filter((i) => i.type !== 'checkbox' && i.type !== 'radio');
            if (ins.length < 2) return 'no two fields (' + ins.length + ')';
            fill(ins[0], 'Praza Maior'); await pause(700);
            let opt = document.querySelector('[role=option], ul[role=listbox] li button, .autocomplete button');
            if (opt) { opt.click(); await pause(400); }
            fill(ins[1], 'HULA'); await pause(700);
            opt = document.querySelector('[role=option], ul[role=listbox] li button, .autocomplete button');
            if (opt) { opt.click(); await pause(400); }
            if (!hit('buscar|planificar|ver rutas|calcular')) return 'no plan button';
            await pause(2500); return true;`;

const STATES: { screen: string; name: string; setup?: string }[] = [
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
  { screen: 'paradas', name: 'menu', setup: OPEN_MENU },
  { screen: 'linhas', name: 'lista' },
  {
    screen: 'linhas',
    name: 'linha aberta',
    setup: `const c = document.querySelector('main button[id^="line-card-"]');
            if (!c) return 'no line card'; c.click(); await pause(1200); return true;`,
  },
  { screen: 'mapa', name: 'mapa' },
  { screen: 'mapa', name: 'filtros', setup: `if (!hit('filtros|capas')) return 'no filters button'; await pause(700); return true;` },
  { screen: 'ruta', name: 'baleiro' },
  { screen: 'ruta', name: 'planificada', setup: PLAN_TRIP },
  { screen: 'avisos', name: 'avisos' },
  { screen: 'tarifas', name: 'tarifas' },
];

interface Report {
  findings: Finding[];
  measured: number;
  tightest: { ratio: number; where: string; detail: string };
  smallest: number;
  reached: string;
  console: string[];
}

type Theme = 'light' | 'dark';

/** Reach `setup`'s state on `screen`; 'ok', or the reason it could not be reached. */
const reach = (setup: string) => `(async () => {${REACH}${setup}})()`;

async function audit(browser: Browser, theme: Theme): Promise<Map<string, Report>> {
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

  const out = new Map<string, Report>();
  for (const state of STATES) {
    logged.length = thrown.length = 0;
    await page.goto(`${BASE}/${state.screen}`);
    await page.waitFor('document.querySelector("main, [role=main], body > div")');
    await sleep(2200);
    let reached = 'ok';
    if (state.setup) {
      const got = await page.evaluate<true | string>(reach(state.setup));
      if (got !== true) reached = String(got);
      await sleep(700);
    }
    const report = await page.evaluate<Omit<Report, 'reached' | 'console'>>(PROBE);
    out.set(`${state.screen}/${state.name}`, { ...report, reached, console: [...new Set([...logged, ...thrown.map((line) => `uncaught: ${line}`)])] });
  }
  return out;
}

/**
 * Two things the keyboard has to do, done with the keyboard. tools/test.ts checks that
 * the code for these exists; a grep proves the text, not that focus moves. A real Tab
 * must not leave the open menu, forwards or back, and a planned trip must land focus on
 * the answer rather than leave it on the button.
 */
async function keyboard(browser: Browser): Promise<{ failures: string[]; visited: string }> {
  const page = await phonePage(browser);
  const tab = async (back = false) => {
    const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: back ? 8 : 0 };
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const active = () =>
    page.evaluate<string>(
      `(() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
         return (a.closest('[role=dialog]') ? 'dialog:' : 'outside:') + a.tagName.toLowerCase() + ' "' + ((a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24)) + '"'; })()`,
    );
  const open = async (screen: string) => {
    await page.goto(`${BASE}/${screen}`);
    await page.waitFor('document.querySelector("main")');
    await sleep(2200);
  };
  const failures: string[] = [];
  let visited = 'menu not opened';

  await open('paradas');
  const opened = await page.evaluate<true | string>(reach(OPEN_MENU));
  if (opened !== true) failures.push(`menu: ${opened}`);
  else {
    const count = await page.evaluate<number>(
      `[...document.querySelector('[role=dialog]').querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.matches(':disabled')).length`,
    );
    // Forwards past the last one, then back past the first: every stop is in the dialog.
    const stops = new Set<string>();
    for (const back of [false, true]) {
      for (let i = 0; i < count + 2; i++) {
        await tab(back);
        const at = await active();
        stops.add(at);
        if (!at.startsWith('dialog:')) failures.push(`${back ? 'Shift+Tab' : 'Tab'} ${i + 1} of ${count + 2} left the menu: focus on ${at}`);
      }
    }
    // Proof the key did something: the hook focuses the first control when the menu
    // opens, so a Tab that moved nothing would also never leave the dialog.
    visited = `${stops.size} distinct controls of ${count} in the menu`;
    if (stops.size < Math.min(count, 3)) failures.push(`Tab visited ${stops.size} distinct controls of ${count}: the key is not moving focus, so this proved nothing`);
  }

  await open('ruta');
  const planned = await page.evaluate<true | string>(reach(PLAN_TRIP));
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
const themes: Theme[] = only ? [only] : ['light', 'dark'];

await withBrowser(async (browser) => {
  const results = new Map<Theme, Map<string, Report>>();
  for (const theme of themes) results.set(theme, await audit(browser, theme));
  const { failures: keyboardFailures, visited: keyboardVisited } = await keyboard(browser);

  const of = (theme: Theme, key: string) => results.get(theme)!.get(key)!;
  const keys = [...results.get(themes[0])!.keys()];

  console.log('\n=== what was actually looked at ===');
  for (const key of keys) {
    const cells = themes.map((t) => {
      const r = of(t, key);
      return `${t} ${String(r.measured).padStart(4)} texts, tightest ${r.tightest.ratio === Infinity ? '-' : r.tightest.ratio.toFixed(2)}` + (r.reached === 'ok' ? '' : `  [NOT REACHED: ${r.reached}]`);
    });
    console.log(`  ${key.padEnd(22)} ${cells.join('   |   ')}`);
  }

  for (const kind of ['contrast', 'size', 'target'] as const) {
    const ofKind = (theme: Theme, key: string) => of(theme, key).findings.filter((f) => f.kind === kind);
    const any = keys.some((k) => themes.some((t) => ofKind(t, k).length));
    console.log(`\n=== ${kind} ===${any ? '' : '  none'}`);
    for (const key of keys) {
      const rows = themes.map((t) => ofKind(t, key));
      if (rows.every((r) => r.length === 0)) continue;
      console.log(`\n  ${key}`);
      themes.forEach((theme, i) => {
        const other = themes.length === 2 ? ofKind(themes[1 - i], key) : [];
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
      const lines = of(theme, key).console;
      if (!lines.length) continue;
      noisy++;
      console.log(`\n  ${key}  (${theme})`);
      for (const line of lines) console.log(`    ${line}`);
    }
  }
  if (!noisy) console.log('  clean: nothing logged above info level on any state, either theme');

  console.log('\n=== keyboard: Tab stays in the menu, a planned trip takes focus ===');
  console.log(keyboardFailures.length ? `  (${keyboardVisited})` : `  both hold (${keyboardVisited})`);
  for (const line of keyboardFailures) console.log(`  ${line}`);

  console.log('\n=== totals ===');
  for (const theme of themes) {
    const all = [...results.get(theme)!.values()];
    const n = (k: string) => all.flatMap((r) => r.findings).filter((f) => f.kind === k).length;
    console.log(`  ${theme.padEnd(6)} ${all.reduce((s, r) => s + r.measured, 0)} texts measured   contrast ${n('contrast')}   under 12 px ${n('size')}   under 44 px ${n('target')}`);
  }
});
