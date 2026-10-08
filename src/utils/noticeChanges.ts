import type { BusStop, ServiceAlert } from '../types';
import { BUS_LINES, BUS_STOPS, lineById } from '../data/transitData';
import { buildRuns, dayKind, isoDay, lineRunsOn } from './schedule';

/**
 * What an operator notice changes, read out of its words so the app can use it and not
 * only show it. San Froilán 2026 came as prose: lines running to 03:07, one stop closed for
 * two lines and one moved for another, on seven named days. Every time here comes from
 * that text and is shown as the notice's, never as a departure: the operator published no
 * departures for the extra hours, and nothing here invents one. What cannot be read
 * reliably (a route that skips a hospital) stays prose, in the notice itself.
 */

/** One line's changes while the notice holds. */
export interface LineChange {
  /** As the operator prints it: "1.2". */
  line: string;
  /** "Prolongación del recorrido hasta las 03:07 (Sindicatos)": its service runs until then. */
  until?: { time: string; to?: string };
  /** "Los días 5 y 12 de octubre el final del servicio tendrá lugar a la 1:00": those days, it ends then. */
  endsEarly?: { days: string[]; time: string };
  /** Stops it does not call at, matched to the dataset, and where it calls instead, as written. */
  closed: { stopId: string; instead?: string }[];
  /** Stops it calls at somewhere else, as written. */
  moved: { stopId: string; to: string }[];
}

export interface NoticeChanges {
  /** The days the notice is for, `YYYY-MM-DD`; empty when it names none. */
  days: string[];
  lines: LineChange[];
  /** The part for every other line ("Resto de líneas"): traffic cuts and provisional stops, as written. */
  general: string[];
}

/** Lowercase, no accents, so «Bretaña» and «Bretana», «Femenino» and «Feminino» can meet. */
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const MONTHS: Record<string, number> = {
  enero: 1, xaneiro: 1, febrero: 2, febreiro: 2, marzo: 3, abril: 4, mayo: 5, maio: 5, junio: 6, xuno: 6, julio: 7, xullo: 7,
  agosto: 8, septiembre: 9, setiembre: 9, setembro: 9, octubre: 10, outubro: 10, noviembre: 11, novembro: 11, diciembre: 12, decembro: 12,
};

/** "los días 3, 4, 5, 9, 10, 11 y 12 de octubre", "os días 3, 4 e 5 de outubro". */
const DAYS = /\b(?:los|os)\s+dias\s+((?:\d{1,2}\s*(?:,|\by\b|\be\b)\s*)*\d{1,2})\s+de\s+([a-z]+)/;
const pad = (n: number) => String(n).padStart(2, '0');

/** The days a sentence names, in the given year; none when it names none or a month we do not know. */
export function daysIn(text: string, year: number): string[] {
  const match = DAYS.exec(fold(text));
  const month = match ? MONTHS[match[2]] : undefined;
  if (!match || !month) return [];
  return match[1]
    .split(/\s*(?:,|\by\b|\be\b)\s*/)
    .map(Number)
    .filter((day) => day >= 1 && day <= 31)
    .map((day) => `${year}-${pad(month)}-${pad(day)}`);
}

const UNTIL = /\b(?:hasta|ata)\s+(?:las|as)\s+(\d{1,2}:\d{2})(?:\s*\(([^)]+)\))?/i;
const ENDS = /(?:final del servicio|final do servizo)[^.]*?\b(?:a la|a las|á|ás)\s+(\d{1,2}:\d{2})/i;
const CLOSED = /\b(?:se suprime la parada de|suprímese a parada de)\s+([^.;]+?)(?:\s+(?:y se habilitará una en|e habilitarase unha en)\s+([^.;]+))?\s*(?:[.;]|$)/i;
const MOVED = /\bmodificaci[óo]n de la parada\s+(.+?)\s+pasará a ubicarse provisionalmente en\s+([^.;]+)/i;

/**
 * The period of a street abbreviation is not the end of a sentence: «esquina Avda. Ramón
 * Ferreiro» was cut at «Avda». Swapped for a one-dot leader of the same length while the
 * patterns run, and put back in what they capture, so the words shown are the operator's.
 */
const LEADER = '․';
const mask = (text: string) => text.replace(/\b(Avda|Avd|Av|Rda|Pza|Sta|Sto|Dr|Ctra|Estda|Esq|Sr|Sra)\./gi, `$1${LEADER}`);
const unmask = (text: string | undefined) => text?.replaceAll(LEADER, '.').trim();

/** Words that carry a stop's name, without the street kinds that are written one way here and another there. */
const SKIP = new Set(['de', 'da', 'do', 'das', 'dos', 'del', 'la', 'el', 'a', 'o', 'os', 'as', 'los', 'las', 'y', 'e', 'en', 'avda', 'av', 'avenida', 'rua', 'r', 'praza', 'plaza', 'pza', 'rda', 'ronda', 'esq', 'esquina']);
const words = (name: string): string[] =>
  fold(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !SKIP.has(w));

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && oneEditApart(a, b));

