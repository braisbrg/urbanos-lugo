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
 * The sitemap.
 *
 * Seven entries: the root and the six tabs. Individual stops and lines are deliberately
 * absent — they have no URL of their own, and listing pages that render as an empty
 * shell to a crawler would be worse than listing nothing.
 */
export function sitemapXml(site: string, paths: string[] = SITE_PATHS): string {
  const urls = paths
    .map((p) => `  <url><loc>${site}${p.replace(/^\//, '')}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
