/**
 * Read a response body, but stop at a ceiling.
 *
 * Both of this server's outbound readers took `await res.text()` from someone else's site
 * with nothing bounding the size, and both then looked for their fields with lazy
 * `[\s\S]*?` runs. Measured, that pairing is quadratic on malformed input: 64 KB of
 * unclosed `<item>` elements cost 55 ms, 256 KB cost 808 ms, and 1 MB cost 13.2 seconds of
 * a single-threaded server going nowhere. Four megabytes would be about three minutes.
 *
 * Nobody has to attack for that: a truncated page, a CDN interstitial or an error page is
 * exactly "tags that never close". So the body gets a ceiling, which is what a third-party
 * response should have had anyway, and the scans that walk it were made linear.
 *
 * The real pages are 35 to 73 KB, so 512 KB is seven times the largest with room for the
 * council's feed to grow. Past the ceiling the read stops and returns what it has; a page
 * that long is not the page we came for, and the parsers find nothing in the fragment.
 */
export const MAX_BODY_BYTES = 512 * 1024;

export async function readCapped(res: Response, maxBytes = MAX_BODY_BYTES): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Trim the chunk, not just the loop. Checking the running total after appending
      // caps how many chunks are read and not how much text is kept, so one body that
      // arrives in a single chunk sails straight past -- which is exactly what the check
      // in tools/checkParsersUnchanged.ts caught: 1.5 MB returned whole against a 512 KB
      // ceiling. Real responses arrive in small chunks and it looked like it worked.
      const room = maxBytes - seen;
      seen += value.byteLength;
      out += decoder.decode(value.byteLength > room ? value.subarray(0, room) : value, { stream: true });
      if (seen >= maxBytes) break;
    }
  } finally {
    // Let the socket go whether we stopped early or ran out of body.
    await reader.cancel().catch(() => {});
  }
  return out;
}
