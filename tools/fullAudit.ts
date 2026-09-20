/**
 * Human-readable data quality report (`pnpm data:audit`). `npm test` asserts the
 * invariants; this prints the dataset's shape and flags what is suspicious, not wrong.
 */
import { BUS_STOPS, BUS_LINES } from '../src/data/transitData';
import { getDistanceMeters } from '../src/utils/geo';
import { getScheduledBuses } from '../src/utils/vehicles';
import { getArrivalsForStop } from '../src/utils/arrivals';
import { buildRuns, dayKind, isWithinServiceWindow } from '../src/utils/schedule';
import { hydrateGeometry } from './hydrateGeometry';

hydrateGeometry();

type Direction = (typeof BUS_LINES)[number]['directions'][number];

const bar = '='.repeat(72);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
const km = (ds: Direction[]) => ds.reduce((n, d) => n + (d.totalMeters || 0), 0) / 1000;
const stopById = (id: string) => BUS_STOPS.find((s) => s.id === id);

console.log(`\n${bar}\n URBANOS DE LUGO — INFORME DE CALIDADE DE DATOS\n${bar}\n`);

const directions = BUS_LINES.flatMap((l) => l.directions);
const withGeometry = directions.filter((d) => d.stopPathIndex?.length === d.stops.length);
const surveyed = directions.filter((d) => d.geometrySource === 'osm');
const withSchedule = BUS_LINES.filter((l) => l.services?.length);
const byCategory: Record<string, number> = {};
BUS_LINES.forEach((l) => (byCategory[l.category] = (byCategory[l.category] || 0) + 1));

console.log('COBERTURA');
console.log(`  Liñas                 ${BUS_LINES.length}`);
console.log(`  Sentidos              ${directions.length}`);
console.log(`  Paradas               ${BUS_STOPS.length}`);
console.log(`  Con xeometría viaria  ${withGeometry.length}/${directions.length}  (${pct(withGeometry.length, directions.length)})`);
console.log(`  Itinerario levantado  ${surveyed.length}/${directions.length}  (o resto, trazado de OSRM)`);
console.log(`  Con horario oficial   ${withSchedule.length}/${BUS_LINES.length}  (${pct(withSchedule.length, BUS_LINES.length)})`);
console.log(`  Rede total            ${km(directions).toFixed(1)} km`);
console.log(`  Categorías            ${Object.entries(byCategory).map(([k, v]) => `${k}:${v}`).join('  ')}`);

console.log('\nLIÑAS');
console.log('  id      cat        frecuencia     servizo        paradas    km');
for (const line of BUS_LINES) {
  const stops = line.directions.map((d) => d.stops.length).join('/');
  console.log(
    `  ${line.id.padEnd(7)} ${line.category.padEnd(10)} ${line.frequency.padEnd(14)} ` +
      `${(line.firstDeparture + '-' + line.lastDeparture).padEnd(14)} ${stops.padEnd(10)} ${km(line.directions).toFixed(1)}`,
  );
}

console.log('\nTRAMOS SOSPEITOSOS (desvío viario fronte a liña recta > 4x)');
const suspicious: string[] = [];
for (const line of BUS_LINES) {
  for (const dir of line.directions) {
    dir.legMeters?.forEach((road, i) => {
      const a = stopById(dir.stops[i]);
      const b = stopById(dir.stops[i + 1]);
      if (!a || !b) return;
      const straight = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
      const ratio = road / straight;
      if (straight < 40 || !(ratio > 4)) return;
      suspicious.push(
        `  ${ratio.toFixed(1)}x  ${String(road).padStart(5)}m vs ${String(straight).padStart(5)}m  ` +
          `${line.id}/${dir.id}  ${a.name.slice(0, 32)} -> ${b.name.slice(0, 32)}`,
      );
    });
  }
}
const totalLegs = directions.reduce((n, d) => n + (d.legMeters?.length || 0), 0);
if (suspicious.length) {
  suspicious.slice(0, 15).forEach((s) => console.log(s));
  if (suspicious.length > 15) console.log(`  ... e ${suspicious.length - 15} máis`);
  console.log(`  ${suspicious.length}/${totalLegs} tramos (${pct(suspicious.length, totalLegs)}).`);
  console.log('  Adoitan indicar dous postes opostos da mesma rúa no mesmo sentido.');
} else {
  console.log('  Ningún.');
}

console.log('\nESTADO EN VIVO');
const now = new Date();
const nowMinutes = now.getHours() * 60 + now.getMinutes();
const inService = BUS_LINES.filter((l) => isWithinServiceWindow(l, nowMinutes));
const buses = getScheduledBuses(now);
const positions = new Set(buses.map((b) => `${b.currentLat.toFixed(6)},${b.currentLng.toFixed(6)}`));
console.log(`  Hora local            ${now.toLocaleTimeString('gl-ES')} (${dayKind(now)})`);
console.log(`  Liñas en servizo      ${inService.length}/${BUS_LINES.length}`);
console.log(`  Vehículos en ruta     ${buses.length}`);
console.log(`  Posicións distintas   ${positions.size}/${buses.length}${positions.size === buses.length ? '' : '  <-- SOLAPAMENTO'}`);

console.log('\nTABOLEIRO NAS PARADAS MÁIS CONECTADAS');
const busiest = [...BUS_STOPS].sort((a, b) => b.lines.length - a.lines.length).slice(0, 5);
for (const stop of busiest) {
  const { arrivals } = getArrivalsForStop(stop.id, now);
  const preview = arrivals.slice(0, 4).map((a) => `${a.lineNumber}:${a.etaMinutes}min`).join('  ') || 'sen servizo';
  console.log(`  ${stop.code.padEnd(6)} ${stop.name.slice(0, 40).padEnd(42)} ${stop.lines.length} liñas   ${preview}`);
}

console.log('\nHORARIOS');
let runsTotal = 0;
const noRuns: string[] = [];
for (const line of BUS_LINES) {
  line.directions.forEach((dir, i) => {
    const runs = buildRuns(line, i, BUS_STOPS, dayKind(now));
    runsTotal += runs.length;
    if (!runs.length) noRuns.push(`${line.id}/${dir.id}`);
  });
}
console.log(`  Expedicións diarias   ${runsTotal}`);
if (noRuns.length) console.log(`  Sen expedicións       ${noRuns.join(', ')}`);

console.log(`\n${bar}\n`);
