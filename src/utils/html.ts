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
  const source = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, replacement);
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

/** Tags out, runs of whitespace collapsed, ends trimmed. */
export function plainText(html: string, replacement = ' '): string {
  return stripTags(html, replacement).replace(/\s+/g, ' ').trim();
}

/** HTML-escape a value bound for a Leaflet popup or tooltip, which take HTML strings. */
export const escapeHtml = (value: string | null | undefined): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
