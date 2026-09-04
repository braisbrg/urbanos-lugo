/**
 * Taking the tags out of somebody else's HTML.
 *
 * This was `replace(/<[^>]+>/g, '')`, written seven times across five files. Measured
 * against the cases that matter rather than assumed, because the textbook complaint about
 * that regex — that removing inner tags reassembles an outer one — does not happen here:
 * `[^>]*` is greedy from the first `<`, so `<<a>script>alert(1)` comes out as
 * `script>alert(1)`, which is inert text either way.
 *
 * Two things do happen, both reproduced before being believed:
 *
 *   `<!-- <p>x</p> --> visible`      -> `x --> visible`   (a comment ends at its first `>`)
 *   `<img title="a>b">text`          -> `b">text`         (so does a quoted attribute)
 *
 * Both leak text nobody meant to publish onto a card. Neither is a security hole —
 * everything this produces goes through React, which escapes, or through `escapeHtml` in
 * the map's tooltips, and that is what actually protects a reader — but showing a page
 * author's hidden notes, or half an attribute, is the same class of wrong this project
 * cares about everywhere else.
 */
export function stripTags(html: string, replacement = ' '): string {
  const source = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, replacement);

  // A scanner and not a regex, for the same reason the alert parser stopped using lazy
  // patterns: this reads input somebody else writes, and the pattern that handles quoted
  // attributes correctly needs nested quantifiers, which is how a stripper becomes a way
  // to hang the process. This is one pass, left to right, no backtracking.
  let out = '';
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('<', i);
    if (open === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, open);

    // A comment runs to `-->`, not to the first `>`. Getting that wrong is what put a
    // page author's hidden notes on a card.
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      out += replacement;
      i = end === -1 ? source.length : end + 3;
      continue;
    }

    // Otherwise scan to the closing `>`, stepping over quoted attribute values so that a
    // `title="a>b"` does not end the tag halfway and spill `b">` into the text.
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
    // An unterminated tag swallows the rest: an author who opened `<` and never closed it
    // wrote no text after it either.
    i = j >= source.length ? source.length : j + 1;
  }
  return out;
}

/** Tags out, runs of whitespace collapsed, ends trimmed — the common case. */
export function plainText(html: string, replacement = ' '): string {
  return stripTags(html, replacement).replace(/\s+/g, ' ').trim();
}
