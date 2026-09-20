import { CreditCard, Info, Phone, Globe, HelpCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { FARE_CARDS } from '../data/transitData';

/** Where somebody can check any of this: the operator's own site, and an independent reader of the same timetables. */
const PORTALS = [
  { href: 'https://buslugo.com', label: 'buslugo.com' },
  // urbanoslugo.com is gone: it redirects off HTTPS, which browsers refuse to follow.
  { href: 'https://tpgalicia.github.io/urban/lugo', label: 'TP Galicia (GitHub)' },
];

const card = 'rounded-card border border-edge bg-bg p-5 shadow-sm';
const link = 'inline-flex min-h-11 items-center font-bold text-label text-accent underline underline-offset-2';

const Title = ({ icon: Icon, children, small = false }: { icon: LucideIcon; children: ReactNode; small?: boolean }) => (
  <h2 className={`font-bold text-ink uppercase tracking-wider flex items-center gap-2 ${small ? 'text-body' : 'text-emph'}`}>
    <Icon className={`${small ? 'w-4 h-4' : 'w-5 h-5'} text-accent`} aria-hidden="true" />
    {children}
  </h2>
);

const Bullets = ({ title, lines, hollow = false }: { title: string; lines: string[]; hollow?: boolean }) => (
  <div>
    <h3 className="text-label font-bold uppercase tracking-wider text-ink-2">{title}</h3>
    <ul className="mt-2 space-y-1.5 text-label leading-relaxed text-ink">
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${hollow ? 'border border-ink-3' : 'bg-ink-3'}`} aria-hidden="true" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  </div>
);

/** How the service works: what it costs, what is asked of the people on board, and who to ask when something is wrong. */
export function FaresView() {
  const t = useT();
  // Only two of the eight card strings interpolate a number, so only those are functions.
  const copy = (value: string | ((minutes: number) => string), minutes = 0) => (typeof value === 'function' ? value(minutes) : value);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      <div className="space-y-4">
        <div>
          <Title icon={CreditCard}>{t.fares.faresTitle}</Title>
          <p className="text-label text-ink-3 mt-0.5">{t.fares.faresSubtitle}</p>
          {/* Right under the line that names the operator and calls the prices official. */}
          <p className="text-label text-ink-3 mt-1 border-l-2 border-edge pl-2">{t.fares.notAffiliated}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FARE_CARDS.map((fare) => {
            const words = t.fares.cards[fare.id];
            const minutes = 'minutes' in fare ? fare.minutes : 0;
            return (
              <div key={fare.id} className={`${card} flex flex-col justify-between`}>
                <div>
                  <span className="text-label font-bold text-accent bg-surface border border-edge px-2 py-0.5 rounded uppercase tracking-wider">{words.badge}</span>
                  <h3 className="font-bold text-body text-ink mt-2.5">{words.title}</h3>
                  {/* No invented number when the operator publishes none. */}
                  <div className="text-title font-black text-ink mt-1 font-mono">{fare.price || <span className="text-body text-ink-3">{t.fares.priceNotPublished}</span>}</div>
                  <p className="text-label font-bold text-ink-2 mt-1">{copy(words.subtitle, minutes)}</p>
                  <p className="text-label text-ink-3 mt-2 leading-relaxed">{copy(words.details, minutes)}</p>
                </div>
                <a href={fare.sourceUrl} target="_blank" rel="noopener noreferrer" className={`${link} mt-3 self-start`}>
                  {fare.source}
                </a>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summarised rather than copied: their page is the one that counts and is linked. */}
      <div className={card}>
        <Title icon={Info}>{t.rules.title}</Title>
        <p className="mt-0.5 text-label text-ink-3">{t.rules.subtitle}</p>
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
          <Bullets title={t.rules.mustTitle} lines={t.rules.must} />
          <Bullets title={t.rules.mustNotTitle} lines={t.rules.mustNot} hollow />
        </div>
        <a href="https://buslugo.com/normativa/" target="_blank" rel="noopener noreferrer" className={`${link} mt-4`}>
          {t.rules.sourceLink}
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`${card} space-y-3`}>
          <Title icon={HelpCircle} small>
            {t.fares.faqTitle}
          </Title>
          <div className="space-y-3">
            {t.faresContent.faqs.map((faq, i) => (
              <div key={i} className="p-3 bg-surface rounded-control border border-line">
                <div className="text-label font-bold text-ink">{faq.q}</div>
                <div className="text-label text-ink-2 mt-1">{faq.a}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`${card} space-y-4`}>
          <Title icon={Info} small>
            {t.fares.contactTitle}
          </Title>
          <div className="space-y-3 text-label text-ink-2">
            <div className="flex items-start gap-3 p-3 bg-surface rounded-control border border-line">
              <Phone className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-ink">{t.fares.phones}</div>
                <div className="mt-0.5">Concello de Lugo - Mobilidade: 982 29 74 00</div>
                <div>Monbus Lugo: 982 24 16 00</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-surface rounded-control border border-line">
              <Globe className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-bold text-ink">{t.fares.portals}</div>
                <ul className="mt-1 space-y-0.5">
                  {PORTALS.map((portal) => (
                    <li key={portal.href}>
                      <a href={portal.href} target="_blank" rel="noopener noreferrer" className={link}>
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
}
