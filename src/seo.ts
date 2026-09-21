/**
 * What search engines are told about this site, generated at build time from one URL:
 * the same build is deployed under `/<repo>/` and could be deployed to a bare domain, and
 * a canonical or a sitemap with the wrong origin points crawlers at pages that do not
 * exist. Without `SITE_URL` the tags are omitted rather than guessed.
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

/** `WebApplication`, and `disambiguatingDescription` says whose service it is not. */
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

/** The root and one path per tab, from the router's own record so the two cannot drift. */
export const SITE_PATHS = ['', ...Object.values(PATHS)];

/** With the trailing slash: each tab is a directory with an index.html, and Pages 301s `/linhas` to `/linhas/`. */
export function routeUrl(site: string, route: string): string {
  return route ? `${site}${route}/` : site;
}

/**
 * The one address a screen is indexed under. The root *is* the stops tab: `/` and
 * `/paradas/` draw the same screen, and Search Console read two canonicals as "Duplicate,
 * Google chose a different canonical", rightly. So the stops tab points at the root and
 * stays out of the sitemap; the page still answers 200 with its own title.
 */
export function canonicalUrl(site: string, route: string): string {
  return routeUrl(site, route === PATHS.stops ? '' : route);
}

/** Six entries: the root and the five tabs that are not the root by another name. Stops and lines have no URL of their own. */
export function sitemapXml(site: string, paths: string[] = SITE_PATHS): string {
  const urls = paths
    .filter((p) => canonicalUrl(site, p) === routeUrl(site, p))
    .map((p) => `  <url><loc>${routeUrl(site, p)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export interface PageHead {
  title: string;
  description: string;
}

/**
 * What each page says about itself, in Galician. "Non oficial" opens every description
 * on purpose, "bus" is in every title because it is the word people search, and nothing
 * promises live positions: this network publishes none.
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
 * The built index.html, re-headed for one route: its own title, description, canonical
 * and static <h1>. The root's tags are the anchors, so index.html has to carry exactly
 * `ROOT_HEAD`; tools/test.ts holds the two together.
 */
export function pageHtml(html: string, route: string, site: string | null): string {
  const head = pageHead(route);
  const out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${head.title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${head.description}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${head.title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${head.description}`)
    .replace(/(<h1[^>]*>)[^<]*(<\/h1>)/, `$1${head.title}$2`);
  return site ? out.replace(`<link rel="canonical" href="${site}" />`, `<link rel="canonical" href="${canonicalUrl(site, route)}" />`) : out;
}
