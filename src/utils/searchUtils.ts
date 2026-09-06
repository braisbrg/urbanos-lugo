// Search and normalization utilities for resilient accent-insensitive and typo-tolerant search

/**
 * The longest query worth searching for. No street, stop or line in Lugo comes close,
 * and the planner spent 1.7 s on a pasted 5.000-character string before this existed.
 */
export const MAX_QUERY_LENGTH = 120;

/**
 * Remember what a fixed string reduces to, because the same 417 names go through these
 * two functions on every keystroke.
 *
 * Typing one letter scores every stop, and each score reduces the stop's name, its code,
 * its id and its neighbourhood as well as the query — none of which have changed since
 * the app loaded. Measured over a realistic run of sixteen queries: 5.35 ms a keystroke
 * before, 1.34 after, and a phone is several times slower than this machine.
 *
 * The names are a fixed set; the queries are not, so each map is emptied rather than
 * grown without limit. Two thousand distinct strings is far more than a session types.
 *
 * Counted since, because the number deserved checking: the stop and line names, codes,
 * ids, zones and aliases are 1,343 distinct strings, so the fixed corpus takes two thirds
 * of the ceiling and a session has 657 queries before the clear takes the names with them.
 * Raising it was tried and reverted — filling these caches at idle moved the first
 * keystroke's median by 16 ms out of 280, which is inside the run-to-run spread, so there
 * is no measured cost here to fix. Left as it was, with the corpus now counted rather
 * than assumed.
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

export const normalizeText = remembering(computeNormalizeText);

function computeNormalizeText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics / tildes
    .toLowerCase()
    // Punctuation becomes a space. The ordinals and the three apostrophes are in the
    // list because the data uses them and a keyboard does not: nineteen stop names
    // carry "N\u00ba" or "McDonald\u00b4s" or a trailing "*", and nobody types the acute accent
    // when they mean an apostrophe. The hyphen sits last so it is a literal and not a
    // range \u2014 written inside the run it quietly swallowed "]" and "^" as well.
    .replace(/[.,/\\_()#*\u00ba\u00aa\u00b4'\u2019-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is `a` within `max` edits of `b`? Which is the only thing anybody ever asked.
 *
 * This used to return the distance, and both callers immediately compared it to a
 * threshold and threw the number away. Computing it in full is what made typing
 * expensive: the fuzzy tier is reached by the stops that matched at no higher tier, which
 * on any real query is nearly all 417, and each one runs this over every word of its
 * name. Measured in a throttled browser typing "Ronda da Muralla" one letter at a time,
 * that was 264 ms in here alone, plus the garbage from a fresh (n+1)x(m+1) array of
 * arrays on every call — about seventeen thousand throwaway arrays per keystroke.
 *
 * Asking the bounded question instead makes three exact shortcuts available, none of
 * which changes an answer:
 *
 *  - A word whose length differs by more than `max` cannot be within `max`: every letter
 *    of the difference is an edit of its own. That is a subtraction, and it answers most
 *    calls before any work starts.
 *  - Two rows rather than a matrix. The algorithm never reads further back than the
 *    previous row, so the rest was allocation.
 *  - Row minima never decrease, so once a whole row is over budget the final cell is too.
 *
 * tools/test.ts checks this against the plain matrix over a corpus of real stop names,
 * because a bound that is subtly wrong is a search that quietly stops finding things.
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
      const cost = bc === a.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(previous[j - 1] + cost, current[j - 1] + 1, previous[j] + 1);
      current[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return false;
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[an] <= max;
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
        return withinEditDistance(tWord, qWord, qWord.length >= 6 ? 2 : 1);
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
 * "linea 12", "liña 12", "L12", "bus 12" — all of them mean the line called 12.
 *
 * A line is stored as its number and its two termini, so every one of those returned
 * nothing: the exact-code test compares the query against "12" and the name has no such
 * word in it. Only the bare number worked, which is not how anyone asks.
 *
 * Stripped here rather than in `searchForm`, and it matters which. Dropping the word
 * everywhere turned the query into "12", which then substring-matched every house number
 * containing it — "Adolfo Suárez 112", "Rúa Lamas de Prado 212" — and buried the line the
 * reader asked for under six of them. Saying "line" should search lines. This reduction
 * is only ever compared against a line's own number.
 *
 * "liña" arrives as "lina": the tilde is gone by the time this runs.
 */
