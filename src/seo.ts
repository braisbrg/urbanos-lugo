/**
 * What search engines are told about this site, generated at build time from one URL:
 * the same build is deployed under `/<repo>/` and could be deployed to a bare domain, and
 * a canonical or a sitemap with the wrong origin points crawlers at pages that do not
 * exist. Without `SITE_URL` the tags are omitted rather than guessed.
 */
import type { Tab } from './components/navSections';
import { LANG_PREFIX, PATHS, pathFor, type PathLang } from './routes';

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

/** The three languages with addresses of their own, Galician first: it is the bare one and the x-default. */
export const SITE_LANGS = Object.keys(LANG_PREFIX) as PathLang[];

/** With the trailing slash: each tab is a directory with an index.html, and Pages 301s `/linhas` to `/linhas/`. */
export function routeUrl(site: string, route: string, lang: PathLang = 'gl'): string {
  return `${site}${pathFor(lang, route)}`;
}

/**
 * The one address a screen is indexed under, in each language. The root *is* the stops
 * tab: `/` and `/paradas/` draw the same screen, and Search Console read two canonicals as
 * "Duplicate, Google chose a different canonical", rightly. So the stops tab points at its
 * language's root and stays out of the sitemap; the page still answers 200 with its own title.
 */
export function canonicalUrl(site: string, route: string, lang: PathLang = 'gl'): string {
  return routeUrl(site, route === PATHS.stops ? '' : route, lang);
}

