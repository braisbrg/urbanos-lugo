import type { BusLine, NoticeSection, ServiceAlert } from '../types';

/** The operator's notices that came written out line by line, as San Froilán 2026 did; never the council's press feed. */
export const sectionedNotices = (alerts: ServiceAlert[] = []): ServiceAlert[] =>
  alerts.filter((alert) => alert.source !== 'concello' && (alert.sections?.length ?? 0) > 0);

/** Whether a section names this line: by the number the operator prints, so "11" names both 11s. */
export const namesLine = (section: NoticeSection, line: Pick<BusLine, 'id' | 'number'>): boolean =>
  section.lines.some((named) => named === line.number || named === line.id);