const asLineNumber = (q: string) => q.replace(/^(?:linea|lina|line|bus)\s+/, '').replace(/^l(?=\d)/, '');

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
    // "C/" is how a street is written in Spanish, and it was the largest hole left: the
    // slash normalises to a space, so the query arrived as a bare "c" that matched
    // nothing. "R." is the same abbreviation inside the operator's own names — nine of
    // them read "(esq. R. Vidro)" and the like. The only other standalone "c" in the 417
    // is "C. Novos", and both sides of the comparison go through here, so it stays
    // findable either way. There is no "Rúa C": the Gándaras estate has B, D, E and F.
    .replace(/\bc\b/g, 'rua')
    .replace(/\br\b/g, 'rua')
    // The data spells the same roundabout both ways: "Rtda. Avecus" and "Rotonda Uceira".
    .replace(/\brtda\b/g, 'rotonda')
    .replace(/\bcol\b/g, 'colexio')
    .replace(/\bprof\b/g, 'profesor')
    // Galician and Spanish for the same word. The network is written in Galician and read
    // in both, and four of these pairs are already inconsistent inside the data itself:
    // counted over the stop names, aliases, zones and the places list, `fonte` appears 30
    // times and `fuente` once, `cemiterio` 17 and `cementerio` twice, `igrexa` twice and
    // `iglesia` three times, `nova` twice and `nueva` once. Mapping one way makes those
    // findable as each other. The other four are words nobody has typed into the data but
    // everybody types into a search box: "plaza mayor" for Praza Maior was the one that
    // found nothing while "praza maior" worked.
    //
    // Word boundaries matter here more than anywhere: "Aquilino Iglesias" is a surname,
    // "Casas Vellas" and "Camiños Novos" are plurals, and "Portomarín" is a town.
    .replace(/\bmayor\b/g, 'maior')
    .replace(/\bpuente\b/g, 'ponte')
    .replace(/\bfuente\b/g, 'fonte')
    .replace(/\biglesia\b/g, 'igrexa')
    .replace(/\bcementerio\b/g, 'cemiterio')
    .replace(/\bcolegio\b/g, 'colexio')
    .replace(/\bvieja\b/g, 'vella')
    .replace(/\bnueva\b/g, 'nova')
    // Not a spelling but the same place: the campus is written "Campus Universitario" and
    // a student types "universidade". Nothing else in the network carries the word.
    .replace(/\buniversidade?\b/g, 'universitario');
}

/**
 * One comparable form, used for both the query and the thing being searched.
 *
 * Accents and punctuation go, street types become one spelling, linking words go, and
 * what is left is collapsed. Both sides go through it, so nothing here changes what is
 * displayed — only what counts as the same name.
 */
export const searchForm = remembering(computeSearchForm);

function computeSearchForm(str: string): string {
  const plain = normalizeText(str);
  const form = expandAbbreviations(plain).replace(LINK_WORDS, ' ').replace(/\s+/g, ' ').trim();
  // A query made of nothing but dropped words leaves the empty string, and every name
  // in Lugo contains the empty string: typing "de" scored all 417 at the word-boundary
  // tier and returned six of them at random. When there is nothing left, compare what
  // was actually typed.
  return form || plain;
}

// User input goes straight into a RegExp below; "[" alone would throw and take the
// whole search box down with it.
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Calculate relevance score between a target string and search query (higher = more relevant)
export function calculateRelevanceScore(name: string, code: string, id: string, query: string, context?: string): number {
  if (!query) return 0;
  const q = normalizeText(query);
  // Normalising strips punctuation, so "." and "../" arrive here as the empty string
  // and then prefix-match every name in the network at 800 points. That is how a
  // single dot resolved to a real stop with real coordinates.
  if (!q) return 0;
  const n = normalizeText(name);
  const c = normalizeText(code);
  const i = normalizeText(id);
  const a = context ? normalizeText(context) : '';

  const qExp = searchForm(query);
  const nExp = searchForm(name);

  // Exact code match, including the words people put in front of a line number.
  const asLine = asLineNumber(q);
  if (c === q || i === q || c === asLine || i === asLine) return 1000;

  // Name starts with query (or expanded query)
  if (n.startsWith(q) || nExp.startsWith(qExp)) return 800;

  // Exact word boundary in name (e.g. "americas" matches "Avda. Americas")
  const regex = new RegExp(`\\b${escapeRegex(q)}`, 'i');
  const regexExp = new RegExp(`\\b${escapeRegex(qExp)}`, 'i');
  if (regex.test(n) || regexExp.test(nExp) || nExp.includes(qExp)) return 600;

  // Name contains query
  if (n.includes(q)) return 400;

  // Every word of the query is in the name, just not side by side. The operator puts a
  // landmark between the street and the number — "Rúa Armórica (enfte. Nº 138)" — so
  // "Armórica 138" matched at no tier above and scored zero.
  //
  // Substrings, not edit distance. Calling `matchesQuery` here instead was the obvious
  // reuse and it cost the test suite two minutes: it runs Levenshtein over every pair of
  // words, and this tier is reached by the stops that did NOT match, which is nearly all
  // 417 of them on every keystroke. The fuzzy tier below already covers typos.
  // Word starts, not bare substrings: "de la" is inside "Lavandeira" twice over, and
  // matching that way handed a real stop back for a query that says nothing.
  const queryWords = qExp.split(' ');
  const nameWords = nExp.split(' ');
  if (queryWords.length > 1 && queryWords.every((w) => nameWords.some((t) => t.startsWith(w)))) return 300;

  // The context around the thing: for a stop that is its neighbourhood, for a line its
  // two termini. Below every match on the name itself, so "Milagrosa" still leads with
  // the stop called that and follows with the fifteen that are in it.
  if (a.includes(q) || (context && searchForm(context).includes(qExp))) return 200;

  // Fuzzy match on words
  if (q.length >= 4) {
    const allowed = q.length >= 6 ? 2 : 1;
    for (const w of n.split(/\s+/)) {
      if (withinEditDistance(w, q, allowed)) return 100;
    }
  }

  return 0;
}

