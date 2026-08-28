/** Server-side only: the browser cannot fetch buslugo.com because of CORS. */
import { ServiceAlert } from '../types';
import { REPO_URL } from '../project';

export interface AlertSyncResult {
  alerts: ServiceAlert[];
  /** ISO instant of the sync. Formatted for the reader's locale in the view. */
  lastSyncTime: string;
  sourceUrl: string;
  /**
   * `unreachable` is not a synonym for "nothing wrong". It says the operator's page
   * could not be read, which is the one thing this app must never round down to "all
   * normal" — a network blip during the hourly job would otherwise replace real service
   * notices with a claim that everything is running.
   */
  status: 'operational_normal' | 'active_incidents' | 'unreachable';
  message: string;
  /**
   * Present only on the snapshot committed by the scheduled job, which is what a static
   * deploy reads when there is no server to ask. The type used to omit it, so the view
   * needed a double cast through `unknown` to load its own data file.
   */
  fetchedAt?: string;
}

let cachedAlerts: AlertSyncResult | null = null;
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache
const MIN_OUTBOUND_INTERVAL_MS = 60 * 1000; // 60 seconds minimum cooldown between external requests to buslugo.com


/**
 * The Concello's press feed.
 *
 * The city publishes nothing an app can read about roadworks — the open-data portal
 * answers 503 on its API and 404 on its catalogues, the news page paints itself with
 * JavaScript, and the 010 account lives on a platform that wants a paid key. What does
 * exist is `concellodelugo.gal/rss.xml`: valid RSS, and ten press releases across fifteen
 * months, which is not an incident feed by any stretch.
 *
 * It is still worth reading, because occasionally one of those ten is exactly what a
 * passenger needs — "AUTOBUSES GRATUÍTOS PARA O ACTO DE INICIO DO ARDE LUCUS" was in it.
 * So: read it, keep only what mentions the buses or the streets, and label every one of
 * them as a press release from the Concello with its own date. Never as roadworks checked
 * automatically, which is the thing this cannot do and must not imply.
 */
const CONCELLO_FEED = 'https://concellodelugo.gal/rss.xml';

/** Sixty days. Past that a press release is history, not news. */
const CONCELLO_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

/** Words that make a press release about getting around the city rather than about a plaque. */
const ABOUT_GETTING_AROUND =
  /\b(bus|buses|autobús|autobuses|autobus|transporte|urbano|parada|obras?|tráfico|trafico|corte|cortes|desv[íi]o|circulaci[óo]n|peonaliza|peatonaliza)\b/i;

export function extractConcelloNotices(xml: string): ServiceAlert[] {
  const field = (block: string, name: string): string => {
    const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'i').exec(block);
    return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  };

  const notices: ServiceAlert[] = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []) {
    const title = field(block, 'title');
    const description = field(block, 'description');
    // The headline only. Matching the body as well let through a police communiqué and
    // a speech about sustainable architecture, both of which mention the streets in
    // passing. If getting around the city is not what the headline is about, it is not
    // what the press release is about.
    if (!title || !ABOUT_GETTING_AROUND.test(title)) continue;

    // Their pubDate is RFC 822 and occasionally missing a timezone; an unparseable one
    // becomes no date rather than today's, which would be this app inventing recency.
    // Their pubDate is RFC 822 and occasionally missing a timezone. An unparseable or
    // ancient one is dropped rather than shown: this feed runs at about one item every
    // two months, so without a cutoff the app would present a press release from last
    // spring beside an incident happening now.
    const published = new Date(field(block, 'pubDate'));
    if (Number.isNaN(published.getTime())) continue;
    if (Date.now() - published.getTime() > CONCELLO_MAX_AGE_MS) continue;
    notices.push({
      id: `concello-${notices.length + 1}`,
      title: title.length > 110 ? `${title.slice(0, 107)}...` : title,
      severity: 'info',
      linesAffected: ['Todas'],
      date: published.toISOString(),
      description,
      active: true,
      source: 'concello',
      link: field(block, 'link') || undefined,
    });
  }
  return notices;
}