/**
 * The stop a notice names, among the ones the line serves: the best match of its words,
 * only when it is clear and unique. «Praza de Bretaña» is «Praza Bretaña»; «Avda. Ramón
 * Ferreiro (Femenino)» is «Ramón Ferreiro (Feminino)» and not «(Anexa)». No match is no
 * change: the notice still says it in words.
 */
export function matchStop(name: string, candidates: BusStop[]): string | undefined {
  const want = words(name);
  if (!want.length) return undefined;
  let best: { id: string; score: number } | undefined;
  let tied = false;
  for (const stop of candidates) {
    const have = words(stop.name);
    const score = want.filter((w) => have.some((h) => sameWord(w, h))).length / Math.max(want.length, have.length);
    if (!best || score > best.score) {
      best = { id: stop.id, score };
      tied = false;
    } else if (score === best.score) tied = true;
  }
  return best && best.score >= 0.75 && !tied ? best.id : undefined;
}

const stopsOfLine = (number: string): BusStop[] => {
  const ids = new Set(BUS_LINES.filter((l) => l.number === number || l.id === number).map((l) => l.id));
  return BUS_STOPS.filter((s) => s.lines.some((id) => ids.has(id)));
};

/** Everything the operator's sectioned notices change, or null when none says anything this can use. */
export function readNoticeChanges(alerts: ServiceAlert[], year: number): NoticeChanges | null {
  const notices = alerts.filter((a) => a.source !== 'concello' && (a.sections?.length ?? 0) > 0);
  if (!notices.length) return null;
  const days = [...new Set(notices.flatMap((n) => daysIn(`${n.description} ${n.title}`, year)))];
  const lines: LineChange[] = [];
  const general: string[] = [];
  for (const section of notices.flatMap((n) => n.sections ?? [])) {
    if (!section.lines.length) {
      general.push(...section.paragraphs);
      continue;
    }
    for (const line of section.lines) {
      const change: LineChange = { line, closed: [], moved: [] };
      const candidates = stopsOfLine(line);
      for (const paragraph of section.paragraphs.map(mask)) {
        const until = UNTIL.exec(paragraph);
        if (until && !ENDS.test(paragraph)) change.until = { time: until[1].padStart(5, '0'), to: unmask(until[2]) };
        const ends = ENDS.exec(paragraph);
        if (ends) change.endsEarly = { days: daysIn(paragraph, year), time: ends[1].padStart(5, '0') };
        const closed = CLOSED.exec(paragraph);
        const closedId = closed && matchStop(unmask(closed[1])!, candidates);
        if (closedId) change.closed.push({ stopId: closedId, instead: unmask(closed[2]) });
        const moved = MOVED.exec(paragraph);
        const movedId = moved && matchStop(unmask(moved[1])!, candidates);
        if (movedId) change.moved.push({ stopId: movedId, to: unmask(moved[2])! });
      }
      if (change.until || change.endsEarly || change.closed.length || change.moved.length) lines.push(change);
    }
  }
  if (!lines.length && !general.length) return null;
  // In number order, as every list of lines here is: the notice put the 10 after the 12.
  lines.sort((a, b) => a.line.localeCompare(b.line, 'es', { numeric: true }));
  return { days, lines, general };
}

/** The service night a moment belongs to: before five in the morning it is still the night before. */
export function serviceDay(now: Date): string {
  const day = new Date(now);
  if (day.getHours() < 5) day.setDate(day.getDate() - 1);
  return isoDay(day);
}

/**
 * Whether a notice's own days are all behind: one for «los días 3, 4, 5, 9, 10, 11 y 12 de
 * octubre» says nothing of the 13th, however long the operator's page keeps it. A notice
 * that names no day never ends by this. A day named in January and read in December is next
 * year's, and one named in December and read in January was last year's.
 */
export function noticeOver(alert: ServiceAlert, now: Date): boolean {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const nearest = (day: string) => {
    const gap = Number(day.slice(5, 7)) - month;
    return gap > 6 ? `${year - 1}${day.slice(4)}` : gap < -6 ? `${year + 1}${day.slice(4)}` : day;
  };
  const days = daysIn(`${alert.description} ${alert.title}`, year).map(nearest);
  const today = serviceDay(now);
  return days.length > 0 && days.every((day) => day < today);
}

/** The changes that hold at this moment, or null on a day the notice does not name. */
export function changesNow(changes: NoticeChanges | null, now: Date): NoticeChanges | null {
  if (!changes) return null;
  return changes.days.length && !changes.days.includes(serviceDay(now)) ? null : changes;
}

/** Minutes into the service night, so 23:50 and 01:10 compare the way the night runs. */
const nightMinutes = (hours: number, minutes: number) => (hours < 5 ? hours + 24 : hours) * 60 + minutes;
const nightOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return nightMinutes(h, m);
};
const minutesOf = (now: Date) => nightMinutes(now.getHours(), now.getMinutes());

