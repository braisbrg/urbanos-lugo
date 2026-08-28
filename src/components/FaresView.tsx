import React from 'react';
import { Lang, translations } from '../i18n';
import { CreditCard, Info, Phone, Globe, HelpCircle } from 'lucide-react';
import { FARES_LIST } from '../data/transitData';

interface FaresViewProps {
  lang: Lang;
}

/**
 * How the service works: what it costs, what is asked of the people on board, and who to
 * ask when something is wrong.
 *
 * Split out from the notices, which used to sit above all this on one screen. None of it
 * changes from one day to the next, which is exactly why it does not belong there —
 * somebody scrolling to find out whether their bus is delayed does not want a fare table
 * on the way, and the page had grown to seven sections.
 */
export const FaresView: React.FC<FaresViewProps> = ({ lang }) => {
  const t = translations(lang);
  const faqs = t.faresContent.faqs;
  const currentFares = FARES_LIST[lang];

  /**
   * Where somebody can go to check any of this for themselves. buslugo.com is the
   * operator's own; the other is an independent reader of the same timetables, like this.
   */
  const PORTALS = [
    { href: 'https://buslugo.com', label: 'buslugo.com' },
    // urbanoslugo.com is gone: it answers, then redirects off HTTPS to plain http://,
    // which browsers now refuse to follow from a secure page. A dead link on a card
    // whose whole point is 'go and check for yourself' is worse than one fewer link.
    { href: 'https://tpgalicia.github.io/urban/lugo', label: 'TP Galicia (GitHub)' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
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

      {/* What the operator asks of the people on board.
          Summarised rather than copied: their page is the one that counts and is linked,
          and a wholesale reproduction would go stale the day they change a line. The two
          worth knowing before you get on are the €5 note and the €60 fine, so those keep
          their numbers. */}
      <div className="rounded-xl border border-edge bg-bg p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-emph font-bold uppercase tracking-wider text-ink">
          <Info className="h-5 w-5 text-accent" aria-hidden="true" />
          {t.rules.title}
        </h2>
        <p className="mt-0.5 text-label text-ink-3">{t.rules.subtitle}</p>

        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <h3 className="text-label font-bold uppercase tracking-wider text-ink-2">{t.rules.mustTitle}</h3>
            <ul className="mt-2 space-y-1.5 text-label leading-relaxed text-ink">
              {t.rules.must.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-label font-bold uppercase tracking-wider text-ink-2">{t.rules.mustNotTitle}</h3>
            <ul className="mt-2 space-y-1.5 text-label leading-relaxed text-ink">
              {t.rules.mustNot.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full border border-ink-3" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <a
          href="https://buslugo.com/normativa/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex min-h-11 items-center font-bold text-label text-accent underline underline-offset-2"
        >
          {t.rules.sourceLink}
        </a>
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
