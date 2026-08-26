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
 * Parses raw HTML or text from buslugo.com to detect any active service notices or traffic alerts.
 */
function extractAlertsFromHtml(html: string): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  
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
      
      // Extract affected lines (e.g. Liña 1.2, L5, L-4.1, etc.)
      const linesFound = Array.from(new Set(
        (cleanText.match(/(?:liña|l[ií]nea|L-?)\s*([0-9]+(?:\.[0-9]+)?(?:ES)?)/gi) || [])
          .map((s) => s.replace(/(?:liña|l[ií]nea|L-?)\s*/i, '').trim())
      ));

      alerts.push({
        id: `live-alert-${i + 1}`,
        title,
        severity: /corte|peche|suprim/i.test(cleanText) ? 'warning' : 'info',
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
      const liveAlerts = extractAlertsFromHtml(html);

      const result: AlertSyncResult = {
        alerts: liveAlerts,
        lastSyncTime: new Date().toISOString(),
        sourceUrl: 'https://buslugo.com',
        status: liveAlerts.length > 0 ? 'active_incidents' : 'operational_normal',
        message: liveAlerts.length > 0
          ? `${liveAlerts.length} aviso(s) oficial(is) activo(s) detectado(s) en buslugo.com`
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
