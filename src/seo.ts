/**
 * What search engines are told about this site.
 *
 * All of it is generated at build time from one URL, because the same build is deployed
 * to a project page under `/<repo>/` and could be deployed to a bare domain, and a
 * canonical or a sitemap with the wrong origin is worse than none: it points crawlers at
 * pages that do not exist.
 *
 * `SITE_URL` is set by the workflow. Without it the tags are omitted entirely rather
 * than guessed, so a local build never ships a canonical pointing at somebody's laptop.
 */

import type { Tab } from './components/navSections';
import { PATHS } from './routes';

/** The site's own address, with a trailing slash, or null when nothing was configured. */
export function siteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return url.href.endsWith('/') ? url.href : `${url.href}/`;
  } catch {
    return null;
  }
}

/**
 * Structured data.
 *
 * `WebApplication` rather than anything that would read as the operator's own service:
 * this is a reader for a public timetable, and `disambiguatingDescription` says so in
 * the one field a crawler is likely to surface. Nothing here claims AULUSA or the
 * Concello publishes it.
 */
export function structuredData(site: string): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Urbanos de Lugo',
    url: site,
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript.',
    inLanguage: ['gl', 'es', 'en'],
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    description:
      'Liñas, paradas e tempos de paso do autobús urbano de Lugo, cos horarios que publica o operador e as estimacións sempre etiquetadas como tales.',
    disambiguatingDescription:
      'Proxecto non oficial. Non está feito nin avalado por AULUSA, Grupo Monbus nin o Concello de Lugo: le o cadro horario que o operador publica en buslugo.com.',
    about: {
      '@type': 'Service',
      name: 'Autobús urbano de Lugo',
      areaServed: { '@type': 'City', name: 'Lugo', address: { '@type': 'PostalAddress', addressCountry: 'ES' } },
    },
  });
}

/** Crawlers are welcome everywhere; there is nothing here that is not public already. */
export function robotsTxt(site: string): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${site}sitemap.xml`, ''].join('\n');
}

/**
 * The paths a crawler should know about: the root and one per tab.
 *
 * Taken from the router's own record rather than typed out again, because the copy that
 * used to be here was free to drift from it and nothing would have said so.
 */
export const SITE_PATHS = ['', ...Object.values(PATHS)];

/**
 * The address of a route, as the sitemap, the canonical and the share button spell it.
 *
 * With the trailing slash: each tab is a directory with an index.html in it, and Pages
 * answers `/linhas` with a 301 to `/linhas/`. Six of the seven sitemap entries redirected,
 * and every shared link took the extra round trip.
 */
export function routeUrl(site: string, route: string): string {
  return route ? `${site}${route}/` : site;
}

/**
 * The sitemap.
 *
 * Seven entries: the root and the six tabs. Individual stops and lines are deliberately
 * absent — they have no URL of their own, and listing pages that render as an empty
 * shell to a crawler would be worse than listing nothing.
 */
export function sitemapXml(site: string, paths: string[] = SITE_PATHS): string {
  const urls = paths.map((p) => `  <url><loc>${routeUrl(site, p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export interface PageHead {
  title: string;
  description: string;
}

/**
 * What each page says about itself, in Galician, for the crawler and the link preview.
 *
 * Every copy of index.html used to carry the root's title and description, so a search
 * engine saw one page seven times over. "Non oficial" opens every description on purpose,
 * and "bus" is in every title because it is the word people search, not "urbanos".
 * Nothing here promises live positions: this network publishes none.
 */
export const ROOT_HEAD: PageHead = {
  title: 'Urbanos de Lugo | Bus urbano: liñas, horarios e paradas',
  description:
    'Non oficial. Liñas, horarios e paradas do autobús urbano de Lugo, cos horarios de buslugo.com e estimacións sempre etiquetadas. Esta rede non publica GPS.',
};

const TAB_HEAD: Record<Tab, PageHead> = {
  stops: {
    title: 'Paradas do bus urbano de Lugo | Urbanos de Lugo',
    description:
      'Non oficial. Busca unha parada do bus urbano de Lugo e mira que liñas pasan por ela e os seguintes pasos, calculados do cadro horario de buslugo.com.',
  },
  lines: {
    title: 'Liñas e horarios do bus urbano de Lugo | Urbanos de Lugo',
    description:
      'Non oficial. As liñas do bus urbano de Lugo, co percorrido, as paradas de ida e de volta e o horario que publica o operador en buslugo.com.',
  },
  map: {
    title: 'Mapa do bus urbano de Lugo | Urbanos de Lugo',
    description:
      'Non oficial. Mapa das paradas e percorridos do bus urbano de Lugo, coa posición estimada dos autobuses segundo o horario: esta rede non publica GPS.',
  },
  plan: {
    title: 'Planificador de ruta en bus por Lugo | Urbanos de Lugo',
    description:
      'Non oficial. Calcula como ir dun punto a outro de Lugo en bus urbano: que liña coller, onde subir e baixar e canto se tarda, cos horarios de buslugo.com.',
  },
  info: {
    title: 'Avisos do bus urbano de Lugo | Urbanos de Lugo',
    description:
      'Non oficial. Avisos do servizo do bus urbano de Lugo tal como os publica o operador: desvíos, cortes e cambios de horario, coa hora da última lectura.',
  },
  fares: {
    title: 'Canto custa o bus urbano de Lugo: tarifas | Urbanos de Lugo',
    description:
      'Non oficial. Tarifas do bus urbano de Lugo tal como as publica buslugo.com: billete ordinario, bono ordinario, bono social e tarxeta TMG.',
  },
};

export function pageHead(route: string): PageHead {
  const tab = (Object.keys(PATHS) as Tab[]).find((t) => PATHS[t] === route);
  return tab ? TAB_HEAD[tab] : ROOT_HEAD;
}

/**
 * The built index.html, re-headed for one route: its own title, description and
 * canonical. The root's tags are the anchors, so index.html has to carry exactly
 * `ROOT_HEAD` -- tools/test.ts holds the two together.
 */
export function pageHtml(html: string, route: string, site: string | null): string {
  const head = pageHead(route);
  const out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${head.title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${head.description}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${head.title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${head.description}`);
  return site ? out.replace(`<link rel="canonical" href="${site}" />`, `<link rel="canonical" href="${routeUrl(site, route)}" />`) : out;
}
