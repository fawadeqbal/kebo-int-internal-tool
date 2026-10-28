import type { ReactNode } from "react";
import { Check, ClipboardList, Mail, MessageCircle, Minus, Phone, Plus } from "lucide-react";
import { PLAN_FEATURE_KEYS, PLAN_FEATURES, planFeatureName, type LeadOrigin, type SiteContent } from "@kebo/shared";
import type { ActionState } from "@/lib/actions";
import { ContactForm } from "./contact-form";
import { SITE_ICON } from "./icons";
import "./site.css";

export interface SitePlan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  period: string;
  maxUsers: number | null;
  maxStorageMb: number | null;
  features: string[];
}

export interface SiteLinks {
  /** "Request a demo", carrying where the visitor came from and which button. */
  demo: (cta: string) => string;
  /** "Sign in": finds the company's own address by email. */
  signIn: string;
  /** Start a trial, when self sign-up is open. */
  signUp?: (cta: string) => string;
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const storage = (mb: number | null) => (mb === null ? "No limit" : mb >= 1024 ? `${Math.round(mb / 102.4) / 10} GB` : `${mb} MB`);

const wrap = "mx-auto w-full max-w-[76rem] px-4 sm:px-8";

/**
 * The marketing page, drawn from the words the platform admin edits (Website)
 * and the plans. The live page and the editor's preview both use it.
 */
export function MarketingPage({
  content: c,
  plans,
  links,
  origin,
  contactAction,
  preview = false,
}: {
  content: SiteContent;
  plans: SitePlan[];
  links: SiteLinks;
  origin: LeadOrigin | null;
  contactAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  preview?: boolean;
}) {
  const showPlans = c.plans.show && plans.length > 0;
  return (
    <div className="site min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to the page
      </a>
      <header className="border-b border-(--s-line)">
        <div className={`${wrap} flex h-16 items-center justify-between gap-4`}>
          <a href="#main" className="flex items-center gap-2.5 font-bold">
            <span className="grid size-9 place-items-center rounded-lg bg-(--s-violet) text-white">
              <ClipboardList className="size-5" aria-hidden />
            </span>
            <span className="s-heading text-lg whitespace-nowrap">RFQ Desk</span>
          </a>
          <nav aria-label="Page" className="flex items-center gap-1 text-[0.95rem] sm:gap-2">
            <a href="#features" className="hidden rounded px-3 py-2 text-(--s-steel) hover:text-(--s-ink) md:block">
              Features
            </a>
            {showPlans && (
              <a href="#plans" className="hidden rounded px-3 py-2 text-(--s-steel) hover:text-(--s-ink) md:block">
                Plans
              </a>
            )}
            {c.faq.items.length > 0 && (
              <a href="#questions" className="hidden rounded px-3 py-2 text-(--s-steel) hover:text-(--s-ink) md:block">
                Questions
              </a>
            )}
            <a href={links.signIn} className="rounded px-3 py-2 font-medium whitespace-nowrap hover:text-(--s-violet)">
              Sign in
            </a>
            <a
              href={links.demo("header")}
              className="hidden rounded-md bg-(--s-violet) px-4 py-2 font-semibold whitespace-nowrap text-white hover:bg-(--s-violet-deep) sm:inline-block"
            >
              {c.hero.primary}
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* The hero: a customer's request becomes a stamped quotation. */}
        <section className={`${wrap} grid items-center gap-12 pt-14 pb-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:pt-20 lg:pb-28`}>
          <div>
            {c.hero.eyebrow && <p className="mb-5 text-[0.95rem] font-medium text-(--s-violet)">{c.hero.eyebrow}</p>}
            <h1 className="s-display text-[clamp(2.4rem,5.6vw,4.6rem)]">{c.hero.title}</h1>
            <p className="s-lead mt-6 max-w-[38rem] text-lg text-(--s-steel)">{c.hero.subtitle}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href={links.demo("hero")}
                className="rounded-md bg-(--s-violet) px-6 py-3.5 text-lg font-semibold text-white hover:bg-(--s-violet-deep)"
              >
                {c.hero.primary}
              </a>
              {c.hero.secondary && (
                <a
                  href={showPlans ? "#plans" : links.signUp ? links.signUp("hero") : "#features"}
                  className="rounded-md border-2 border-(--s-ink) px-6 py-3 text-lg font-semibold hover:bg-(--s-ink) hover:text-white"
                >
                  {c.hero.secondary}
                </a>
              )}
            </div>
          </div>
          <HeroDocument />
        </section>

        {c.features.items.length > 0 && (
          <section id="features" className="scroll-mt-8 border-t border-(--s-line) bg-(--s-mist)">
            <div className={`${wrap} grid gap-10 py-20 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-28`}>
              <div className="lg:sticky lg:top-10 lg:self-start">
                <h2 className="s-heading text-[clamp(1.9rem,3.4vw,2.75rem)]">{c.features.title}</h2>
                {c.features.subtitle && <p className="s-lead mt-4 max-w-[30rem] text-(--s-steel)">{c.features.subtitle}</p>}
              </div>
              <ul className="grid gap-x-10 sm:grid-cols-2">
                {c.features.items.map((f, i) => {
                  const Icon = SITE_ICON[f.icon]?.icon ?? ClipboardList;
                  return (
                    <li key={i} className="border-t border-(--s-line) py-7">
                      <Icon className="size-7 text-(--s-violet)" strokeWidth={1.75} aria-hidden />
                      <h3 className="s-heading mt-4 text-xl">{f.title}</h3>
                      <p className="mt-2 text-(--s-steel)">{f.text}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {c.steps.items.length > 0 && (
          <section className={`${wrap} py-20 lg:py-28`}>
            <h2 className="s-heading max-w-[40rem] text-[clamp(1.9rem,3.4vw,2.75rem)]">{c.steps.title}</h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {c.steps.items.map((s, i) => (
                <li key={i} className="flex gap-5">
                  <span aria-hidden className="s-display text-[3.5rem] leading-none text-(--s-violet)">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="s-heading text-xl">{s.title}</h3>
                    <p className="mt-2 text-(--s-steel)">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {showPlans && (
          <section id="plans" className="scroll-mt-8 border-t border-(--s-line) bg-(--s-mist)">
            <div className={`${wrap} py-20 lg:py-28`}>
              <h2 className="s-heading text-[clamp(1.9rem,3.4vw,2.75rem)]">{c.plans.title}</h2>
              {c.plans.subtitle && <p className="s-lead mt-4 max-w-[40rem] text-(--s-steel)">{c.plans.subtitle}</p>}
              <PlansTable plans={plans} demo={links.demo} />
              {c.plans.note && <p className="mt-5 text-sm text-(--s-steel)">{c.plans.note}</p>}
            </div>
          </section>
        )}

        {c.quotes.length > 0 && (
          <section className={`${wrap} py-20 lg:py-28`}>
            <div className="grid gap-12 md:grid-cols-2">
              {c.quotes.map((q, i) => (
                <figure key={i} className="border-l-4 border-(--s-violet) pl-6">
                  <blockquote className="s-heading text-[1.35rem] font-semibold">&ldquo;{q.text}&rdquo;</blockquote>
                  <figcaption className="mt-4 text-(--s-steel)">
                    <span className="font-semibold text-(--s-ink)">{q.name}</span>
                    {q.role ? `, ${q.role}` : ""}, {q.company}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {c.faq.items.length > 0 && (
          <section
            id="questions"
            className={`${wrap} scroll-mt-8 grid gap-10 border-t border-(--s-line) py-20 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-28`}
          >
            <h2 className="s-heading text-[clamp(1.9rem,3.4vw,2.75rem)]">{c.faq.title}</h2>
            <div className="border-b border-(--s-line)">
              {c.faq.items.map((f, i) => (
                <details key={i} className="border-t border-(--s-line)">
                  <summary className="flex items-start justify-between gap-6 py-5 text-lg font-semibold">
                    {f.q}
                    <Plus className="s-plus mt-1 size-5 shrink-0 text-(--s-violet)" aria-hidden />
                  </summary>
                  <p className="max-w-[44rem] pb-6 whitespace-pre-line text-(--s-steel)">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* The close: request a demo, or ask a question. */}
        <section id="contact" className="scroll-mt-8 bg-(--s-violet-deep) text-white">
          <div className={`${wrap} grid gap-12 py-20 lg:grid-cols-2 lg:gap-16 lg:py-28`}>
            <div>
              <h2 className="s-display text-[clamp(2.1rem,4.4vw,3.4rem)]">{c.cta.title}</h2>
              {c.cta.text && <p className="s-lead mt-5 max-w-[32rem] text-lg text-white/80">{c.cta.text}</p>}
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={links.demo("closing")}
                  className="rounded-md bg-white px-6 py-3.5 text-lg font-semibold text-(--s-violet-deep) hover:bg-(--s-violet-soft)"
                >
                  {c.hero.primary}
                </a>
                {links.signUp && (
                  <a
                    href={links.signUp("closing")}
                    className="rounded-md border-2 border-white px-6 py-3 text-lg font-semibold hover:bg-white/10"
                  >
                    Start a free trial
                  </a>
                )}
              </div>
              <ContactLines contact={c.contact} />
            </div>
            <div className="rounded-xl bg-white p-6 text-(--s-ink) sm:p-8">
              <h3 className="s-heading text-2xl">Ask a question</h3>
              <p className="mt-1 mb-5 text-(--s-steel)">We answer within one working day.</p>
              <ContactForm action={contactAction} origin={origin} disabled={preview} />
            </div>
          </div>
        </section>
      </main>

      <footer className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-8 text-sm text-(--s-steel)`}>
        <p>© {new Date().getFullYear()} RFQ Desk</p>
        <div className="flex gap-5">
          <a href={links.signIn} className="hover:text-(--s-ink)">
            Sign in
          </a>
          <a href={links.demo("footer")} className="hover:text-(--s-ink)">
            {c.hero.primary}
          </a>
        </div>
      </footer>
    </div>
  );
}

function ContactLines({ contact }: { contact: SiteContent["contact"] }) {
  const lines: { icon: ReactNode; label: string; href: string }[] = [];
  if (contact.email) lines.push({ icon: <Mail className="size-5" aria-hidden />, label: contact.email, href: `mailto:${contact.email}` });
  if (contact.whatsapp)
    lines.push({
      icon: <MessageCircle className="size-5" aria-hidden />,
      label: `WhatsApp ${contact.whatsapp}`,
      href: `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`,
    });
  if (contact.phone)
    lines.push({
      icon: <Phone className="size-5" aria-hidden />,
      label: contact.phone,
      href: `tel:${contact.phone.replace(/[^\d+]/g, "")}`,
    });
  if (!lines.length) return null;
  return (
    <ul className="mt-10 flex flex-col gap-3 text-lg">
      {lines.map((l) => (
        <li key={l.href}>
          <a href={l.href} className="inline-flex items-center gap-3 text-white/90 underline-offset-4 hover:text-white hover:underline">
            {l.icon}
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The plans side by side: what each costs, how many people and files, and which features. */
function PlansTable({ plans, demo }: { plans: SitePlan[]; demo: (cta: string) => string }) {
  const per = (p: string) => (p === "year" ? "a year" : "a month");
  return (
    <div className="mt-12 overflow-x-auto rounded-xl border border-(--s-line) bg-white">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <caption className="sr-only">The plans compared</caption>
        <thead>
          <tr className="align-top">
            <th scope="col" className="w-[26%] min-w-56 p-5" />
            {plans.map((p) => (
              <th key={p.id} scope="col" className="border-l border-(--s-line) p-5 font-normal">
                <span className="s-heading block text-xl">{p.name}</span>
                <span className="mt-2 block whitespace-nowrap">
                  <span className="s-display text-[2.1rem]">{money(p.price, p.currency)}</span>{" "}
                  <span className="text-sm text-(--s-steel)">{per(p.period)}</span>
                </span>
                {p.description && <span className="mt-1 block text-sm text-(--s-steel)">{p.description}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="People">
            {plans.map((p) => (
              <Cell key={p.id}>{p.maxUsers === null ? "No limit" : `Up to ${p.maxUsers}`}</Cell>
            ))}
          </Row>
          <Row label="Files">
            {plans.map((p) => (
              <Cell key={p.id}>{storage(p.maxStorageMb)}</Cell>
            ))}
          </Row>
          {PLAN_FEATURE_KEYS.map((f) => (
            <Row key={f} label={planFeatureName(f)} hint={PLAN_FEATURES[f].split(" (")[1]?.replace(/\)$/, "")}>
              {plans.map((p) => (
                <Cell key={p.id}>
                  {p.features.includes(f) ? (
                    <Check className="size-5 text-(--s-violet)" aria-label="Included" />
                  ) : (
                    <Minus className="size-5 text-(--s-line)" aria-label="Not included" />
                  )}
                </Cell>
              ))}
            </Row>
          ))}
          <tr className="border-t border-(--s-line)">
            <td className="p-5" />
            {plans.map((p) => (
              <td key={p.id} className="border-l border-(--s-line) p-5">
                <a
                  href={demo(`plan-${p.name.toLowerCase()}`)}
                  className="inline-block rounded-md border-2 border-(--s-violet) px-4 py-2 font-semibold whitespace-nowrap text-(--s-violet) hover:bg-(--s-violet) hover:text-white"
                >
                  Ask about {p.name}
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <tr className="border-t border-(--s-line)">
      <th scope="row" className="px-5 py-4 font-semibold">
        {label}
        {hint && <span className="block text-sm font-normal text-(--s-steel)">{hint}</span>}
      </th>
      {children}
    </tr>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="border-l border-(--s-line) px-5 py-4">{children}</td>;
}

/** A buyer's message, the quotation it became, and the company seal on it (drawn, not a picture). */
function HeroDocument() {
  const lines = [
    { item: "Ball valve DN50, brass", qty: "2,000 pcs", price: "6.40" },
    { item: "Gate valve DN80, cast iron", qty: "500 pcs", price: "11.20" },
  ];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[29rem] select-none lg:mx-0 lg:justify-self-end">
      <div className="relative z-10 ml-auto w-[82%] rounded-2xl sm:translate-x-2 rounded-br-sm bg-(--s-violet-soft) px-5 py-4 text-[0.95rem] shadow-[0_1px_0_var(--s-line)]">
        <p className="text-xs font-semibold text-(--s-violet)">New inquiry from WhatsApp</p>
        <p className="mt-1">Need 2,000 ball valves DN50 and 500 gate valves DN80, FOB Qingdao. Best price this week?</p>
      </div>
      <div className="relative -mt-3 rounded-lg border border-(--s-line) bg-white px-6 pt-7 pb-8 shadow-[0_24px_48px_-24px_rgba(39,20,92,0.35)]">
        <div className="flex items-baseline justify-between gap-4 border-b-2 border-(--s-ink) pb-3">
          <p className="s-heading text-xl tracking-wide">Quotation</p>
          <p className="font-mono text-sm text-(--s-steel)">Q-2611-014</p>
        </div>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-(--s-steel)">
              <th className="pb-2 font-medium">Item</th>
              <th className="pb-2 text-right font-medium">Qty</th>
              <th className="pb-2 text-right font-medium">USD</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.item} className="border-t border-(--s-line)">
                <td className="py-2 pr-2">{l.item}</td>
                <td className="s-narrow py-2 text-right whitespace-nowrap">{l.qty}</td>
                <td className="py-2 text-right font-mono">{l.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between border-t border-(--s-line) pt-3 text-sm text-(--s-steel)">
          <span>Margin on factory cost</span>
          <span className="font-mono">18%</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-semibold">Total FOB Qingdao</span>
          <span className="s-heading text-2xl">USD 18,400.00</span>
        </div>
        <p className="mt-4 text-xs text-(--s-steel)">Deposit 30% to start production. Valid 15 days.</p>
        <Seal />
      </div>
    </div>
  );
}

function Seal() {
  return (
    <svg viewBox="0 0 120 120" className="s-seal absolute -right-3 -bottom-16 size-32 sm:-right-10" style={{ transformOrigin: "50% 50%" }}>
      <defs>
        {/* From low on the left, over the top, to low on the right: the company's name runs round the seal. */}
        <path id="seal-arc" d="M 27.1 79 A 38 38 0 1 1 92.9 79" />
      </defs>
      <circle cx="60" cy="60" r="54" fill="none" stroke="var(--s-seal)" strokeWidth="4" />
      <circle cx="60" cy="60" r="47" fill="none" stroke="var(--s-seal)" strokeWidth="1.2" />
      <text fill="var(--s-seal)" fontSize="10" fontWeight="700" letterSpacing="1">
        <textPath href="#seal-arc" startOffset="50%" textAnchor="middle">
          SAMPLE TRADING CO., LTD.
        </textPath>
      </text>
      <path fill="var(--s-seal)" d="M60 42 l4.7 9.6 10.6 1.5 -7.7 7.5 1.8 10.5 -9.4 -5 -9.4 5 1.8 -10.5 -7.7 -7.5 10.6 -1.5z" />
      <text x="60" y="88" fill="var(--s-seal)" fontSize="8.5" fontWeight="700" textAnchor="middle" letterSpacing="1">
        APPROVED
      </text>
    </svg>
  );
}
