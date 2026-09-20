/** Accent-insensitive, abbreviation-aware, typo-tolerant search over stop and line names. */

/** No street, stop or line in Lugo comes close; a pasted 5,000-character string once cost 1.7 s. */
export const MAX_QUERY_LENGTH = 120;

/**
 * Memoise a string reduction: the same 417 names go through these on every keystroke
 * (5.35 ms a keystroke before, 1.34 after). The corpus is 1,343 strings; the map is
 * cleared, not grown, past two thousand.
 */
function remembering(compute: (str: string) => string): (str: string) => string {
  const seen = new Map<string, string>();
  return (str) => {
    const found = seen.get(str);
    if (found !== undefined) return found;
    const value = compute(str);
    if (seen.size >= 2000) seen.clear();
    seen.set(str, value);
    return value;
  };
}

export const normalizeText = remembering((str: string): string =>
  !str
    ? ''
    : str
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        // Punctuation becomes a space; the ordinals and the three apostrophes are in the
        // list because the data uses them and a keyboard does not. Hyphen last: literal.
        .replace(/[.,/\\_()#*ºª´'’-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
);

/**
 * Is `a` within `max` edits of `b`? Bounded rather than the full distance: a length gap
 * over `max` answers at once, two rows replace the matrix, and a row whose minimum is
 * over budget ends it. tools/test.ts checks this against the plain matrix.
 */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (Math.abs(an - bn) > max) return false;
  if (an === 0) return bn <= max;
  if (bn === 0) return an <= max;

  let previous = new Array<number>(an + 1);
  let current = new Array<number>(an + 1);
  for (let j = 0; j <= an; j++) previous[j] = j;
  for (let i = 1; i <= bn; i++) {
    current[0] = i;
    let best = i;
    const bc = b.charCodeAt(i - 1);
    for (let j = 1; j <= an; j++) {
      const value = Math.min(previous[j - 1] + (bc === a.charCodeAt(j - 1) ? 0 : 1), current[j - 1] + 1, previous[j] + 1);
      current[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return false;
    [previous, current] = [current, previous];
  }
  return previous[an] <= max;
}

/** Does `target` match `query`: substring, or every query word matching a target word closely enough. */
export function matchesQuery(target: string, query: string): boolean {
  if (!target || !query) return false;
  const normTarget = searchForm(target);
  const normQuery = searchForm(query);
  // Punctuation normalises away, and every name contains the empty string.
  if (!normQuery) return false;
  if (normTarget.includes(normQuery)) return true;

  const targetWords = normTarget.split(/[\s,./\-_()]+/).filter(Boolean);
  return normQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((qWord) =>
      targetWords.some((tWord) => {
        if (tWord === qWord) return true;
        if (tWord.length >= 3 && qWord.length >= 3 && (tWord.includes(qWord) || (tWord.length >= 4 && qWord.includes(tWord)))) return true;
        return qWord.length >= 4 && tWord.length >= 3 && withinEditDistance(tWord, qWord, qWord.length >= 6 ? 2 : 1);
      }),
    );
}

/** The linking words nobody types the same way twice; only the unambiguous ones (`a`, `o` are also names). */
const LINK_WORDS = /\b(?:de|del|da|do|das|dos|la|las|el|los|lo)\b/g;

/**
 * "linea 12", "liña 12", "L12", "bus 12" all mean the line called 12. Only ever compared
 * against a line's number: dropping the word everywhere matched every house number too.
 */
const asLineNumber = (q: string) => q.replace(/^(?:linea|lina|line|bus)\s+/, '').replace(/^l(?=\d)/, '');

/**
 * Street types in the forms the data uses and the forms people type (already normalised:
 * no accents, no dots), plus the Galician/Spanish pairs the data itself spells both ways.
 * Word boundaries matter: "Aquilino Iglesias" is a surname, "Portomarín" a town.
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bsta\b/g, 'santa'],
  [/\bsto\b/g, 'santo'],
  [/\bavda?\b|\bav\b/g, 'avenida'],
  [/\brda\b/g, 'ronda'],
  [/\bestda\b|\bctra\b|\bcarretera\b/g, 'estrada'],
  [/\bczda\b/g, 'calzada'],
  [/\bplz\b|\bpza\b|\bplaza\b/g, 'praza'],
  // "C/" normalises to a bare "c", and "R." is the same abbreviation inside the operator's names.
  [/\bcalle\b|\bc\b|\br\b/g, 'rua'],
  [/\brtda\b/g, 'rotonda'],
  [/\bcol\b/g, 'colexio'],
  [/\bprof\b/g, 'profesor'],
  [/\bmayor\b/g, 'maior'],
  [/\bpuente\b/g, 'ponte'],
  [/\bfuente\b/g, 'fonte'],
  [/\biglesia\b/g, 'igrexa'],
  [/\bcementerio\b/g, 'cemiterio'],
  [/\bcolegio\b/g, 'colexio'],
  [/\bvieja\b/g, 'vella'],
  [/\bnueva\b/g, 'nova'],
  [/\buniversidade?\b/g, 'universitario'],
];

/**
 * One comparable form for both the query and the thing searched: accents and punctuation
 * go, street types become one spelling, linking words go. When nothing is left (a query
 * of only dropped words) the plain form stands, or "de" would match all 417 stops.
 */
const searchForm = remembering((str: string): string => {
  const plain = normalizeText(str);
  const form = ABBREVIATIONS.reduce((s, [re, to]) => s.replace(re, to), plain).replace(LINK_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return form || plain;
});

/** User input goes into a RegExp; "[" alone would take the search box down. */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The word-boundary pattern for a query, built once per query rather than once per stop. */
let boundaryFor = { key: '', regex: /(?:)/ };
const wordBoundary = (q: string): RegExp => {
  if (boundaryFor.key !== q) boundaryFor = { key: q, regex: new RegExp(`\\b${escapeRegex(q)}`, 'i') };
  return boundaryFor.regex;
};
let boundaryExpFor = { key: '', regex: /(?:)/ };
const wordBoundaryExp = (q: string): RegExp => {
  if (boundaryExpFor.key !== q) boundaryExpFor = { key: q, regex: new RegExp(`\\b${escapeRegex(q)}`, 'i') };
  return boundaryExpFor.regex;
};

/** Relevance of a name to a query, in tiers; 0 for no match. */
export function calculateRelevanceScore(name: string, code: string, id: string, query: string, context?: string): number {
  const q = normalizeText(query);
  // "." and "../" normalise to nothing, which would prefix-match every name at 800.
  if (!q) return 0;
  const n = normalizeText(name);
  const c = normalizeText(code);
  const i = normalizeText(id);
  const qExp = searchForm(query);
  const nExp = searchForm(name);

  const asLine = asLineNumber(q);
  if (c === q || i === q || c === asLine || i === asLine) return 1000;
  if (n.startsWith(q) || nExp.startsWith(qExp)) return 800;
  if (wordBoundary(q).test(n) || wordBoundaryExp(qExp).test(nExp) || nExp.includes(qExp)) return 600;
  if (n.includes(q)) return 400;
  // Every word of the query starts a word of the name, not side by side: "Armórica 138"
  // against "Rúa Armórica (enfte. Nº 138)". Word starts, not substrings, or "de la" is
  // inside "Lavandeira" twice over.
  const queryWords = qExp.split(' ');
  const nameWords = nExp.split(' ');
  if (queryWords.length > 1 && queryWords.every((w) => nameWords.some((t) => t.startsWith(w)))) return 300;
  // The context (a stop's neighbourhood, a line's termini), below any match on the name itself.
  const a = context ? normalizeText(context) : '';
  if (a.includes(q) || (context && searchForm(context).includes(qExp))) return 200;
  if (q.length >= 4) {
    const allowed = q.length >= 6 ? 2 : 1;
    for (const w of n.split(/\s+/)) if (withinEditDistance(w, q, allowed)) return 100;
  }
  return 0;
}
