/**
 * Snapshots the operator's service notices into src/data/alerts.json.
 *
 *   npx tsx tools/fetchAlerts.ts
 *
 * The browser cannot fetch buslugo.com directly (CORS), and a static host has no server
 * to proxy it, so a scheduled job runs this and the app reads the snapshot, showing the
 * time it was taken rather than implying the notices are live.
 */
import { at, writeJson } from './lib';
import { syncOfficialAlerts } from '../src/services/alertSyncService';

async function main() {
  const result = await syncOfficialAlerts(true);

  // The sync never throws: an unreachable site comes back as a result like any other.
  // Writing it would replace genuine notices with an empty list, so keep the last one.
  if (result.status === 'unreachable') {
    console.error('buslugo.com could not be read; keeping the previous snapshot.');
    process.exitCode = 1;
    return;
  }

  writeJson(at('src/data/alerts.json'), { ...result, fetchedAt: new Date().toISOString() });
  console.log(`${result.alerts.length} notice(s) from ${result.sourceUrl}`);
  console.log(`status: ${result.status}`);
}

main();
