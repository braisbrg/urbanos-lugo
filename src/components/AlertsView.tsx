import { AlertTriangle, HelpCircle, Newspaper, RefreshCw, CheckCircle2, Clock } from 'lucide-react';
import { LOCALE, useLang, useT } from '../i18n';
import { ServiceAlert } from '../types';
import { isSnapshotStale } from '../utils/snapshotAge';
import type { ServiceAlerts } from '../hooks/useServiceAlerts';

interface AlertsViewProps {
  /** Fetched once in App, so this screen and the navigation badge cannot disagree. */
  alerts: ServiceAlerts;
}

/** An instant from the feed (ISO, because one scrape serves every language), or the raw value rather than "Invalid Date". */
function formatInstant(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString(locale);
}

/**
 * Permanent notices about the city rather than today's incidents. The prose lives in the
 * dictionary; the ids, severities and affected lines are facts and stay here. The date
 * is when a person last checked them: a file cannot know whether roadworks are still
 * "current". Move it forward only after actually re-reading the sources.
 */
const NOTICE_META = [
  { id: 'struct-1', severity: 'warning' as const, linesAffected: ['1.3', '3.1', '3.2'] },
  { id: 'struct-2', severity: 'info' as const, linesAffected: ['7', '8', '9', '12'] },
  { id: 'struct-3', severity: 'info' as const, linesAffected: ['Todas'] },
];
const NOTICES_REVIEWED_ON = '2026-08-27';

const external = 'inline-flex min-h-11 items-center text-label font-bold text-accent underline underline-offset-2';

/** The lines a notice names, or "all"; past three, the rest fold into a "+N" with the names on hover. */
function LinesAffected({ lines }: { lines: string[] }) {
  const t = useT();
  const chip = 'text-label font-black bg-bg px-1.5 py-0.5 rounded shadow-xs text-ink border border-edge';
  if (lines.length >= 10 || lines.includes('Todas')) return <span className={`${chip} font-bold px-2 whitespace-nowrap`}>{t.fares.allLines}</span>;
  return (
    <>
      {lines.slice(0, 3).map((l) => (
        <span key={l} className={chip}>
          {l}
        </span>
      ))}
      {lines.length > 3 && (
        <span title={lines.slice(3).join(', ')} className="text-label font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shadow-xs border border-edge cursor-help">
          +{lines.length - 3}
        </span>
      )}
    </>
  );
}

/** One notice: who said it (an operator notice is not a council press release), when, which lines, and the words. */
function AlertCard({ alert, when, source }: { alert: ServiceAlert; when: string; source?: string }) {
  const t = useT();
  const warning = alert.severity === 'warning';
  return (
    <div className={`p-5 rounded-card border transition-all ${warning ? 'bg-warn/60 border-warn' : 'bg-surface/60 border-edge'}`}>
      {source && <span className="text-label font-bold uppercase tracking-wider text-ink-3">{source}</span>}
      <div className="mb-2 mt-1 flex items-center justify-between gap-2">
        <span className={`text-label font-black uppercase tracking-wider px-2 py-0.5 rounded ${warning ? 'bg-warn text-warn-ink' : 'bg-surface text-accent'}`}>{when}</span>
        <div className="flex flex-wrap items-center gap-1 justify-end max-w-[65%]">
          <LinesAffected lines={alert.linesAffected || []} />
        </div>
      </div>
      <h3 className="font-bold text-ink text-body">{alert.title}</h3>
      {/* The operator posts a notice as one line, so the title and the description are the same words. */}
      {alert.description !== alert.title && <p className="text-label text-ink-2 mt-1.5 leading-relaxed">{alert.description}</p>}
      {alert.link && (
        <a href={alert.link} target="_blank" rel="noopener noreferrer" className={`${external} mt-1`}>
          {t.fares.readInFull}
        </a>
      )}
    </div>
  );
}

