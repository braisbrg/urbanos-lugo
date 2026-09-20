/**
 * Do the prices this app prints still match the ones buslugo.com/tarifas publishes?
 * `pnpm exec tsx tools/checkFares.ts`, weekly. FARES was written by hand and nothing else
 * would notice a fare rise. A disagreement is reported, never applied from a scrape.
 */
import { FARES } from '../src/data/transitData';
import { stripTags } from '../src/utils/html';
import { fold, sleep } from './lib';

const URL = 'https://buslugo.com/tarifas/';
const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';

/**
 * The rows worth watching, matched on a normalised label rather than on position: a row
 * added or reordered would silently shift a positional read onto the wrong price.
 */
const WATCHED: { label: string; ours: number; name: string }[] = [
  { label: 'billete ordinario', ours: FARES.singleTicket, name: 'single ticket' },
  { label: 'bono ordinario', ours: FARES.citizenCard, name: 'Tarxeta Cidadá bono' },
  { label: 'bono social', ours: FARES.socialCard, name: 'social bono' },
  { label: 'transbordo ordinario', ours: FARES.transfer, name: 'transfer' },
  { label: 'transbordo social', ours: FARES.transfer, name: 'social transfer' },
];

/** Tags out, entities decoded, whitespace collapsed. */
const plainText = (html: string): string =>
  stripTags(html)
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Accents off, and the asterisk the operator hangs off the social rows. */
const normalise = (s: string): string => fold(s).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The page, or null when it cannot be had: their site being unreachable is not this app's
 * prices being wrong, and a weekly job that goes red for a network blip stops being read.
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
    if (attempt < attempts) await sleep(attempt * 5_000);
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

  // Every "<some words> 0,64 €" on the page. Labels run together in the stripped text
  // ("... 0,64 € Bono ordinario 0,45 €"), so the row name is the last two words captured.
  const published = new Map<string, number>();
  for (const m of plainText(html).matchAll(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ*][A-Za-zÁÉÍÓÚÜÑáéíóúüñ *]{2,40}?)\s(\d+[,.]\d{2})\s*€/g)) {
    published.set(normalise(m[1]).split(' ').slice(-2).join(' '), Number(m[2].replace(',', '.')));
  }
  if (published.size === 0) {
    console.warn('No prices could be read from the page at all. The layout has changed.');
    process.exitCode = 1;
    return;
  }
  console.log(`${published.size} price(s) read from the page\n`);

  const wrong: string[] = [];
  const missing: string[] = [];
  for (const { label, ours, name } of WATCHED) {
    const theirs = published.get(label);
    if (theirs === undefined) {
      missing.push(`  "${label}" is no longer a row on the page (we print ${ours.toFixed(2)} €)`);
      continue;
    }
    const line = `  ${name.padEnd(22)} ours ${ours.toFixed(2)} €   theirs ${theirs.toFixed(2)} €`;
    if (Math.abs(theirs - ours) > 0.001) wrong.push(line + '   <-- changed');
    else console.log(line);
  }

  if (wrong.length) console.log(`\n${wrong.length} price(s) no longer match:\n${wrong.join('\n')}`);
  if (missing.length) console.log(`\n${missing.length} row(s) could not be found:\n${missing.join('\n')}`);
  if (wrong.length || missing.length) {
    console.log('\nEdit FARES in src/data/transitData.ts after checking which is right.');
    process.exitCode = 1;
  } else {
    console.log('\nEvery price matches what the operator publishes.');
  }

  // Not on that page, so not checked: say so rather than imply the whole fare table is watched.
  console.log(
    `\nNot covered: the ${FARES.freeTransferWindowMinutes}-minute transfer window and the ` +
      'TMG card (tmg.xunta.gal). Neither is published on this page.',
  );
}

main();
