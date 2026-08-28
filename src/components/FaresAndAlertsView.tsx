import React, { useState, useEffect } from 'react';
import { Lang, LOCALE, translations } from '../i18n';
import { CreditCard, AlertTriangle, Info, Phone, Globe, HelpCircle, RefreshCw, CheckCircle2, Clock } from 'lucide-react';
import { FARES_LIST } from '../data/transitData';
import { ServiceAlert } from '../types';
import type { AlertSyncResult } from '../services/alertSyncService';
import alertSnapshot from '../data/alerts.json';
import { isSnapshotStale } from '../utils/snapshotAge';

interface FaresAndAlertsViewProps {
  lang: Lang;
}

const COOLDOWN_SECONDS = 30;


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


/**
 * The committed snapshot, narrowed rather than asserted.
 *
 * A JSON import widens `status` to `string`, which is why this used to be cast through
 * `unknown` — and a cast would have swallowed a genuinely malformed file just as
 * happily. One check at the one boundary costs less than that risk.
 */
function readSnapshot(raw: typeof alertSnapshot): AlertSyncResult {
  return {
    ...raw,
    status:
      raw.status === 'active_incidents'
        ? 'active_incidents'
        : raw.status === 'unreachable'
          ? 'unreachable'
          : 'operational_normal',
    alerts: (raw.alerts ?? []) as AlertSyncResult['alerts'],
  };
}

export const FaresAndAlertsView: React.FC<FaresAndAlertsViewProps> = ({ lang }) => {
  const [alertData, setAlertData] = useState<AlertSyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [cooldown, setCooldown] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  /** Set when the notices came from the committed snapshot rather than live. */
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);

  // Only the server can reach buslugo.com; the browser is blocked by CORS, so the old
  // client-side fallback silently reported "todo normal" whenever the API was down.
  const fetchAlerts = async (force = false) => {
    if (force && (cooldown > 0 || isSyncing)) return;

    setIsSyncing(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/alerts${force ? '?refresh=true' : ''}`);
      if (!res.ok) throw new Error(String(res.status));
      setAlertData(await res.json());
      setSnapshotAt(null);
      setError(null);
    } catch {
      // No server (static hosting) or it is down: use the snapshot a scheduled job
      // committed, and say when it was taken instead of passing it off as live.
      setAlertData(readSnapshot(alertSnapshot));
      setSnapshotAt(alertSnapshot.fetchedAt ?? null);
      setError(null);
    } finally {
      if (force) setCooldown(COOLDOWN_SECONDS);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchAlerts(false);
  }, []);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const t = translations(lang);

  const faqs = t.faresContent.faqs;

  const currentFares = FARES_LIST[lang];
  const liveAlerts = alertData?.alerts || [];
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
  /**
   * Where somebody can go to check any of this for themselves. buslugo.com is the
   * operator's own; the other two are independent readers of the same timetables, like
   * this one.
   */
  const PORTALS = [
    { href: 'https://buslugo.com', label: 'buslugo.com' },
    // urbanoslugo.com is gone: it answers, then redirects off HTTPS to plain http://,
    // which browsers now refuse to follow from a secure page. A dead link on a page
    // whose whole point is 'go and check for yourself' is worse than one fewer link.
    { href: 'https://tpgalicia.github.io/urban/lugo', label: 'TP Galicia (GitHub)' },
  ];

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
            onClick={() => fetchAlerts(true)}
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
                  <div className="flex items-center justify-between gap-2 mb-2">
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
                  <p className="text-label text-ink-2 mt-1.5 leading-relaxed">{alert.description}</p>
                </div>
              );
            })}
          </div>
        ) : error ? (
          <div className="p-5 rounded-xl bg-warn border border-warn flex items-start gap-3.5">
            <div className="p-2 rounded-lg bg-warn-ink text-bg shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-body font-bold text-warn-ink">
                {t.fares.alertsUnavailable}
              </h3>
              <p className="text-label text-estimated mt-0.5 leading-relaxed">{error}</p>
              <a
                href="https://buslugo.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-label font-bold text-warn-ink underline mt-1.5 inline-flex min-h-11 items-center"
              >
                {t.fares.checkOnBuslugo}
              </a>
            </div>
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

      {/* Fares & Cards (Geometric Balance Style) */}
      <div className="space-y-4">
        <div>
          <h2 className="text-emph font-bold text-ink uppercase tracking-wider flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-accent" />
            {t.fares.faresTitle}
          </h2>
          <p className="text-label text-ink-3 mt-0.5">{t.fares.faresSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {currentFares.map((fare, idx) => (
            <div
              key={idx}
              className="p-5 rounded-xl bg-bg border border-edge shadow-sm flex flex-col justify-between"
            >
              <div>
                <span className="text-label font-bold text-accent bg-surface border border-edge px-2 py-0.5 rounded uppercase tracking-wider">
                  {fare.badge}
                </span>
                <h3 className="font-bold text-body text-ink mt-2.5">{fare.title}</h3>
                {/* No invented number when the operator publishes none. */}
                <div className="text-title font-black text-ink mt-1 font-mono">
                  {fare.price || <span className="text-body text-ink-3">{t.fares.priceNotPublished}</span>}
                </div>
                <p className="text-label font-bold text-ink-2 mt-1">{fare.subtitle}</p>
                <p className="text-label text-ink-3 mt-2 leading-relaxed">{fare.details}</p>
              </div>
              <a
                href={fare.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-label font-bold text-accent hover:text-accent underline mt-3 self-start inline-flex min-h-11 items-center"
              >
                {fare.source}
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* FAQs & Contact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* FAQs */}
        <div className="bg-bg rounded-xl p-5 border border-edge shadow-sm space-y-3">
          <h3 className="font-bold text-ink text-body uppercase tracking-wider flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-accent" />
            {t.fares.faqTitle}
          </h3>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="p-3 bg-surface rounded-lg border border-line">
                <div className="text-label font-bold text-ink">{faq.q}</div>
                <div className="text-label text-ink-2 mt-1">{faq.a}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Customer Care & Official Links */}
        <div className="bg-bg rounded-xl p-5 border border-edge shadow-sm space-y-4">
          <h3 className="font-bold text-ink text-body uppercase tracking-wider flex items-center gap-2">
            <Info className="w-4 h-4 text-accent" />
            {t.fares.contactTitle}
          </h3>

          <div className="space-y-3 text-label text-ink-2">
            <div className="flex items-start gap-3 p-3 bg-surface rounded-lg border border-line">
              <Phone className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-ink">{t.fares.phones}</div>
                <div className="mt-0.5">Concello de Lugo - Mobilidade: 982 29 74 00</div>
                <div>Monbus Lugo: 982 24 16 00</div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-surface rounded-lg border border-line">
              <Globe className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-bold text-ink">{t.fares.portals}</div>
                {/* Named links rather than three URLs printed out. A bare address is only
                    worth the width when it cannot be clicked, and these can; spelling the
                    whole thing out was also what pushed the longest one out of the card. */}
                <ul className="mt-1 space-y-0.5">
                  {PORTALS.map((portal) => (
                    <li key={portal.href}>
                      <a
                        href={portal.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center font-bold text-accent underline underline-offset-2"
                      >
                        {portal.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
