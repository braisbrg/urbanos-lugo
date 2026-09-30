/**
 * Taking the tags out of somebody else's HTML.
 *
 * A scanner and not `replace(/<[^>]+>/g, '')`: that regex ends a comment at its first `>`
 * (leaking a page author's hidden notes onto a card) and a quoted attribute the same way
 * (`<img title="a>b">text` -> `b">text`), and the pattern that gets both right needs
 * nested quantifiers, which on input somebody else writes is how a stripper hangs the
 * process. One pass, left to right, no backtracking.
 */
export function stripTags(html: string, replacement = ' '): string {
  const source = withoutScriptsAndStyles(html, replacement);
  let out = '';
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('<', i);
    if (open === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, open);
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      out += replacement;
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    let j = open + 1;
    let quote = '';
    while (j < source.length) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    out += replacement;
    // An unterminated tag swallows the rest.
    i = j >= source.length ? source.length : j + 1;
  }
  return out;
}

/**
 * A copy to search case-insensitively whose every index is the original's. `toLowerCase`
 * is not that: "İ" lower-cases to two code units, and a page with eight of them before an
 * article sliced the article eight characters late, so its card began with "> Desvío".
 * Tag and attribute names are ASCII, so folding ASCII alone is all a search needs.
 */
export const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (run) => run.toLowerCase());

/**
 * Every `<script>` and `<style>` block out whole, contents and all, walked with indexOf.
 * The lazy pattern this replaces, `/<(script|style)\b[\s\S]*?<\/\1\s*>/gi`, scanned to the
 * end of the page from every opening that never closed: 7.4 s for the 512 KB readCapped
 * allows. An opening with no closing after it stays, as it did, for the tag scan to take.
 */
function withoutScriptsAndStyles(html: string, replacement: string): string {
  const lower = asciiLower(html);
  const opening = /<(script|style)\b/g;
  // A tag whose closing was looked for and is nowhere further on: every later opening of it fails too.
  const unclosed = new Set<string>();
  let out = '';
  let copied = 0;
  for (let m = opening.exec(lower); m; m = opening.exec(lower)) {
    const tag = m[1];
    if (unclosed.has(tag)) continue;
    const end = closingEnd(lower, tag, m.index + m[0].length);
    if (end === -1) {
      unclosed.add(tag);
      continue;
    }
    out += html.slice(copied, m.index) + replacement;
    copied = end;
    opening.lastIndex = end;
  }
  return out + html.slice(copied);
}

/** Just past the first `</tag>` from `from`, whitespace allowed before its `>`; -1 when there is none. */
function closingEnd(lower: string, tag: string, from: number): number {
  const needle = `</${tag}`;
  for (let at = lower.indexOf(needle, from); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    let i = at + needle.length;
    while (i < lower.length && /\s/.test(lower[i])) i++;
    if (lower[i] === '>') return i + 1;
  }
  return -1;
}

/** Tags out, runs of whitespace collapsed, ends trimmed. */
export function plainText(html: string, replacement = ' '): string {
  return stripTags(html, replacement).replace(/\s+/g, ' ').trim();
}

/** HTML-escape a value bound for a Leaflet popup or tooltip, which take HTML strings. */
export const escapeHtml = (value: string | null | undefined): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