/** Eighteen entries: in each language, the root and the five tabs that are not the root by another name. */
export function sitemapXml(site: string, paths: string[] = SITE_PATHS, langs: PathLang[] = SITE_LANGS): string {
  const urls = langs
    .flatMap((lang) => paths.filter((p) => canonicalUrl(site, p, lang) === routeUrl(site, p, lang)).map((p) => routeUrl(site, p, lang)))
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export interface PageHead {
  title: string;
  description: string;
}

/**
 * What each page says about itself, in each language. The opener says the app is not
 * official on purpose, "bus" is in every title because it is the word people search, and
 * nothing promises live positions: this network publishes none. Place names stay as the
 * operator writes them; only the words around them change.
 */
const HEADS: Record<PathLang, { root: PageHead; tabs: Record<Tab, PageHead> }> = {
  gl: {
    root: {
      title: 'Urbanos de Lugo | Bus urbano: liñas, horarios e paradas',
      description:
        'Non oficial. Liñas, horarios e paradas do autobús urbano de Lugo, cos horarios de buslugo.com e estimacións sempre etiquetadas. Esta rede non publica GPS.',
    },
    tabs: {
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
    },
  },
  es: {
    root: {
      title: 'Urbanos de Lugo | Bus urbano: líneas, horarios y paradas',
      description:
        'No oficial. Líneas, horarios y paradas del autobús urbano de Lugo, con horarios de buslugo.com y estimaciones siempre marcadas. Esta red no publica GPS.',
    },
    tabs: {
      stops: {
        title: 'Paradas del bus urbano de Lugo | Urbanos de Lugo',
        description:
          'No oficial. Busca una parada del bus urbano de Lugo y mira qué líneas pasan por ella y los próximos pasos, calculados del horario de buslugo.com.',
      },
      lines: {
        title: 'Líneas y horarios del bus urbano de Lugo | Urbanos de Lugo',
        description:
          'No oficial. Las líneas del bus urbano de Lugo, con el recorrido, las paradas de ida y de vuelta y el horario que publica el operador en buslugo.com.',
      },
      map: {
        title: 'Mapa del bus urbano de Lugo | Urbanos de Lugo',
        description:
          'No oficial. Mapa de las paradas y recorridos del bus urbano de Lugo, con la posición estimada de los autobuses según el horario: esta red no publica GPS.',
      },
      plan: {
        title: 'Planificador de rutas en bus por Lugo | Urbanos de Lugo',
        description:
          'No oficial. Calcula cómo ir de un punto a otro de Lugo en bus urbano: qué línea coger, dónde subir y bajar y cuánto se tarda, con horarios de buslugo.com.',
      },
      info: {
        title: 'Avisos del bus urbano de Lugo | Urbanos de Lugo',
        description:
          'No oficial. Avisos del bus urbano de Lugo tal como los publica el operador: desvíos, cortes y cambios de horario, con la hora de la última lectura.',
      },
      fares: {
        title: 'Tarifas del bus urbano de Lugo | Urbanos de Lugo',
        description:
          'No oficial. Tarifas del bus urbano de Lugo tal como las publica buslugo.com: billete ordinario, bono ordinario, bono social y tarjeta TMG.',
      },
    },
  },
  en: {
    root: {
      title: 'Urbanos de Lugo | Lugo city bus: lines, timetables and stops',
      description:
        'Unofficial. Lines, timetables and stops of the Lugo city bus, with the buslugo.com timetables and estimates always labelled. This network publishes no GPS.',
    },
    tabs: {
      stops: {
        title: 'Lugo city bus stops | Urbanos de Lugo',
        description:
          'Unofficial. Find a Lugo city bus stop and see which lines call there and the next departures, worked out from the buslugo.com timetable.',
      },
      lines: {
        title: 'Lugo city bus lines and timetables | Urbanos de Lugo',
        description:
          'Unofficial. The Lugo city bus lines, with the route, the stops each way and the timetable the operator publishes on buslugo.com.',
      },
      map: {
        title: 'Lugo city bus map | Urbanos de Lugo',
        description:
          'Unofficial. Map of the Lugo city bus stops and routes, with buses placed by the timetable: this network publishes no GPS.',
      },
      plan: {
        title: 'Lugo city bus journey planner | Urbanos de Lugo',
        description:
          'Unofficial. Work out how to cross Lugo by city bus: which line to take, where to get on and off and how long it takes, from the buslugo.com timetables.',
      },
      info: {
        title: 'Lugo city bus service notices | Urbanos de Lugo',
        description:
          'Unofficial. Lugo city bus service notices as the operator publishes them: diversions, closures and timetable changes, with the time they were last read.',
      },
      fares: {
        title: 'Lugo city bus fares | Urbanos de Lugo',
        description:
          'Unofficial. Lugo city bus fares as buslugo.com publishes them: single ticket, ordinary pass, social pass and the TMG card.',
      },
    },
  },
};

/** The root's head in Galician: index.html carries exactly this, and the build re-heads every copy from it. */
export const ROOT_HEAD: PageHead = HEADS.gl.root;

export function pageHead(route: string, lang: PathLang = 'gl'): PageHead {
  const tab = (Object.keys(PATHS) as Tab[]).find((t) => PATHS[t] === route);
  return tab ? HEADS[lang].tabs[tab] : HEADS[lang].root;
}

/** Open Graph's names for the three, which want a region. */
const OG_LOCALE: Record<PathLang, string> = { gl: 'gl_ES', es: 'es_ES', en: 'en_GB' };

/**
 * The built index.html, re-headed for one route in one language: its `lang`, title,
 * description, Open Graph locale, canonical and static <h1>, and the alternates that tell a
 * search engine which page is the same screen in the other two languages, so it can show
 * each searcher theirs. The root's Galician tags are the anchors, so index.html has to
 * carry exactly `ROOT_HEAD`; tools/test.ts holds the two together.
 */
export function pageHtml(html: string, route: string, site: string | null, lang: PathLang = 'gl'): string {
  const head = pageHead(route, lang);
  const locales = [OG_LOCALE[lang], ...SITE_LANGS.filter((l) => l !== lang).map((l) => OG_LOCALE[l])];
  const out = html
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${head.title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${head.description}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${head.title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${head.description}`)
    .replace(
      /<meta property="og:locale" content="[^"]*" \/>(\s*<meta property="og:locale:alternate" content="[^"]*" \/>)*/,
      locales.map((l, i) => `<meta property="og:locale${i ? ':alternate' : ''}" content="${l}" />`).join('\n    '),
    )
    .replace(/(<h1[^>]*>)[^<]*(<\/h1>)/, `$1${head.title}$2`);
  if (!site) return out;
  const links = [
    `<link rel="canonical" href="${canonicalUrl(site, route, lang)}" />`,
    ...SITE_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${canonicalUrl(site, route, l)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${canonicalUrl(site, route, 'gl')}" />`,
  ];
  return out.replace(`<link rel="canonical" href="${site}" />`, links.join('\n    '));
}
