/**
 * The operator's service notices and the council's traffic notices, read by a server:
 * neither site sends a CORS header, so the browser cannot. Web standards only — this runs
 * under Node and under Deno.
 */
import { readCapped } from './readCapped';
import { plainText } from '../utils/html';
import { ServiceAlert } from '../types';
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
const CACHE_TTL_MS = 30 * 60 * 1000;
/** Minimum between outbound requests to buslugo.com, whatever anybody asks. */
const MIN_OUTBOUND_INTERVAL_MS = 60 * 1000;

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
 * enough to cause it. `lower` is the same string lower-cased, so scanning twice does not lower-case twice.
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

export function extractConcelloNotices(xml: string): ServiceAlert[] {
  const field = (block: string, name: string): string => {
    const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'i').exec(block);
    return m ? decodedText(m[1]) : '';
  };
  const notices: ServiceAlert[] = [];
  for (const block of blocks(xml, xml.toLowerCase(), '<item>', '</item>')) {
    const title = field(block, 'title');
    if (!title || !ABOUT_GETTING_AROUND.test(title)) continue;
    // Their pubDate is RFC 822 and occasionally missing a timezone; unparseable or old is dropped rather than shown.
    const published = new Date(field(block, 'pubDate'));
    if (Number.isNaN(published.getTime()) || Date.now() - published.getTime() > CONCELLO_MAX_AGE_MS) continue;
    const body = field(block, 'description');
    notices.push({
      id: `concello-${notices.length + 1}`,
      title: clip(title, 110),
      severity: 'info',
      linesAffected: ['Todas'],
      date: published.toISOString(),
      description: body.length > CONCELLO_EXCERPT ? `${body.slice(0, CONCELLO_EXCERPT - 1)}…` : body,
      active: true,
      source: 'concello',
      link: field(block, 'link') || undefined,
    });
  }
  return notices;
}

/** Best effort: the operator's notices are the ones that matter, and nothing here may take them down. */
async function fetchConcelloNotices(): Promise<ServiceAlert[]> {
  try {
    const res = await fetch(CONCELLO_FEED_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    return extractConcelloNotices(await readCapped(res)).sort((a, b) => b.date.localeCompare(a.date));
  } catch {
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

/**
 * The notices in buslugo.com's own navigation bar: a bell with a `msg_list` dropdown, one
 * list item per notice. Nothing in that markup says "alert" to a general scraper, which is
 * how the app once said "running normally" on a day their header read "Retenciones".
 */
/** The bell's own "nothing to report" item: read as one active incident on 19 September 2026, it put a badge on the navigation for a card saying there were no notices. */
const QUIET = /^no(n)?\s+(existen?|ha[iy])\s+avisos\b/i;

function extractNavNotices(html: string): ServiceAlert[] {
  const list = html.match(/<ul[^>]*class="[^"]*msg_list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  if (!list) return [];
  const notices: ServiceAlert[] = [];
  for (const item of blocks(list[1], list[1].toLowerCase(), '<li', '</li>')) {
    const text = plainText(item);
    // A bare "no notices" item, or an empty <li>, is not an incident.
    if (text.length < 6 || QUIET.test(text)) continue;
    notices.push(noticeFrom(`nav-notice-${notices.length + 1}`, text, clip(text, 90)));
  }
  return notices;
}

/** Every notice on the operator's page: the navigation bell, plus any article that reads like one. */
export function extractAlertsFromHtml(html: string): ServiceAlert[] {
  const alerts = extractNavNotices(html);
  [...blocks(html, html.toLowerCase(), '<article', '</article>')].forEach((block, i) => {
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