/** Best effort: the operator's notices are the ones that matter, and this must never break them. */
async function fetchConcelloNotices(): Promise<ServiceAlert[]> {
  try {
    const res = await fetch(CONCELLO_FEED, {
      headers: { 'User-Agent': `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    return extractConcelloNotices(await res.text());
  } catch {
    return [];
  }
}

/** Warnings rather than notes: something is being held up, cut or withdrawn. */
const SERIOUS = /retenc|corte|peche|suprim|desv[ií]o|cancel/i;

/** "Liña 1.2", "L5", "L-4.1" — whatever the notice happens to call them. */
function linesNamedIn(text: string): string[] {
  return Array.from(
    new Set(
      (text.match(/(?:liña|l[ií]nea|L-?)\s*([0-9]+(?:\.[0-9]+)?(?:ES|DS)?)/gi) || []).map((s) =>
        s.replace(/(?:liña|l[ií]nea|L-?)\s*/i, '').trim(),
      ),
    ),
  );
}

/**
 * The notices the operator puts in its own navigation bar.
 *
 * buslugo.com does not publish incidents as articles or as a feed. It publishes them as a
 * bell in the top navigation: a red badge carrying the count, and a `msg_list` dropdown
 * holding one list item per notice. Nothing in that markup says "alert" to a general
 * scraper, which is exactly how this went wrong — the page was read, no <article> was
 * found, and the app told people the network was running normally on a day the operator's
 * own header read "Retenciones en zona Estación Tren".
 *
 * That is the worst direction for this to fail in. An alert we cannot parse is a missing
 * warning; silence reported as "everything normal" is a wrong one.
 */
function extractNavNotices(html: string): ServiceAlert[] {
  const list = html.match(/<ul[^>]*class="[^"]*msg_list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  if (!list) return [];

  const notices: ServiceAlert[] = [];
  for (const item of list[1].match(/<li[\s\S]*?<\/li>/gi) || []) {
    const text = item
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // The dropdown holds a bare "no notices" item on a quiet day in some templates, and
    // an empty <li> in others. Neither is an incident.
    if (text.length < 6) continue;

    notices.push({
      id: `nav-notice-${notices.length + 1}`,
      title: text.length > 90 ? `${text.slice(0, 87)}...` : text,
      severity: SERIOUS.test(text) ? 'warning' : 'info',
      linesAffected: linesNamedIn(text).length > 0 ? linesNamedIn(text) : ['Todas'],
      // An ISO instant, not a formatted date: one scrape serves every language.
      date: new Date().toISOString(),
      description: text,
      active: true,
    });
  }
  return notices;
}

/**
 * Parses raw HTML or text from buslugo.com to detect any active service notices or traffic alerts.
 */
export function extractAlertsFromHtml(html: string): ServiceAlert[] {
  const alerts: ServiceAlert[] = extractNavNotices(html);
  
  // Look for alert containers or notices in buslugo HTML
  const articleRegex = /<article[\s\S]*?<\/article>/gi;
  const matches = html.match(articleRegex) || [];

  for (let i = 0; i < matches.length; i++) {
    const block = matches[i];
    const cleanText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Check if it contains alert keywords
    if (/desv[ií]o|corte|obras|reforzo|aviso|modificaci[oó]n|parada/i.test(cleanText) && cleanText.length > 20) {
      // Extract title if possible
      const titleMatch = block.match(/<h[234][^>]*>(.*?)<\/h[234]>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : `Aviso de servizo en Lugo`;
      
      const linesFound = linesNamedIn(cleanText);

      alerts.push({
        id: `article-alert-${i + 1}`,
        title,
        severity: SERIOUS.test(cleanText) ? 'warning' : 'info',
        linesAffected: linesFound.length > 0 ? linesFound : ['Todas'],
        // An ISO instant, not a formatted date. This payload is scraped once on the
        // server and served to every reader, so it cannot carry one language's format;
        // the view formats it with the reader's locale.
        date: new Date().toISOString(),
        description: cleanText.length > 250 ? cleanText.slice(0, 247) + '...' : cleanText,
        active: true,
      });
    }
  }

  return alerts;
}

/**
 * Synchronizes real alerts from official sources:
 * 1. https://buslugo.com/ (AULUSA Monbus portal)
 * 2. concellodelugo.gal / datosabertos.lugo.gal
 * 
 * Enforces rate limiting: Max 1 external request per 60 seconds.
 */
export async function syncOfficialAlerts(forceRefresh = false): Promise<AlertSyncResult> {
  // Share one outbound request between everyone waiting for it.
  //
  // The cooldown below only applies once there IS a cache, so on a cold start every
  // request that arrives before the first response returns went out to buslugo.com on
  // its own. Small window, well-known shape: hold the promise and hand it to whoever
  // asks meanwhile.
  if (inFlight) return inFlight;

  const now = Date.now();
  const elapsed = now - lastFetchTimestamp;

  // Rate Limiting Protection: If forceRefresh is requested but cooldown hasn't expired, return cache
  if (cachedAlerts && (elapsed < MIN_OUTBOUND_INTERVAL_MS || (!forceRefresh && elapsed < CACHE_TTL_MS))) {
    return cachedAlerts;
  }

  inFlight = fetchAlerts(now);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

let inFlight: Promise<AlertSyncResult> | null = null;

async function fetchAlerts(now: number): Promise<AlertSyncResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    // Fetch official portal
    const response = await fetch('https://buslugo.com/', {
      signal: controller.signal,
      headers: {
        // Say what this actually is. The previous value read "(OpenData; Concello de
        // Lugo)", which tells the operator's server that the city council is calling —
        // it is not, and DATA.md says so in as many words. A scraper should be
        // identifiable and honest about who it is.
        'User-Agent': `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const html = await response.text();
      const operatorAlerts = extractAlertsFromHtml(html).map((a) => ({ ...a, source: 'operator' as const }));
      // The city's feed second, and only ever after the operator's: what the company
      // says about its own service outranks a press release that happens to mention a
      // bus. A failure there returns nothing and changes none of this.
      const cityNotices = await fetchConcelloNotices();
      const liveAlerts = [...operatorAlerts, ...cityNotices];

      const result: AlertSyncResult = {
        alerts: liveAlerts,
        lastSyncTime: new Date().toISOString(),
        sourceUrl: 'https://buslugo.com',
        // The state of the network is the operator's to declare. A press release from
        // the Concello about free buses for Arde Lucus is worth reading and is not an
        // incident, and counting it as one would put a warning on a normal day.
        status: operatorAlerts.length > 0 ? 'active_incidents' : 'operational_normal',
        message: operatorAlerts.length > 0
          ? `${operatorAlerts.length} aviso(s) oficial(is) activo(s) detectado(s) en buslugo.com`
          : 'Rede de transporte operando con total normalidade en todas as liñas e paradas.',
      };

      cachedAlerts = result;
      lastFetchTimestamp = now;
      return result;
    }
  } catch {
    // Network or timeout: return operational normal if no cache
  }

  // The fetch failed, timed out, or the page answered with an error. We know nothing
  // about the service — say that, rather than the opposite.
  const fallback: AlertSyncResult = {
    alerts: [],
    lastSyncTime: new Date().toISOString(),
    sourceUrl: 'https://buslugo.com',
    status: 'unreachable',
    message: 'Non se puido ler a páxina do operador, así que non sabemos se hai avisos.',
  };

  cachedAlerts = fallback;
  lastFetchTimestamp = now;
  return fallback;
}
