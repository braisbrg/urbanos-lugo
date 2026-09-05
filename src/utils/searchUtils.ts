// Search and normalization utilities for resilient accent-insensitive and typo-tolerant search

/**
 * The longest query worth searching for. No street, stop or line in Lugo comes close,
 * and the planner spent 1.7 s on a pasted 5.000-character string before this existed.
 */
export const MAX_QUERY_LENGTH = 120;

export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics / tildes
    .toLowerCase()
    .replace(/[.,/\\-_()#]+/g, ' ') // normalize punctuation to spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance for fuzzy matching typos
function levenshteinDistance(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= an; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }

  return matrix[bn][an];
}

// Checks if target matches query with diacritic removal, substring search, and fuzzy tolerance
export function matchesQuery(target: string, query: string): boolean {
  if (!target || !query) return false;

  // The same form the scorer uses. These disagreed: the filter compared raw normalised
  // text while the score expanded abbreviations, so a query could rank a stop highly and
  // still be filtered out before anything saw the rank.
  const normTarget = searchForm(target);
  const normQuery = searchForm(query);
  // Punctuation normalises away, so "." and "../" arrive as the empty string, and
  // every name in Lugo contains the empty string. A query with nothing left in it
  // matches nothing.
  if (!normQuery) return false;

  if (normTarget.includes(normQuery)) {
    return true;
  }

  const queryWords = normQuery.split(/\s+/).filter(Boolean);
  const targetWords = normTarget.split(/[\s,./\-_()]+/).filter(Boolean);

  // If every query word matches or is very close to a target word
  return queryWords.every((qWord) => {
    return targetWords.some((tWord) => {
      if (tWord === qWord) return true;
      if (tWord.length >= 3 && qWord.length >= 3) {
        if (tWord.includes(qWord) || (tWord.length >= 4 && qWord.includes(tWord))) {
          return true;
        }
      }
      if (qWord.length >= 4 && tWord.length >= 3) {
        const allowedDiff = qWord.length >= 6 ? 2 : 1;
        return levenshteinDistance(tWord, qWord) <= allowedDiff;
      }
      return false;
    });
  });
}

/**
 * The words a street name is padded with, which nobody types the same way twice.
 *
 * The operator writes "Avda. Américas 36". A reader types "Avenida das Américas", or
 * "Avenida de las Américas", and gets nothing — the abbreviation was already handled, the
 * linking words were not, and neither spelling of them appears in the data. Counted over
 * the 417 stops: `de` 29 times, `do` 13, `da` 10, `dos` 6, `das` and `la` once each. They
 * carry no meaning worth matching on; dropping them from both sides is what makes the two
 * spellings, and the operator's third, the same query.
 *
 * Only the unambiguous ones. `a`, `o`, `e` are articles too, and also the whole of a name
 * like "A Ponte".
 */
const LINK_WORDS = /\b(?:de|del|da|do|das|dos|la|las|el|los|lo)\b/g;

/**
 * Street types, in the forms the data uses and the forms people type.
 *
 * The abbreviations are taken from the dataset rather than guessed: of 417 stops, 60
 * start with "Avda.", 36 with "Estda." and 10 with "Czda." — and the last two were
 * missing here, so forty-six stops could not be found by their street type at all.
 *
 * `calle` and `plaza` are not abbreviations but translations. "Rúa" leads 107 of the
 * names, more than any other word in the network, and a Spanish speaker in Lugo types
 * "calle" for it. Refusing that is refusing the most common street in the city.
 *
 * Input has already been through normalizeText, so there are no accents and no dots.
 */
function expandAbbreviations(str: string): string {
  if (!str) return '';
  return str
    .replace(/\bsta\b/g, 'santa')
    .replace(/\bsto\b/g, 'santo')
    .replace(/\bavda\b/g, 'avenida')
    .replace(/\bavd\b/g, 'avenida')
    .replace(/\bav\b/g, 'avenida')
    .replace(/\brda\b/g, 'ronda')
    .replace(/\bestda\b/g, 'estrada')
    .replace(/\bctra\b/g, 'estrada')
    .replace(/\bcarretera\b/g, 'estrada')
    .replace(/\bczda\b/g, 'calzada')
    .replace(/\bplz\b/g, 'praza')
    .replace(/\bpza\b/g, 'praza')
    .replace(/\bplaza\b/g, 'praza')
    .replace(/\bcalle\b/g, 'rua')
    .replace(/\bcol\b/g, 'colexio')
    .replace(/\bprof\b/g, 'profesor');
}

/**
 * One comparable form, used for both the query and the thing being searched.
 *
 * Accents and punctuation go, street types become one spelling, linking words go, and
 * what is left is collapsed. Both sides go through it, so nothing here changes what is
 * displayed — only what counts as the same name.
 */
export function searchForm(str: string): string {
  return expandAbbreviations(normalizeText(str)).replace(LINK_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

// User input goes straight into a RegExp below; "[" alone would throw and take the
// whole search box down with it.
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Calculate relevance score between a target string and search query (higher = more relevant)
export function calculateRelevanceScore(name: string, code: string, id: string, query: string, address?: string): number {
  if (!query) return 0;
  const q = normalizeText(query);
  // Normalising strips punctuation, so "." and "../" arrive here as the empty string
  // and then prefix-match every name in the network at 800 points. That is how a
  // single dot resolved to a real stop with real coordinates.
  if (!q) return 0;
  const n = normalizeText(name);
  const c = normalizeText(code);
  const i = normalizeText(id);
  const a = address ? normalizeText(address) : '';

  const qExp = searchForm(query);
  const nExp = searchForm(name);

  // Exact code match
  if (c === q || i === q) return 1000;

  // Name starts with query (or expanded query)
  if (n.startsWith(q) || nExp.startsWith(qExp)) return 800;

  // Exact word boundary in name (e.g. "americas" matches "Avda. Americas")
  const regex = new RegExp(`\\b${escapeRegex(q)}`, 'i');
  const regexExp = new RegExp(`\\b${escapeRegex(qExp)}`, 'i');
  if (regex.test(n) || regexExp.test(nExp) || nExp.includes(qExp)) return 600;

  // Name contains query
  if (n.includes(q)) return 400;

  // Address contains query
  if (a.includes(q) || (address && searchForm(address).includes(qExp))) return 200;

  // Fuzzy match on words
  const words = n.split(/\s+/);
  for (const w of words) {
    if (q.length >= 4 && levenshteinDistance(w, q) <= (q.length >= 6 ? 2 : 1)) {
      return 100;
    }
  }

  return 0;
}

