/**
 * Do the prices this app prints still match the ones the operator publishes?
 *
 *   pnpm exec tsx tools/checkFares.ts
 *
 * The fares are the one number on the site somebody might act on with money in their
 * hand, and they were written into `src/data/transitData.ts` by hand. Nothing could
 * notice them going out of date: a fare rise is a council decision announced once, and
 * this app would go on saying 0,64 € for a year.
 *
 * buslugo.com/tarifas publishes them as a plain two-column table -- type, price -- which
 * is about as readable as a source gets. One request a week, in the same job that already
 * re-reads that site's timetables.
 *
 * It changes nothing. A disagreement means somebody has to look, decide which is right,
 * and edit the file: a price is not something to update automatically from a scrape.
 */
import { FARES } from '../src/data/transitData';
import { stripTags } from '../src/utils/html';

const URL = 'https://buslugo.com/tarifas/';
const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';

/**
 * The rows worth watching, by the label the operator prints.
 *
 * Matched on a normalised label rather than on position: a row added or reordered would
 * silently shift a positional read onto the wrong price, which is the kind of failure
 * that looks like success.
 */
const WATCHED: { label: string; ours: number; name: string }[] = [
  { label: 'billete ordinario', ours: FARES.singleTicket, name: 'single ticket' },
  { label: 'bono ordinario', ours: FARES.citizenCard, name: 'Tarxeta Cidadá bono' },
  { label: 'bono social', ours: FARES.socialCard, name: 'social bono' },
  { label: 'transbordo ordinario', ours: FARES.transfer, name: 'transfer' },
  { label: 'transbordo social', ours: FARES.transfer, name: 'social transfer' },
];

/** Tags out, entities decoded, whitespace collapsed. */
function plainText(html: string): string {
  const decoded = stripTags(html)
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
  return decoded.replace(/\s+/g, ' ').trim();
}

/** Strip the asterisk the operator hangs off the social rows, and the accents. */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The page, or null when it cannot be had.
 *
 * A refused connection throws rather than returning a status, and letting that out of
 * main() failed the weekly run for a network blip. Their site being unreachable is not
 * this app's prices being wrong, and a job that goes red for it stops being read.
 */
async function fetchFares(attempts = 3): Promise<string | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(URL, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return res.text();
      console.warn(`  buslugo.com answered ${res.status}`);
    } catch (error) {
      console.warn(`  could not reach buslugo.com: ${(error as Error).message}`);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 5_000));
  }
  return null;
}

async function main() {
  console.log(`Reading ${URL} ...`);
  const html = await fetchFares();
  if (html === null) {
    console.warn('Nothing checked, nothing claimed.');
    return;
  }
  const text = plainText(html);

  // Every "<some words> 0,64 €" on the page, label kept as printed.
  const published = new Map<string, number>();
  for (const m of text.matchAll(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ*][A-Za-zÁÉÍÓÚÜÑáéíóúüñ *]{2,40}?)\s(\d+[,.]\d{2})\s*€/g)) {
    const label = normalise(m[1]);
    const price = Number(m[2].replace(',', '.'));
    // Labels run together in the stripped text ("... 0,64 € Bono ordinario 0,45 €"), so
    // the capture is the tail of the run. Keep the last two words, which is what the
    // operator's row names are.
    const words = label.split(' ');
    published.set(words.slice(-2).join(' '), price);
  }

  if (published.size === 0) {
    console.warn('No prices could be read from the page at all. The layout has changed.');
    process.exitCode = 1;
    return;
  }

  console.log(`${published.size} price(s) read from the page\n`);

  const wrong: string[] = [];
  const missing: string[] = [];
  for (const row of WATCHED) {
    const theirs = published.get(row.label);
    if (theirs === undefined) {
      missing.push(`  "${row.label}" is no longer a row on the page (we print ${row.ours.toFixed(2)} €)`);
      continue;
    }
    const line = `  ${row.name.padEnd(22)} ours ${row.ours.toFixed(2)} €   theirs ${theirs.toFixed(2)} €`;
    if (Math.abs(theirs - row.ours) > 0.001) wrong.push(line + '   <-- changed');
    else console.log(line);
  }

  if (wrong.length) {
    console.log(`\n${wrong.length} price(s) no longer match:`);
    wrong.forEach((l) => console.log(l));
  }
  if (missing.length) {
    console.log(`\n${missing.length} row(s) could not be found:`);
    missing.forEach((l) => console.log(l));
  }

  if (wrong.length || missing.length) {
    console.log('\nEdit FARES in src/data/transitData.ts after checking which is right.');
    process.exitCode = 1;
  } else {
    console.log('\nEvery price matches what the operator publishes.');
  }

  // Not on that page, and so not checked here: the 75-minute free-transfer window, and
  // the Xunta's TMG card, which lives at tmg.xunta.gal. Saying so beats implying the
  // whole fare table is watched when two thirds of a card is not.
  console.log(
    `\nNot covered: the ${FARES.freeTransferWindowMinutes}-minute transfer window and the ` +
      'TMG card (tmg.xunta.gal). Neither is published on this page.',
  );
}

main();