/**
 * Until when a line runs tonight by the notice, with where to when it says so; undefined if
 * it does not say, or once that time has gone: at 04:00 "until 03:15" is last night's news.
 * The place goes with the time it was written beside: «hasta las 03:00 (Cementerio)» says
 * nothing of where the 01:00 end of the 5th and the 12th is.
 */
export function runsUntil(change: LineChange, now: Date): { time: string; to?: string } | undefined {
  const end = change.endsEarly?.days.includes(serviceDay(now)) ? { time: change.endsEarly.time } : change.until;
  return end && minutesOf(now) <= nightOf(end.time) ? end : undefined;
}

/** Noon: the festival night is the evening and the small hours. At 05:30, before the first bus, the last one is over. */
const NIGHT_FROM = 12 * 60;

/** Whether a line is running past its timetable at this moment, by the notice's own end time. */
export function runsAt(change: LineChange, now: Date): boolean {
  return minutesOf(now) >= NIGHT_FROM && runsUntil(change, now) !== undefined;
}

/**
 * Whether a line's extra hours have begun at this stop: its last printed call of the night is
 * behind and the notice still has it running. From then on the timetable has nothing to show
 * for it, only the notice's end time, and the screen says whose word that is unasked.
 */
export function pastTimetable(change: LineChange, stopId: string, now: Date): boolean {
  if (!runsAt(change, now)) return false;
  const night = new Date(now);
  if (night.getHours() < 5) night.setDate(night.getDate() - 1);
  const kind = dayKind(night);
  let last = -1;
  for (const line of BUS_LINES.filter((l) => (l.number === change.line || l.id === change.line) && lineRunsOn(l, kind))) {
    line.directions.forEach((direction, d) => {
      // Where a run ends is not a call anybody can board, as on the board itself.
      const at = direction.stops.indexOf(stopId);
      if (at >= 0 && at < direction.stops.length - 1) for (const run of buildRuns(line, d, BUS_STOPS, kind)) last = Math.max(last, run.minutesByStopIndex[at] ?? -1);
    });
  }
  return minutesOf(now) > last;
}

/** The latest of these lines' end times tonight, the way the night runs: "03:15" after "01:00". */
export function latestRun(lines: LineChange[], now: Date): string | undefined {
  return lines
    .map((c) => runsUntil(c, now)?.time)
    .filter((time): time is string => time !== undefined)
    .sort((a, b) => nightOf(a) - nightOf(b))
    .at(-1);
}

/** The lines by number that the notice says do not call at this stop, with where to go instead. */
export function closedAt(changes: NoticeChanges | null, stopId: string): { lines: string[]; instead?: string } {
  const here = (changes?.lines ?? []).flatMap((c) => c.closed.filter((s) => s.stopId === stopId).map((s) => ({ line: c.line, instead: s.instead })));
  return { lines: here.map((h) => h.line), instead: here.find((h) => h.instead)?.instead };
}

/** Whether a line, by id or number, skips a stop under the notice. */
export function isClosed(changes: NoticeChanges | null, line: { id: string; number: string }, stopId: string): boolean {
  return (changes?.lines ?? []).some((c) => (c.line === line.number || c.line === line.id) && c.closed.some((s) => s.stopId === stopId));
}

/** When a plan sets off, as a date: its clock, on its day counted from the moment it was planned from. */
export function setsOff(plan: { departureTime: string; daysAhead?: number }, from: Date): Date {
  const [h, m] = plan.departureTime.split(':').map(Number);
  const at = new Date(from);
  at.setDate(at.getDate() + (plan.daysAhead ?? 0));
  at.setHours(h, m, 0, 0);
  // A clock well before the moment planned from, on the same day, is past midnight.
  if (at.getTime() < from.getTime() - 60 * 60_000) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * Plans under the notice of the night the trip is on, not of the moment it is asked: at
 * 01:00 on the 13th the night is still the 12th's, but the first bus of the morning calls at
 * Praza Bretaña again; at 23:50 on the 8th the first bus of the 9th already does not. Asked
 * with the moment planned from, and once more when the answer sets off on another night.
 */
export function underNotice<P extends { departureTime: string; daysAhead?: number }>(
  changes: NoticeChanges | null,
  from: Date,
  plan: (skipsStop: ((lineId: string, stopId: string) => boolean) | undefined) => P[],
): P[] {
  const plans = plan(stopSkipper(changes, from));
  const leaves = plans[0] && setsOff(plans[0], from);
  return !changes || !leaves || serviceDay(leaves) === serviceDay(from) ? plans : plan(stopSkipper(changes, leaves));
}

/** What the planner asks, by line id, at this moment; undefined when the notice closes nothing then. */
export function stopSkipper(changes: NoticeChanges | null, at: Date): ((lineId: string, stopId: string) => boolean) | undefined {
  const holding = changesNow(changes, at);
  if (!holding?.lines.some((c) => c.closed.length)) return undefined;
  return (lineId, stopId) => {
    const line = lineById(lineId);
    return !!line && isClosed(holding, line, stopId);
  };
}
