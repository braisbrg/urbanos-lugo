/**
 * Snapshots the operator's service notices into public/alerts.json.
 *
 *   npx tsx tools/fetchAlerts.ts
 *
 * The browser cannot fetch buslugo.com directly (CORS), so notices normally come from
 * this project's own server. On a static host there is no server, so a scheduled job
 * runs this instead and the app reads the snapshot. The file carries the time it was
 * taken, and the UI shows that rather than implying the notices are live.
 *
 * Under public/, not src/data/: this file changes on every scheduled build, and as an
 * import it changed the hash of the entry chunk and of every chunk that imports from it
 * -- six files, half a megabyte gzipped, renamed five to seven times a day under pages
 * that were open. Served as a plain file, a notice refresh moves 1.4 KB and nothing else.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { syncOfficialAlerts } from '../src/services/alertSyncService';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../public');

async function main() {
  const result = await syncOfficialAlerts(true);

  // Keep the last snapshot we could actually verify.
  //
  // The sync never throws: a failed fetch comes back as a result like any other. So an
  // unconditional write meant one unreachable minute during the hourly job replaced
  // genuine service notices with an empty list — the app would then tell people the
  // network was running normally on the strength of a request that never arrived.
  if (result.status === 'unreachable') {
    console.error('buslugo.com could not be read; keeping the previous snapshot.');
    process.exitCode = 1;
    return;
  }

  const snapshot = { ...result, fetchedAt: new Date().toISOString() };
  writeFileSync(join(PUBLIC, 'alerts.json'), JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`${result.alerts.length} notice(s) from ${result.sourceUrl}`);
  console.log(`status: ${result.status}`);
}

main();