export function AlertsView({ alerts }: AlertsViewProps) {
  const t = useT();
  const locale = LOCALE[useLang()];
  const { data, snapshotAt, isSyncing, cooldown, refresh } = alerts;

  // The operator is talking about its own buses; the council is publishing news about the city.
  const published = data?.alerts || [];
  const liveAlerts = published.filter((a) => a.source !== 'concello');
  const councilNews = published.filter((a) => a.source === 'concello');
  /** "Could not read the page" is not the same claim as "nothing is wrong". */
  const unreachable = data?.status === 'unreachable';
  const stale = isSnapshotStale(snapshotAt);
  const hour = new Date().getHours();
  const monthsSinceReview = Math.floor((Date.now() - new Date(NOTICES_REVIEWED_ON).getTime()) / (1000 * 60 * 60 * 24 * 30.4));
  const structuralNotices: ServiceAlert[] = NOTICE_META.map((meta, i) => ({ ...meta, ...t.faresContent.notices[i], date: NOTICES_REVIEWED_ON, active: true }));
  const [statusTitle, statusDesc] = unreachable
    ? [t.fares.unknownStatusTitle, t.fares.unknownStatusDesc]
    : stale
      ? [t.fares.staleStatusTitle, t.fares.staleStatusDesc]
      : [t.fares.normalStatusTitle, t.fares.normalStatusDesc];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      {(hour >= 22 || hour < 6) && (
        <div className="p-4 rounded-card bg-surface border border-edge shadow-sm flex items-start gap-3">
          <Clock className="w-5 h-5 text-ink-2 shrink-0 mt-0.5" />
          <div className="text-label">
            <div className="text-body font-semibold">{t.fares.nightWindowTitle}</div>
            <p className="mt-1 text-ink-2 leading-relaxed">{t.fares.nightWindowBody}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-emph font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-estimated" />
              {t.fares.alertsTitle}
            </h2>
            <p className="text-label text-ink-3 mt-0.5">{t.fares.alertsSubtitle}</p>
            <p className="text-label text-ink-3 mt-1 border-l-2 border-edge pl-2">{t.fares.notAffiliated}</p>
          </div>
          <button
            id="sync-alerts-btn"
            onClick={() => refresh(true)}
            disabled={isSyncing || cooldown > 0}
            className={`flex h-11 shrink-0 items-center gap-1.5 self-start rounded-control px-4 text-body font-semibold sm:self-auto ${
              cooldown > 0 ? 'cursor-not-allowed border border-edge bg-surface text-ink-3' : 'bg-accent hover:bg-accent text-on-accent disabled:opacity-50'
            }`}
          >
            {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : cooldown > 0 ? <Clock className="w-3.5 h-3.5 text-ink-2" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>{isSyncing ? t.fares.refreshing : cooldown > 0 ? t.fares.cooldownText(cooldown) : t.fares.refreshBtn}</span>
          </button>
        </div>

        {/* Where these came from when it was not from asking just now: the static build reads the last snapshot, and a stale incident read as current is the worse mistake. */}
        {liveAlerts.length > 0 && (snapshotAt || unreachable) && (
          <p className={`rounded-card border px-4 py-3 text-label leading-relaxed ${stale ? 'border-warn bg-warn/60 text-warn-ink' : 'border-edge bg-surface text-ink-2'}`}>
            {unreachable && !snapshotAt ? t.fares.unknownStatusDesc : t.fares.snapshotNotice(formatInstant(snapshotAt ?? undefined, locale))}
          </p>
        )}

        {liveAlerts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {liveAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} when={formatInstant(alert.date, locale)} source={alert.source === 'concello' ? t.fares.sourceConcello : t.fares.sourceOperator} />
            ))}
          </div>
        ) : (
          <div className="p-5 rounded-card bg-surface border border-edge flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              {/* A green tick is a claim. It only goes on the state actually verified. */}
              <div className={`shrink-0 rounded-control p-2 mt-0.5 ${unreachable ? 'bg-surface text-ink-2 border border-edge' : 'bg-official text-on-official'}`}>
                {unreachable ? <HelpCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
              </div>
              <div>
                <h3 className={`text-body font-bold ${unreachable || stale ? 'text-ink' : 'text-official'}`}>{statusTitle}</h3>
                <p className="text-label text-ink-2 mt-0.5 leading-relaxed">{statusDesc}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-label text-official font-medium">
                  <span>
                    {t.fares.lastCheck} <b>{formatInstant(snapshotAt ?? data?.lastSyncTime, locale)}</b>
                    {snapshotAt && <span className="ml-1 text-official">({t.fares.savedCopy})</span>}
                  </span>
                  <span>&bull;</span>
                  <span>
                    {t.fares.source}{' '}
                    <a href="https://buslugo.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
                      buslugo.com
                    </a>
                  </span>
                </div>
              </div>
            </div>
            <a href="https://buslugo.com" target="_blank" rel="noopener noreferrer" className="flex h-11 shrink-0 items-center justify-center rounded-control border border-edge px-4 text-body font-semibold text-accent">
              {t.fares.checkOnBuslugo} &rarr;
            </a>
          </div>
        )}

        <div className="pt-2">
          <h3 className="text-label font-bold text-ink-2 uppercase tracking-wider">{t.fares.structuralTitle}</h3>
          <p className="mt-1 text-label leading-relaxed text-ink-3">{t.fares.structuralSource}</p>
          {/* Six months is roughly how long a set of roadworks can outlive its own description. */}
          {monthsSinceReview >= 6 && <p className="mt-1 text-label font-semibold leading-relaxed text-estimated">{t.fares.structuralStale(monthsSinceReview)}</p>}
          <div className="mb-3" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {structuralNotices.map((alert) => (
              <AlertCard key={alert.id} alert={alert} when={t.fares.reviewedOn(new Date(alert.date).toLocaleDateString(locale))} />
            ))}
          </div>
        </div>
      </div>

      {/* News from the council: a newspaper column, not a service notice, so below the incidents and without a badge. */}
      {councilNews.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-emph font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-ink-2" />
              {t.fares.newsTitle}
            </h2>
            <p className="text-label text-ink-3 mt-0.5">{t.fares.newsSubtitle}</p>
          </div>
          <ul className="divide-y divide-line rounded-card border border-edge bg-surface/60">
            {councilNews.map((item) => (
              <li key={item.id} className="p-4 sm:p-5">
                <span className="text-label font-bold uppercase tracking-wider text-ink-3">{formatInstant(item.date, locale)}</span>
                <h3 className="mt-1 font-bold text-ink text-body">{item.title}</h3>
                {item.description !== item.title && <p className="text-label text-ink-2 mt-1.5 leading-relaxed">{item.description}</p>}
                {item.link && (
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className={`${external} mt-1`}>
                    {t.fares.readInFull}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
