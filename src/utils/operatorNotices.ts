import type { BusLine, NoticeSection, ServiceAlert } from '../types';

/** The sites a notice may link to, over HTTPS: the operator's and the council's, subdomains included. */
const NOTICE_HOSTS = ['buslugo.com', 'concellodelugo.gal'];

/** A notice's link if it goes to one of those sites, else none: a scraped or relayed href is otherwise somebody else's link in our page. */
export function noticeLink(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  try {
    const { protocol, hostname } = new URL(href);
    return protocol === 'https:' && NOTICE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`)) ? href : undefined;
  } catch {
    return undefined;
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/**
 * One notice as the app will render it, whatever the API or the snapshot sent: text where
 * text is expected, lists that are lists, and a link only to a notice site. The live answer
 * reached the screen unread, so a malformed or hostile one broke it or linked anywhere.
 */
export function readNotice(raw: unknown, index: number): ServiceAlert | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const sections = Array.isArray(n.sections)
    ? n.sections.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object').map((s) => ({ heading: text(s.heading), lines: texts(s.lines), paragraphs: texts(s.paragraphs) }))
    : undefined;
  return {
    id: text(n.id) || `notice-${index + 1}`,
    title: text(n.title),
    severity: n.severity === 'urgent' || n.severity === 'warning' ? n.severity : 'info',
    linesAffected: texts(n.linesAffected),
    date: text(n.date),
    description: text(n.description),
    active: n.active !== false,
    source: n.source === 'operator' || n.source === 'concello' ? n.source : undefined,
    link: noticeLink(n.link),
    sections,
  };
}

/** The operator's notices that came written out line by line, as San Froilán 2026 did; never the council's press feed. */
export const sectionedNotices = (alerts: ServiceAlert[] = []): ServiceAlert[] =>
  alerts.filter((alert) => alert.source !== 'concello' && (alert.sections?.length ?? 0) > 0);

/** Whether a section names this line: by the number the operator prints, so "11" names both 11s. */
export const namesLine = (section: NoticeSection, line: Pick<BusLine, 'id' | 'number'>): boolean =>
  section.lines.some((named) => named === line.number || named === line.id);
