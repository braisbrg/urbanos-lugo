/**
 * The operator's service notices and the council's traffic notices, read by a server:
 * neither site sends a CORS header, so the browser cannot. Web standards only — this runs
 * under Node and under Deno.
 */
import { readCapped } from './readCapped';
import { asciiLower, plainText } from '../utils/html';
import { noticeLink } from '../utils/operatorNotices';
import { NoticeSection, ServiceAlert } from '../types';
import { REPO_URL } from '../project';

export interface AlertSyncResult {
  alerts: ServiceAlert[];
  /** ISO instant of the sync; the view formats it for the reader's locale. */
  lastSyncTime: string;
  sourceUrl: string;
  /**
   * `unreachable` is not a synonym for "nothing wrong": the operator's page could not be
   * read, which must never be rounded down to "all normal".
   */
  status: 'operational_normal' | 'active_incidents' | 'unreachable';
  message: string;
  /** Present only on the snapshot the scheduled job commits, which a static deploy reads. */
  fetchedAt?: string;
}

const USER_AGENT = `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`;
const OPERATOR_URL = 'https://buslugo.com';

let cachedAlerts: AlertSyncResult | null = null;
let lastFetchTimestamp = 0;
let inFlight: Promise<AlertSyncResult> | null = null;
export const CACHE_TTL_MS = 30 * 60 * 1000;
/** Minimum between outbound requests to buslugo.com, whatever anybody asks. */
export const MIN_OUTBOUND_INTERVAL_MS = 60 * 1000;

/** An answer is held for half an hour; a failure only for the outbound cooldown — a six-second hiccup is not a fact about the next thirty minutes. */
function cacheHolds(cached: AlertSyncResult, elapsed: number, forceRefresh: boolean): boolean {
  if (elapsed < MIN_OUTBOUND_INTERVAL_MS) return true;
  return !forceRefresh && cached.status !== 'unreachable' && elapsed < CACHE_TTL_MS;
}

/**
 * The council's traffic tag alone: audited against sixty days of three feeds, it was the
 * only one carrying anything a passenger could use (closures, diversions), and only for a
 * week, which is how long such a thing lasts.
 */
const CONCELLO_FEED_URL = 'https://concellodelugo.gal/es/taxonomy/term/707/feed';
const CONCELLO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A press release runs for pages; a card wants the first thought. */
const CONCELLO_EXCERPT = 220;

/** Headlines announcing a closure, diversion or restriction — only the event words; "tráfico" alone matched a road-safety course. */
const ABOUT_GETTING_AROUND =
  /\b(cortes?|cortad[oa]s?|cierres?|cerrad[oa]s?|peches?|pechad[oa]s?|desv[íi]os?|desviad[oa]s?|restricci[óo]n(?:es)?|restrici[óo]ns?)\b/i;

/** Plain prose out of an RSS field, which carries its body as entity-encoded markup: decode, then strip. Rendered as text by React, never as HTML. */
function decodedText(raw: string): string {
  const decoded = raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Last, so an escaped `&amp;lt;` does not become a tag on the way through.
    .replace(/&amp;/g, '&');
  return plainText(decoded);
}

/**
 * Each `<open ... </close>` block, walked with indexOf. A lazy `/<tag[\s\S]*?<\/tag>/`
 * restarts from every opening tag and scans to the end when the closing one never comes,
 * which is quadratic: 13.2 s for a megabyte of unclosed `<item>`s, and a truncated page is
 * enough to cause it. `lower` is the same string through asciiLower, whose indices are the
 * original's, so scanning twice does not lower-case twice.
 */
