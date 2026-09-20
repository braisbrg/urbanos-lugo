/**
 * Read a response body, but stop at a ceiling. Somebody else's page can be a truncated
 * one or a CDN error page, and the parsers that walk it were quadratic on unclosed tags
 * (13.2 s for a megabyte). The real pages are 35 to 73 KB; 512 KB is seven times the largest.
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
      // Trim the chunk, not just the loop: a body arriving in one chunk sailed past a check on the running total.
      const room = maxBytes - seen;
      seen += value.byteLength;
      out += decoder.decode(value.byteLength > room ? value.subarray(0, room) : value, { stream: true });
      if (seen >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}
