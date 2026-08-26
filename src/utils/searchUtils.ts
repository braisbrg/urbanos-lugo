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

  const normTarget = normalizeText(target);
  const normQuery = normalizeText(query);
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

function expandAbbreviations(str: string): string {
  if (!str) return '';
  return str
    .replace(/\bsta\.?\b/gi, 'santa')
    .replace(/\bsta\b/gi, 'santa')
    .replace(/\bsto\.?\b/gi, 'santo')
    .replace(/\bsto\b/gi, 'santo')
    .replace(/\bavda\.?\b/gi, 'avenida')
    .replace(/\bavd\.?\b/gi, 'avenida')
    .replace(/\brda\.?\b/gi, 'ronda')
    .replace(/\bplz\.?\b/gi, 'praza')
    .replace(/\bpza\.?\b/gi, 'praza')
    .replace(/\bcol\.?\b/gi, 'colexio')
    .replace(/\bprof\.?\b/gi, 'profesor');
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

  const qExp = expandAbbreviations(q);
  const nExp = expandAbbreviations(n);

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
  if (a.includes(q) || expandAbbreviations(a).includes(qExp)) return 200;

  // Fuzzy match on words
  const words = n.split(/\s+/);
  for (const w of words) {
    if (q.length >= 4 && levenshteinDistance(w, q) <= (q.length >= 6 ? 2 : 1)) {
      return 100;
    }
  }

  return 0;
}