function* blocks(text: string, lower: string, open: string, close: string): Generator<string> {
  for (let from = 0; ; ) {
    const start = lower.indexOf(open, from);
    if (start === -1) return;
    const end = lower.indexOf(close, start);
    if (end === -1) return;
    yield text.slice(start, end + close.length);
    from = end + close.length;
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/**
 * One field of a feed item, CDATA wrapper off, walked with indexOf: the lazy pattern it
 * replaces scanned to the end of the item from every `<title>` that never closed, 11 s for
 * one item at the 512 KB readCapped allows. The first opening and the first closing after
 * it, as the pattern read them.
 */
function feedField(block: string, lower: string, name: string): string {
  const open = lower.indexOf(`<${name}>`);
  if (open === -1) return '';
  const start = open + name.length + 2;
  const end = lower.indexOf(`</${name}>`, start);
  if (end === -1) return '';
  const cdata = lower.startsWith('<![cdata[', start) ? 9 : 0;
  const inner = block.slice(start + cdata, end);
  return decodedText(inner.endsWith(']]>') ? inner.slice(0, -3) : inner);
}

export function extractConcelloNotices(xml: string): ServiceAlert[] {
  const notices: ServiceAlert[] = [];
  for (const block of blocks(xml, asciiLower(xml), '<item>', '</item>')) {
    const lower = asciiLower(block);
    const field = (name: string) => feedField(block, lower, name.toLowerCase());
    const title = field('title');
    if (!title || !ABOUT_GETTING_AROUND.test(title)) continue;
    // Their pubDate is RFC 822 and occasionally missing a timezone; unparseable or old is dropped rather than shown.
    const published = new Date(field('pubDate'));
    if (Number.isNaN(published.getTime()) || Date.now() - published.getTime() > CONCELLO_MAX_AGE_MS) continue;
    const body = field('description');
    notices.push({
      id: `concello-${notices.length + 1}`,
      title: clip(title, 110),
      severity: 'info',
      linesAffected: ['Todas'],
      date: published.toISOString(),
      description: body.length > CONCELLO_EXCERPT ? `${body.slice(0, CONCELLO_EXCERPT - 1)}…` : body,
      active: true,
      source: 'concello',
      link: noticeLink(field('link')),
    });
  }
  return notices;
}

/**
 * Best effort: the operator's notices are the ones that matter, and nothing here may take
 * them down or hold them back. Read after them, the feed held them back for its whole
 * deadline when it would not connect: the worker took 16 s to answer on 6 October 2026,
 * close to the 15 s the feed was then allowed plus the operator's page, and on 5 October a
 * GitHub runner's read had timed out connecting. From a home connection it answers in under a second, so four
 * seconds is room enough. Every read leaves one line saying how it went, so whether a
 * server can reach the feed is something its log says rather than something inferred.
 */
async function fetchConcelloNotices(): Promise<ServiceAlert[]> {
  const started = Date.now();
  try {
    const res = await fetch(CONCELLO_FEED_URL, { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(4_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const notices = extractConcelloNotices(await readCapped(res)).sort((a, b) => b.date.localeCompare(a.date));
    console.log(`council feed read in ${Date.now() - started} ms, ${notices.length} notice(s) kept`);
    return notices;
  } catch (err) {
    const { cause, message } = err as Error & { cause?: { code?: string } };
    console.warn(`council feed not read after ${Date.now() - started} ms (${cause?.code ?? message})`);
    return [];
  }
}

/** Warnings rather than notes: something is being held up, cut or withdrawn. */
const SERIOUS = /retenc|corte|peche|suprim|desv[ií]o|cancel/i;

/** "Liña 1.2", "L5", "L-4.1" — whatever the notice happens to call them. */
function linesNamedIn(text: string): string[] {
  const found = (text.match(/(?:liña|l[ií]nea|L-?)\s*([0-9]+(?:\.[0-9]+)?(?:ES|DS)?)/gi) || []).map((s) => s.replace(/(?:liña|l[ií]nea|L-?)\s*/i, '').trim());
  return [...new Set(found)];
}

const noticeFrom = (id: string, text: string, title: string): ServiceAlert => ({
  id,
  title,
  severity: SERIOUS.test(text) ? 'warning' : 'info',
  linesAffected: linesNamedIn(text).length > 0 ? linesNamedIn(text) : ['Todas'],
  // An ISO instant: one scrape serves every language.
  date: new Date().toISOString(),
  description: text,
  active: true,
});

/** The bell's own "nothing to report" item: read as one active incident on 19 September 2026, it put a badge on the navigation for a card saying there were no notices. */
const QUIET = /^no(n)?\s+(existen?|ha[iy])\s+avisos\b/i;

/**
 * What the `<ul class="... msg_list ...">` holds, walked tag by tag with indexOf. The
 * pattern it replaces, `/<ul[^>]*class="[^"]*msg_list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i`, ran
 * `[^>]*` to the end of the page from every `<ul` whose tag never closed: 50 s of a
 * stopped server for the 512 KB readCapped allows, against a page that merely broke off.
 */
function bellList(html: string, lower: string): string | null {
  for (let from = 0; ; ) {
    const open = lower.indexOf('<ul', from);
    if (open === -1) return null;
    const tagEnd = lower.indexOf('>', open);
    if (tagEnd === -1) return null;
    if (/class="[^"]*msg_list[^"]*"/.test(lower.slice(open, tagEnd))) {
      const close = lower.indexOf('</ul>', tagEnd);
      return close === -1 ? null : html.slice(tagEnd + 1, close);
    }
    from = tagEnd + 1;
  }
}

/**
 * The notices in buslugo.com's own navigation bar: a bell with a `msg_list` dropdown, one
 * list item per notice. Nothing in that markup says "alert" to a general scraper, which is
 * how the app once said "running normally" on a day their header read "Retenciones".
 */
function extractNavNotices(html: string, lower: string): ServiceAlert[] {
  const list = bellList(html, lower);
  if (list === null) return [];
  const notices: ServiceAlert[] = [];
  for (const item of blocks(list, asciiLower(list), '<li', '</li>')) {
    const text = plainText(item);
    // A bare "no notices" item, or an empty <li>, is not an incident.
    if (text.length < 6 || QUIET.test(text)) continue;
    notices.push({ ...noticeFrom(`nav-notice-${notices.length + 1}`, text, clip(text, 90)), link: operatorLink(item) });
  }
  return notices;
}

/** Where a bell item points, kept only when it is the operator's own site: a scraped href is otherwise somebody else's link in our page. */
function operatorLink(item: string): string | undefined {
  const at = item.indexOf('href="');
  if (at === -1) return undefined;
  const end = item.indexOf('"', at + 6);
  const href = end === -1 ? '' : item.slice(at + 6, end);
  return href === OPERATOR_URL || href.startsWith(`${OPERATOR_URL}/`) ? href : undefined;
}

/** A heading that belongs to lines: "Línea 1.2 : …", "Líneas 9 y 12: …", "Liña 5ES - …". */
const LINES_HEADING = /^l[ií](?:neas?|ñas?)\b/iu;
/** Bounds on one notice, whatever the page holds: San Froilán 2026 ran to six lines and the rest, none over five paragraphs. */
const MAX_SECTIONS = 40;
const MAX_PARAGRAPHS = 30;
const MAX_PARAGRAPH = 600;

/**
 * Text out of one heading or paragraph: its tags off with nothing in their place, then the
 * entities (`&#8211;`, `&nbsp;`) decoded. Only inline tags live in there, and the operator's
 * editor splits words across them: a space per tag printed "recorrido h abitual".
 */
const textOf = (fragment: string) => decodedText(plainText(fragment, ''));

/** The lines a heading names, read only up to its colon or dash: the route after it has street numbers in it. */
function linesOfHeading(heading: string): string[] {
  if (!LINES_HEADING.test(heading)) return [];
  return [...new Set(heading.split(/[:–—-]/)[0].match(/\b[0-9]+(?:\.[0-9]+)?(?:ES|DS)?\b/g) ?? [])];
}

/**
 * A notice the operator writes into the body of its home page, which its bell then links to:
 * an <h1>, the days in an <h3>, one <h2> per line ("Línea 1.2 : …") with its paragraphs, and
 * an <h2> for every other line. San Froilán 2026 came this way, and the bell alone carried
 * nothing but "Cambios en las líneas por San Froilán". Walked tag by tag with indexOf, and
 * nothing comes out unless a heading names a line, so the page's ordinary text never reads
 * as a notice. The walk ends at the page's own buttons, which follow every notice.
 */
export function noticeOnPage(html: string, lower = asciiLower(html)): { title: string; days: string; sections: NoticeSection[] } | null {
  let title = '';
  let days = '';
  let sections: NoticeSection[] = [];
  const footer = lower.indexOf('<footer');
  const end = footer === -1 ? lower.length : footer;
  for (let at = lower.indexOf('<h1'); at !== -1 && sections.length <= MAX_SECTIONS; ) {
    const open = lower.indexOf('<', at);
    if (open === -1 || open >= end) break;
    const name = (['h1', 'h2', 'h3', 'p'] as const).find((tag) => lower.startsWith(tag, open + 1) && /[\s>/]/.test(lower[open + 1 + tag.length] ?? ''));
    if (!name) {
      at = open + 1;
      continue;
    }
    const tagEnd = lower.indexOf('>', open);
    const close = tagEnd === -1 ? -1 : lower.indexOf(`</${name}>`, tagEnd);
    if (close === -1) break;
    const inner = html.slice(tagEnd + 1, close);
    at = close + name.length + 3;
    if (name === 'p' && lower.slice(tagEnd, close).includes('<button')) break;
    if (name === 'h1') {
      // A second notice, or a title before the real one: what came before it named no line.
      if (sections.some((s) => s.lines.length > 0)) break;
      [title, days, sections] = [textOf(inner), '', []];
    } else if (name === 'h3') {
      if (!days && !sections.length) days = textOf(inner);
    } else if (name === 'h2') {
      const heading = textOf(inner);
      if (heading) sections.push({ heading: clip(heading, 160), lines: linesOfHeading(heading), paragraphs: [] });
    } else {
      // Before the first heading a paragraph is the notice's spacing, and nothing reads it.
      const section = sections[sections.length - 1];
      for (const part of section ? inner.split(/<br\s*\/?>/i) : []) {
        const text = textOf(part);
        if (text && section.paragraphs.length < MAX_PARAGRAPHS) section.paragraphs.push(clip(text, MAX_PARAGRAPH));
      }
    }
  }
  const kept = sections.filter((s) => s.paragraphs.length > 0);
  return kept.some((s) => s.lines.length > 0) ? { title, days, sections: kept } : null;
}

/** Every notice on the operator's page: the navigation bell, plus any article that reads like one. */
export function extractAlertsFromHtml(html: string): ServiceAlert[] {
  const lower = asciiLower(html);
  const alerts = extractNavNotices(html, lower);
  // The bell item is the headline and the page it links to the detail, when that page is the home page this is.
  const notice = noticeOnPage(html, lower);
  if (notice) {
    const severity = SERIOUS.test(notice.sections.map((s) => s.paragraphs.join(' ')).join(' ')) ? 'warning' : 'info';
    const headline = alerts.find((a) => a.link === OPERATOR_URL || a.link === `${OPERATOR_URL}/`);
    if (headline) Object.assign(headline, { description: notice.days || headline.description, sections: notice.sections, severity });
    else alerts.push({ ...noticeFrom('page-notice-1', notice.title, clip(notice.title || notice.days, 90)), description: notice.days || notice.title, sections: notice.sections, severity, link: `${OPERATOR_URL}/` });
  }
  [...blocks(html, lower, '<article', '</article>')].forEach((block, i) => {
    const cleanText = plainText(block);
    if (!/desv[ií]o|corte|obras|reforzo|aviso|modificaci[oó]n|parada/i.test(cleanText) || cleanText.length <= 20) return;
    const titleMatch = block.match(/<h[234][^>]*>(.*?)<\/h[234]>/i);
    const title = titleMatch ? plainText(titleMatch[1], '') : 'Aviso de servizo en Lugo';
    alerts.push({ ...noticeFrom(`article-alert-${i + 1}`, cleanText, title), description: clip(cleanText, 250) });
  });
  return alerts;
}

/** Both sources, with one outbound request shared between everyone waiting for it. */
export async function syncOfficialAlerts(forceRefresh = false, now = Date.now()): Promise<AlertSyncResult> {
  if (inFlight) return inFlight;
  if (cachedAlerts && cacheHolds(cachedAlerts, now - lastFetchTimestamp, forceRefresh)) return cachedAlerts;
  inFlight = fetchAlerts(now);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function fetchAlerts(now: number): Promise<AlertSyncResult> {
  let result: AlertSyncResult | null = null;
  try {
    const response = await fetch(`${OPERATOR_URL}/`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      // Every host read here is fixed: a redirect elsewhere is a failed read, not a new destination.
      redirect: 'error',
    });
    if (response.ok) {
      const operatorAlerts = extractAlertsFromHtml(await readCapped(response)).map((a) => ({ ...a, source: 'operator' as const }));
      // The city's feed second, and only ever after the operator's: a failure there changes none of this.
      const cityNotices = await fetchConcelloNotices();
      // The state of the network is the operator's to declare; a council press release is not an incident.
      result = {
        alerts: [...operatorAlerts, ...cityNotices],
        lastSyncTime: new Date().toISOString(),
        sourceUrl: OPERATOR_URL,
        status: operatorAlerts.length > 0 ? 'active_incidents' : 'operational_normal',
        message: operatorAlerts.length > 0 ? `${operatorAlerts.length} aviso(s) oficial(is) activo(s) detectado(s) en buslugo.com` : 'Rede de transporte operando con total normalidade en todas as liñas e paradas.',
      };
    }
  } catch {
    // Network or timeout: say we know nothing, below.
  }
  cachedAlerts = result ?? {
    alerts: [],
    lastSyncTime: new Date().toISOString(),
    sourceUrl: OPERATOR_URL,
    status: 'unreachable',
    message: 'Non se puido ler a páxina do operador, así que non sabemos se hai avisos.',
  };
  lastFetchTimestamp = now;
  return cachedAlerts;
}
