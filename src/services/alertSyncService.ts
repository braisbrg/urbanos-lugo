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
 * The city's news, by subject.
 *
 * The site-wide feed at `/rss.xml` is ten press releases across fifteen months and mostly
 * about other things. What is actually published is a feed per subject tag, which the tag
 * pages link to as `/all/feed` — a path that answers with HTML. `/es/taxonomy/term/N/feed`
 * is the one that answers with RSS, and it is current: the works feed was carrying the
 * Conde Fontao closure fifteen days after it was written.
 *
 * Three tags, because three are what a passenger is affected by. The rest of the taxonomy
 * is the ordinary business of a council.
 */
const CONCELLO_FEEDS = [
  // Buses urbanos. The tag is precise enough to be its own filter.
  { term: 701, tag: 'buses' as const, alwaysRelevant: true },
  // Obras en ejecución, and Tráfico. Both are broad — the works tag carries expropriations
  // and a dog shelter refurbishment — so these need the headline to be about moving around.
  { term: 600, tag: 'obras' as const, alwaysRelevant: false },
  { term: 707, tag: 'trafico' as const, alwaysRelevant: false },
];

const concelloFeedUrl = (term: number) => `https://concellodelugo.gal/es/taxonomy/term/${term}/feed`;

/** Sixty days. Past that a press release is history, not news. */
const CONCELLO_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Whether a headline from the broad tags is about getting around the city.
 *
 * Only the headline: matching the body as well let through a police communiqué and a
 * speech about sustainable architecture, both of which mention the streets in passing.
 */
const ABOUT_GETTING_AROUND =
  /\b(bus|buses|autobús|autobuses|autobus|transporte|parada|paradas|tráfico|trafico|corte|cortes|desv[íi]o|desvi[oó]|circulaci[óo]n|calle|rúa|rua|avenida|peonaliza|peatonaliza|apertura)\b/i;

export function extractConcelloNotices(xml: string, alwaysRelevant = false): ServiceAlert[] {
  const field = (block: string, name: string): string => {
    const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'i').exec(block);
    return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  };

  const notices: ServiceAlert[] = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []) {
    const title = field(block, 'title');
    if (!title) continue;
    // The bus tag is its own filter; the broad ones are not.
    if (!alwaysRelevant && !ABOUT_GETTING_AROUND.test(title)) continue;

    // Their pubDate is RFC 822 and occasionally missing a timezone. An unparseable or an
    // old one is dropped rather than shown: these feeds hold ten items each going back
    // more than a year, and a press release from last spring beside an incident happening
    // now would read as if both were current.
    const published = new Date(field(block, 'pubDate'));
    if (Number.isNaN(published.getTime())) continue;
    if (Date.now() - published.getTime() > CONCELLO_MAX_AGE_MS) continue;

    notices.push({
      id: `concello-${notices.length + 1}`,
      title: title.length > 110 ? `${title.slice(0, 107)}...` : title,
      severity: 'info',
      linesAffected: ['Todas'],
      date: published.toISOString(),
      description: field(block, 'description'),
      active: true,
      source: 'concello',
      link: field(block, 'link') || undefined,
    });
  }
  return notices;
}

/**
 * Best effort, and deliberately so: the operator's notices are the ones that matter, and
 * nothing here may take them down with it. Three requests an hour against a council's
 * news feeds, with a User-Agent that says who is asking.
 */
async function fetchConcelloNotices(): Promise<ServiceAlert[]> {
  const headers = { 'User-Agent': `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)` };
  const perFeed = await Promise.all(
    CONCELLO_FEEDS.map(async ({ term, alwaysRelevant }) => {
      try {
        const res = await fetch(concelloFeedUrl(term), { headers, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return [];
        return extractConcelloNotices(await res.text(), alwaysRelevant);
      } catch {
        return [];
      }
    }),
  );

  // One story can carry two of these tags, and the council does tag generously.
  const seen = new Set<string>();
  const merged: ServiceAlert[] = [];
  for (const notice of perFeed.flat()) {
    if (seen.has(notice.title)) continue;
    seen.add(notice.title);
    merged.push({ ...notice, id: `concello-${merged.length + 1}` });
  }
  return merged.sort((a, b) => b.date.localeCompare(a.date));
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
