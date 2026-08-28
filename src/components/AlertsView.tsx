import React from 'react';
import { Lang, LOCALE, translations } from '../i18n';
import { AlertTriangle, Info, HelpCircle, Newspaper, RefreshCw, CheckCircle2, Clock } from 'lucide-react';
import { ServiceAlert } from '../types';
import { isSnapshotStale } from '../utils/snapshotAge';
import type { ServiceAlerts } from '../hooks/useServiceAlerts';

interface AlertsViewProps {
  lang: Lang;
  /** Fetched once in App, so this screen and the navigation badge cannot disagree. */
  alerts: ServiceAlerts;
}


/**
 * An instant from the alert feed, shown in the reader's language.
 *
 * The feed carries ISO timestamps because one scrape serves every language; anything
 * already formatted would be stuck in whichever locale the server happened to use. Falls
 * back to the raw value so an older snapshot still shows something rather than "Invalid
 * Date".
 */
function formatInstant(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString(locale);
}


export const AlertsView: React.FC<AlertsViewProps> = ({ lang, alerts }) => {
  const { data: alertData, snapshotAt, isSyncing, cooldown, refresh } = alerts;

  const t = translations(lang);

  // Split by who is speaking. The operator is talking about its own buses, which is
  // what somebody opening this screen came to read; the council is publishing news about
  // the city, which is worth having but is not an answer to "is my bus affected".
  const published = alertData?.alerts || [];
  const liveAlerts = published.filter((a) => a.source !== 'concello');
  const councilNews = published.filter((a) => a.source === 'concello');
  /** "Could not read the page" is not the same claim as "nothing is wrong". */
  const unreachable = alertData?.status === 'unreachable';
  /** A snapshot past its refresh window cannot speak for the present. */
  const stale = isSnapshotStale(snapshotAt);
  const currentHour = new Date().getHours();
  const isNightWindow = currentHour >= 22 || currentHour < 6;

  // Real, permanent structural notices of Lugo (Intermodal works, pedestrianization, fare subsidies)
  /**
   * Permanent notices about the city rather than today's incidents: the intermodal
   * works, the pedestrianised old town, the fare discounts. The prose lives in the
   * dictionary; the ids, severities and affected lines are facts and stay here.
   */
  const NOTICE_META = [
    { id: 'struct-1', severity: 'warning' as const, linesAffected: ['1.3', '3.1', '3.2'] },
    { id: 'struct-2', severity: 'info' as const, linesAffected: ['7', '8', '9', '12'] },
    { id: 'struct-3', severity: 'info' as const, linesAffected: ['Todas'] },
  ];
  /**
   * When a person last checked these against the city, in ISO so it sorts and parses.
   *
   * They used to carry the words "obras actuais", "vixente" and "activo", which is a
   * claim about today made by a file that was written months ago and cannot know. The
   * works will finish; the app would go on saying they had not. A date cannot go out of
   * date -- it just gets further away, and below the notices say so themselves.
   *
   * Move this forward only after actually re-reading the sources.
   */
  const NOTICES_REVIEWED_ON = '2026-08-27';
  const monthsSinceReview = Math.floor(
    (Date.now() - new Date(NOTICES_REVIEWED_ON).getTime()) / (1000 * 60 * 60 * 24 * 30.4),
  );
  const structuralNotices: ServiceAlert[] = NOTICE_META.map((meta, i) => ({
    ...meta,
    ...t.faresContent.notices[i],
    date: NOTICES_REVIEWED_ON,
    active: true,
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      {/* Night service information banner */}
      {isNightWindow && (
        <div className="p-4 rounded-xl bg-surface border border-edge shadow-sm flex items-start gap-3">
          <Clock className="w-5 h-5 text-ink-2 shrink-0 mt-0.5" />
          <div className="text-label">
            <div className="text-body font-semibold">
              {t.fares.nightWindowTitle}
            </div>
            <p className="mt-1 text-ink-2 leading-relaxed">
              {t.fares.nightWindowBody}
            </p>
          </div>
        </div>
      )}

      {/* Service Alerts (Live Automated Sync) */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-emph font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-estimated" />
              {t.fares.alertsTitle}
            </h2>
            <p className="text-label text-ink-3 mt-0.5">{t.fares.alertsSubtitle}</p>
          </div>

          <button
            id="sync-alerts-btn"
            onClick={() => refresh(true)}
            disabled={isSyncing || cooldown > 0}
            className={`flex h-11 shrink-0 items-center gap-1.5 self-start rounded-[9px] px-4 text-body font-semibold sm:self-auto ${
              cooldown > 0
                ? 'cursor-not-allowed border border-edge bg-surface text-ink-3'
                : 'bg-accent hover:bg-accent text-on-accent disabled:opacity-50'
            }`}
          >
            {isSyncing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>{t.fares.refreshing}</span>
              </>
            ) : cooldown > 0 ? (
              <>
                <Clock className="w-3.5 h-3.5 text-ink-2" />
                <span>{t.fares.cooldownText(cooldown)}</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t.fares.refreshBtn}</span>
              </>
            )}
          </button>
        </div>

        {/* Dynamic Live Incidents or Normal Operation Badge */}
        {liveAlerts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {liveAlerts.map((alert) => {
              const isWarning = alert.severity === 'warning';
              return (
                <div
                  key={alert.id}
                  className={`p-5 rounded-xl border transition-all ${
                    isWarning ? 'bg-warn/60 border-warn' : 'bg-surface/60 border-edge'
                  }`}
                >
                  {/* Two very different claims share this list. The operator is talking
                      about its own buses; the council is a press release that happens to
                      be about the streets. Saying which is which costs one line and is the
                      difference between a notice and a rumour. */}
                  <span className="text-label font-bold uppercase tracking-wider text-ink-3">
                    {alert.source === 'concello' ? t.fares.sourceConcello : t.fares.sourceOperator}
                  </span>
                  <div className="mb-2 mt-1 flex items-center justify-between gap-2">
                    <span
                      className={`text-label font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                        isWarning ? 'bg-warn text-warn-ink' : 'bg-surface text-accent'
                      }`}
                    >
                      {formatInstant(alert.date, LOCALE[lang])}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 justify-end max-w-[65%]">
                      {(() => {
                        const lines = alert.linesAffected || [];
                        if (lines.length >= 10 || lines.includes('Todas')) {
                          return (
                            <span className="text-label font-bold bg-bg px-2 py-0.5 rounded shadow-xs text-ink border border-edge whitespace-nowrap">
                              {t.fares.allLines}
                            </span>
                          );
                        }
                        const maxVisible = 3;
                        const visible = lines.slice(0, maxVisible);
                        const remainder = lines.length - maxVisible;
                        return (
                          <>
                            {visible.map((l) => (
                              <span
                                key={l}
                                className="text-label font-black bg-bg px-1.5 py-0.5 rounded shadow-xs text-ink border border-edge"
                              >
                                {l}
                              </span>
                            ))}
                            {remainder > 0 && (
                              <span
                                title={lines.slice(maxVisible).join(', ')}
                                className="text-label font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shadow-xs border border-edge cursor-help"
                              >
                                +{remainder}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <h3 className="font-bold text-ink text-body">{alert.title}</h3>
                  {/* The operator posts a notice as one line of text, so the title and the
                      description are the same words. Printing them twice reads as a bug. */}
                  {alert.description !== alert.title && (
                    <p className="text-label text-ink-2 mt-1.5 leading-relaxed">{alert.description}</p>
                  )}
                  {alert.link && (
                    <a
                      href={alert.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex min-h-11 items-center text-label font-bold text-accent underline underline-offset-2"
                    >
                      {t.fares.readInFull}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-5 rounded-xl bg-surface border border-edge flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              {/* A green tick is a claim. It only goes on the state we actually verified. */}
              <div
                className={`shrink-0 rounded-lg p-2 mt-0.5 ${
                  unreachable ? 'bg-surface text-ink-2 border border-edge' : 'bg-official text-on-official'
                }`}
              >
                {unreachable ? <HelpCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
              </div>
              <div>
                <h3 className={`text-body font-bold ${unreachable || stale ? 'text-ink' : 'text-official'}`}>
                  {unreachable
                    ? t.fares.unknownStatusTitle
                    : stale
                      ? t.fares.staleStatusTitle
                      : t.fares.normalStatusTitle}
                </h3>
                <p className="text-label text-ink-2 mt-0.5 leading-relaxed">
                  {unreachable
                    ? t.fares.unknownStatusDesc
                    : stale
                      ? t.fares.staleStatusDesc
                      : t.fares.normalStatusDesc}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-label text-official font-medium">
                  <span>
                    {t.fares.lastCheck}{' '}
                    <b>
                      {formatInstant(snapshotAt ?? alertData?.lastSyncTime, LOCALE[lang])}
                    </b>
                    {snapshotAt && (
                      <span className="ml-1 text-official">
                        ({t.fares.savedCopy})
                      </span>
                    )}
                  </span>
                  <span>&bull;</span>
                  <span>{t.fares.source} <a href="https://buslugo.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">buslugo.com</a></span>
                </div>
              </div>
            </div>

            <a
              href="https://buslugo.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 shrink-0 items-center justify-center rounded-[9px] border border-edge px-4 text-body font-semibold text-accent"
            >
              {t.fares.checkOnBuslugo} &rarr;
            </a>
          </div>
        )}

        {/* Real Structural Municipal Notices */}
        <div className="pt-2">
          <h3 className="text-label font-bold text-ink-2 uppercase tracking-wider">
            {t.fares.structuralTitle}
          </h3>
          <p className="mt-1 text-label leading-relaxed text-ink-3">{t.fares.structuralSource}</p>

      {/* Six months is roughly how long a set of roadworks can outlive its own
              description. Past that the app stops implying anybody has looked. */}
          {monthsSinceReview >= 6 && (
            <p className="mt-1 text-label font-semibold leading-relaxed text-estimated">
              {t.fares.structuralStale(monthsSinceReview)}
            </p>
          )}
          <div className="mb-3" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {structuralNotices.map((alert) => {
              const isWarning = alert.severity === 'warning';
              return (
                <div
                  key={alert.id}
                  className={`p-5 rounded-xl border transition-all ${
                    isWarning ? 'bg-warn/60 border-warn' : 'bg-surface border-edge'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {/* When somebody last checked, not a word claiming it is still true.
                        These three cards used to say "obras actuais", "vixente" and
                        "activo" -- a statement about today, made by a file written months
                        ago, which cannot know. */}
                    <span
                      className={`text-label font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                        isWarning ? 'bg-warn text-warn-ink' : 'bg-surface text-accent'
                      }`}
                    >
                      {t.fares.reviewedOn(new Date(alert.date).toLocaleDateString(LOCALE[lang]))}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 justify-end max-w-[65%]">
                      {(() => {
                        const lines = alert.linesAffected || [];
                        if (lines.length >= 10 || lines.includes('Todas')) {
                          return (
                            <span className="text-label font-bold bg-bg px-2 py-0.5 rounded shadow-xs text-ink border border-edge whitespace-nowrap">
                              {t.fares.allLines}
                            </span>
                          );
                        }
                        const maxVisible = 3;
                        const visible = lines.slice(0, maxVisible);
                        const remainder = lines.length - maxVisible;
                        return (
                          <>
                            {visible.map((l) => (
                              <span
                                key={l}
                                className="text-label font-black bg-bg px-1.5 py-0.5 rounded shadow-xs text-ink border border-edge"
                              >
                                {l}
                              </span>
                            ))}
                            {remainder > 0 && (
                              <span
                                title={lines.slice(maxVisible).join(', ')}
                                className="text-label font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shadow-xs border border-edge cursor-help"
                              >
                                +{remainder}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <h3 className="font-bold text-ink text-body">{alert.title}</h3>
                  <p className="text-label text-ink-2 mt-1.5 leading-relaxed">{alert.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* News from the council.
      Kept because roadworks and street closures do reach the buses eventually, and
      nobody else puts them in one place. Kept *here*, below the incidents and without
      a badge, because it is a newspaper column and not a service notice: reading it
      is optional in a way that "your line is diverted" is not. */}
      {councilNews.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-emph font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-ink-2" />
              {t.fares.newsTitle}
            </h2>
            <p className="text-label text-ink-3 mt-0.5">{t.fares.newsSubtitle}</p>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-edge bg-surface/60">
            {councilNews.map((item) => (
              <li key={item.id} className="p-4 sm:p-5">
                <span className="text-label font-bold uppercase tracking-wider text-ink-3">
                  {formatInstant(item.date, LOCALE[lang])}
                </span>
                <h3 className="mt-1 font-bold text-ink text-body">{item.title}</h3>
                {item.description !== item.title && (
                  <p className="text-label text-ink-2 mt-1.5 leading-relaxed">{item.description}</p>
                )}
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex min-h-11 items-center text-label font-bold text-accent underline underline-offset-2"
                  >
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
};
