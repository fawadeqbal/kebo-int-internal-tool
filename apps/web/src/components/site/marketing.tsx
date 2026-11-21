import type { ReactNode } from "react";
import { Check, ClipboardList, Clock, Lock, Mail, MessageCircle, Minus, Phone as PhoneIcon, Plus, ShieldCheck, Users } from "lucide-react";
import { Scroll } from "@kebo/ui";
import { PLAN_FEATURE_KEYS, PLAN_FEATURES, planFeatureName, type LeadOrigin, type SiteContent } from "@kebo/shared";
import type { ActionState } from "@/lib/actions";
import { ContactForm } from "./contact-form";
import { SITE_ICON } from "./icons";
import { Phone, type ScreenKey } from "./phone-screens";
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

const wrap = "mx-auto w-full max-w-[76rem] px-5 sm:px-8";

/** The way through the app, step by step (each made from the one before). */
const FLOW: [string, string][] = [
  ["Inquiry", "From email, WhatsApp or your website form"],
  ["Supplier offers", "Ask several suppliers, compare side by side"],
  ["Quotation", "Your margin, in the customer's currency"],
  ["Order", "Proforma invoice and payment plan"],
  ["Purchase orders", "One for each supplier, with its own payments"],
  ["Packing list", "Packages, weights and CBM"],
  ["Shipping", "Booking, container, B/L"],
  ["Paid", "And what the order really earned"],
];

/** The app shown part by part, each with its own phone screen. */
const STORIES: { id: string; eyebrow: string; title: string; text: string; ticks: string[]; screens: ScreenKey[] }[] = [
  {
    id: "offers",
    eyebrow: "Supplier offers",
    title: "Supplier prices side by side",
    text: "Every RFQ lands in one list with who handles it and when to follow up. Ask several suppliers; their offers line up with the lowest and the fastest marked.",
    ticks: ["Prices with tax, and how it is added", "Paste items or import them from Excel", "Every offer kept for the next time"],
    screens: ["offers"],
  },
  {
    id: "quotation",
    eyebrow: "Quotations",
    title: "Your margin on every item, never on the customer's paper",
    text: "Pick the offer, set the margin and send a clean quotation in the customer's currency in minutes.",
    ticks: [
      "Options A, B and C from different suppliers",
      "The export VAT refund comes off your cost by itself",
      "A sent quotation is locked; a change is a new revision",
    ],
    screens: ["quotation"],
  },
  {
    id: "papers",
    eyebrow: "What your customer receives",
    title: "Invoices and packing lists your customers trust",
    text: "Every paper comes out of the order with your letterhead and the same numbers. Once sent, it is kept exactly as sent, so what your customer holds always matches what you hold.",
    ticks: [
      "Quotation, proforma invoice, payment request, receipt",
      "Commercial invoice, packing list, purchase order",
      "Your logo, bank accounts and stamp on every one",
    ],
    screens: ["invoice", "packing"],
  },
  {
    id: "money",
    eyebrow: "Payments and profit",
    title: "Know what is paid, what is due and what each order earned",
    text: "Deposits and balances from customers and to suppliers, bank charges and costs, each on the order it belongs to.",
    ticks: ["Every payment checked by a second person", "Payment requests and receipts made for you", "Bank transfer, bank contract or LC"],
    screens: ["money"],
  },
  {
    id: "shipping",
    eyebrow: "Production and shipping",
    title: "Every order, from deposit to the customer's door",
    text: "Ready dates from each supplier, how the goods are packed and how they travel. Your team and your customer know where the order is.",
    ticks: ["Booking, container and B/L on the order", "The papers each country asks for", "Delivery and the site acceptance test (SAT)"],
    screens: ["shipping"],
  },
];

const TRUST: { icon: typeof Lock; title: string; text: string }[] = [
  { icon: Lock, title: "Your data kept apart", text: "Every company's data is separated in the database itself, with its own address." },
  { icon: Users, title: "Payments checked twice", text: "A payment counts only after a second person checks it against the proof." },
  { icon: Clock, title: "Every change has a why", text: "Who changed what, when, from what to what, and the reason they gave." },
  {
    icon: ShieldCheck,
    title: "Each person sees their part",
    text: "Roles decide who sees costs and margins, who records payments, who changes settings.",
  },
];

function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <p
      className={
        dark
          ? "inline-flex h-7 items-center rounded-full border border-[#1f3d2a] bg-[#13281b] px-3 text-[0.8rem] font-semibold text-[#9be0b2]"
          : "inline-flex h-7 items-center rounded-full border border-(--s-green-line) bg-(--s-green-soft) px-3 text-[0.8rem] font-semibold text-(--s-green)"
      }
    >
      {children}
    </p>
  );
}

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 flex flex-col gap-2.5 text-[0.98rem] text-(--s-steel)">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-2.5">
          <span className="mt-px grid size-[22px] shrink-0 place-items-center rounded-full bg-(--s-green-soft) text-(--s-green-solid)">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          </span>
          {t}
        </li>
      ))}
    </ul>
  );
}

const strongBtn = "s-strong inline-flex h-[52px] items-center justify-center rounded-xl px-6 text-base";
const softBtn =
  "inline-flex h-[52px] items-center justify-center rounded-xl border border-line-strong bg-white px-6 text-base font-semibold text-(--s-ink) hover:bg-surface-2";

/**
 * The marketing page, phone first, drawn from the words the platform admin edits (Website) and the plans; the
 * app itself shown in its own phone screens (phone-screens.tsx). The live page and the editor's preview both use it.
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
    <div className="site min-h-dvh overflow-x-clip" data-colours="green" data-mode="light">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to the page
      </a>
      <header className="sticky top-0 z-40 border-b border-(--s-line) bg-(--s-mist)/92 backdrop-blur">
        <div className={`${wrap} flex h-16 items-center justify-between gap-3`}>
          <a href="#main" className="flex shrink-0 items-center gap-2.5 font-bold">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-(--s-green-solid) text-white">
              <ClipboardList className="size-5" aria-hidden />
            </span>
            <span className="s-heading text-lg whitespace-nowrap max-[379px]:hidden">RFQ Desk</span>
          </a>
          <nav aria-label="Page" className="flex items-center gap-1 text-[0.95rem] lg:gap-2">
            <a href="#how" className="hidden rounded px-3 py-2 text-(--s-steel) hover:text-(--s-ink) lg:block">
              How it works
            </a>
            <a href="#papers" className="hidden rounded px-3 py-2 text-(--s-steel) hover:text-(--s-ink) lg:block">
              Documents
            </a>
            <a href="#money" className="hidden rounded px-3 py-2 text-(--s-steel) hover:text-(--s-ink) lg:block">
              Payments
            </a>
            {showPlans && (
              <a href="#plans" className="hidden rounded px-3 py-2 text-(--s-steel) hover:text-(--s-ink) lg:block">
                Plans
              </a>
            )}
            <a href={links.signIn} className="rounded px-2.5 py-2 font-medium whitespace-nowrap hover:text-(--s-green) sm:px-3">
              Sign in
            </a>
            <a
              href={links.demo("header")}
              className="s-strong inline-flex h-10 items-center rounded-[10px] px-3.5 text-[0.9rem] whitespace-nowrap sm:px-4"
            >
              {c.hero.primary}
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* The top: what it is, and an order as it really looks in the app. */}
        <section className="bg-[linear-gradient(180deg,var(--s-green-soft)_0%,var(--s-mist)_62%)]">
          <div
            className={`${wrap} grid items-center gap-10 pt-10 pb-14 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-12 lg:pt-20 lg:pb-24 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}
          >
            <div>
              {c.hero.eyebrow && <Eyebrow>{c.hero.eyebrow}</Eyebrow>}
              <h1 className="s-display mt-4 text-[clamp(2.25rem,6vw,4rem)]">{c.hero.title}</h1>
              <p className="s-lead mt-4 max-w-[36rem] text-[1.05rem] text-(--s-steel) sm:text-lg">{c.hero.subtitle}</p>
              <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3">
                <a href={links.demo("hero")} className={strongBtn}>
                  {c.hero.primary}
                </a>
                {c.hero.secondary && (
                  <a href={showPlans ? "#plans" : links.signUp ? links.signUp("hero") : "#how"} className={softBtn}>
                    {c.hero.secondary}
                  </a>
                )}
              </div>
              <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm text-(--s-muted)">
                <span>On the web and the phone</span>
                <span aria-hidden>·</span>
                <span>Your letterhead</span>
                <span aria-hidden>·</span>
                <span>Any currency</span>
              </p>
            </div>
            <div className="flex items-start justify-center gap-6">
              <Phone screen="order" className="s-hero-phone" />
              <div className="hidden pt-16 xl:block">
                <Phone screen="money" className="s-small" />
              </div>
            </div>
          </div>
        </section>

        {/* The flow: each step made from the one before. */}
        <section id="how" className="scroll-mt-16 border-y border-(--s-line) bg-white">
          <div className={`${wrap} py-14 lg:py-24`}>
            <div className="max-w-[44rem]">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="s-heading mt-3 text-[clamp(1.75rem,3.6vw,2.6rem)]">
                One flow, from the first message to the money in your bank
              </h2>
              <p className="s-lead mt-3 text-(--s-steel) sm:text-lg">
                Each step is made from the one before, so nothing is typed twice and every price traces back to the supplier who gave it.
              </p>
            </div>
            <ol className="mt-9 grid gap-0 lg:grid-cols-4 lg:gap-4">
              {FLOW.map(([t, s], i) => {
                const last = i === FLOW.length - 1;
                return (
                  <li
                    key={t}
                    className="flex gap-3.5 lg:flex-col lg:gap-3 lg:rounded-2xl lg:border lg:border-(--s-line) lg:bg-(--s-mist) lg:p-4"
                  >
                    <div className="flex flex-col items-center lg:items-start">
                      <span
                        className={
                          last
                            ? "grid size-[30px] shrink-0 place-items-center rounded-full bg-(--s-green-solid) text-[0.8rem] font-bold text-white"
                            : "grid size-[30px] shrink-0 place-items-center rounded-full border-[1.5px] border-(--s-green-line) bg-white text-[0.8rem] font-bold text-(--s-green)"
                        }
                      >
                        {i + 1}
                      </span>
                      {!last && <span aria-hidden className="my-1 w-0.5 flex-1 bg-(--s-green-line) lg:hidden" />}
                    </div>
                    <div className="pt-1 pb-5 lg:p-0">
                      <p className="font-bold">{t}</p>
                      <p className="text-[0.92rem] text-(--s-muted)">{s}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* The app part by part, each with its phone screen; on a laptop the screen moves side to side. */}
        {STORIES.map((s, i) => (
          <section key={s.id} id={s.id} className={i % 2 ? "scroll-mt-16 border-y border-(--s-line) bg-white" : "scroll-mt-16"}>
            <div className={`${wrap} grid items-center gap-10 py-14 lg:grid-cols-2 lg:gap-16 lg:py-24`}>
              <div className={i % 2 ? "lg:order-2" : undefined}>
                <Eyebrow>{s.eyebrow}</Eyebrow>
                <h2 className="s-heading mt-3 text-[clamp(1.75rem,3.4vw,2.5rem)]">{s.title}</h2>
                <p className="s-lead mt-3 text-(--s-steel) sm:text-lg">{s.text}</p>
                <Ticks items={s.ticks} />
                <a
                  href={links.demo(s.id)}
                  className="mt-6 inline-flex items-center gap-1.5 font-semibold text-(--s-green) underline-offset-4 hover:underline"
                >
                  See it with your own data →
                </a>
              </div>
              {s.screens.length > 1 ? (
                // Two screens: side by side on a laptop; on a phone, one at a time with the next peeking in.
                <Scroll axis="x" size="lg" fade
                  label={`${s.eyebrow}, ${s.screens.length} screens`}
                  className="-mx-5 px-5 sm:mx-0 sm:px-0"
                >
                  <div className="flex snap-x snap-mandatory gap-5 py-6 sm:justify-center">
                    {s.screens.map((k) => (
                      <Phone key={k} screen={k} className="s-small shrink-0 snap-center" />
                    ))}
                  </div>
                </Scroll>
              ) : (
                <Phone screen={s.screens[0]!} />
              )}
            </div>
          </section>
        ))}

        {/* Trust: what a trading company worries about, handled by the system itself. */}
        <section className="bg-(--s-night) text-white">
          <div className={`${wrap} py-14 lg:py-24`}>
            <Eyebrow dark>Trust</Eyebrow>
            <h2 className="s-heading mt-3 max-w-[40rem] text-[clamp(1.75rem,3.4vw,2.5rem)]">
              Built so your money and your data stay right
            </h2>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
              {TRUST.map((t) => (
                <li key={t.title} className="flex gap-3.5 rounded-2xl border border-[#24322a] bg-[#111a15] p-5 lg:flex-col">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#13281b] text-[#6fcf8f]">
                    <t.icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-bold">{t.title}</p>
                    <p className="mt-0.5 text-[0.92rem] text-[#b6c4bb]">{t.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {c.features.items.length > 0 && (
          <section id="features" className="scroll-mt-16">
            <div className={`${wrap} py-14 lg:py-24`}>
              <h2 className="s-heading max-w-[40rem] text-[clamp(1.75rem,3.4vw,2.5rem)]">{c.features.title}</h2>
              {c.features.subtitle && <p className="s-lead mt-3 max-w-[40rem] text-(--s-steel) sm:text-lg">{c.features.subtitle}</p>}
              <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
                {c.features.items.map((f, i) => {
                  const Icon = SITE_ICON[f.icon]?.icon ?? ClipboardList;
                  return (
                    <li key={i} className="rounded-2xl border border-(--s-line) bg-white p-5">
                      <span className="grid size-10 place-items-center rounded-[10px] bg-(--s-green-soft) text-(--s-green)">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <h3 className="mt-3.5 text-[1.05rem] font-bold">{f.title}</h3>
                      <p className="mt-1 text-[0.95rem] text-(--s-steel)">{f.text}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {c.steps.items.length > 0 && (
          <section className="border-y border-(--s-line) bg-white">
            <div className={`${wrap} py-14 lg:py-24`}>
              <h2 className="s-heading max-w-[40rem] text-[clamp(1.75rem,3.4vw,2.5rem)]">{c.steps.title}</h2>
              <ol className="mt-8 grid gap-3 md:grid-cols-3 md:gap-4">
                {c.steps.items.map((s, i) => (
                  <li key={i} className="rounded-2xl border border-(--s-line) bg-(--s-mist) p-5">
                    <p className="text-sm font-bold text-(--s-green)">Step {i + 1}</p>
                    <h3 className="mt-1 text-[1.05rem] font-bold">{s.title}</h3>
                    <p className="mt-1 text-[0.95rem] text-(--s-steel)">{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {showPlans && (
          <section id="plans" className="scroll-mt-16">
            <div className={`${wrap} py-14 lg:py-24`}>
              <h2 className="s-heading text-[clamp(1.75rem,3.4vw,2.5rem)]">{c.plans.title}</h2>
              {c.plans.subtitle && <p className="s-lead mt-3 max-w-[40rem] text-(--s-steel) sm:text-lg">{c.plans.subtitle}</p>}
              <PlansTable plans={plans} demo={links.demo} />
              {c.plans.note && <p className="mt-4 text-sm text-(--s-muted)">{c.plans.note}</p>}
            </div>
          </section>
        )}

        {c.quotes.length > 0 && (
          <section className="border-y border-(--s-line) bg-white">
            <div className={`${wrap} grid gap-5 py-14 md:grid-cols-2 lg:py-24`}>
              {c.quotes.map((q, i) => (
                <figure key={i} className="m-0 rounded-2xl border border-(--s-line) bg-(--s-mist) p-6">
                  <blockquote className="s-heading text-[1.2rem] font-bold">&ldquo;{q.text}&rdquo;</blockquote>
                  <figcaption className="mt-3 text-(--s-steel)">
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
            className={`${wrap} scroll-mt-16 grid gap-6 py-14 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16 lg:py-24`}
          >
            <h2 className="s-heading text-[clamp(1.75rem,3.4vw,2.5rem)]">{c.faq.title}</h2>
            <div className="border-b border-(--s-line)">
              {c.faq.items.map((f, i) => (
                <details key={i} className="border-t border-(--s-line)">
                  <summary className="flex min-h-14 items-center justify-between gap-6 py-4 text-[1.05rem] font-bold">
                    {f.q}
                    <Plus className="s-plus size-5 shrink-0 text-(--s-green-solid)" aria-hidden />
                  </summary>
                  <p className="max-w-[44rem] pb-5 whitespace-pre-line text-(--s-steel)">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* The close: request a demo, or ask a question. */}
        <section id="contact" className="scroll-mt-16 px-0 pb-14 sm:px-5 lg:pb-24">
          <div className="mx-auto grid max-w-[76rem] gap-8 bg-(--s-green-solid) px-5 py-12 text-white sm:rounded-3xl sm:px-10 lg:grid-cols-2 lg:gap-14 lg:p-14">
            <div>
              <h2 className="s-display text-[clamp(1.9rem,4vw,3rem)]">{c.cta.title}</h2>
              {c.cta.text && <p className="s-lead mt-3 max-w-[32rem] text-lg text-white">{c.cta.text}</p>}
              <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3">
                <a href={links.demo("closing")} className={strongBtn}>
                  {c.hero.primary}
                </a>
                {links.signUp && (
                  <a
                    href={links.signUp("closing")}
                    className="inline-flex h-[52px] items-center justify-center rounded-xl border border-white/60 px-6 text-base font-semibold hover:bg-white/10"
                  >
                    Start a free trial
                  </a>
                )}
              </div>
              <ContactLines contact={c.contact} />
            </div>
            <div className="rounded-2xl bg-white p-5 text-(--s-ink) sm:p-7">
              <h3 className="s-heading text-xl">Ask a question</h3>
              <p className="mt-1 mb-5 text-(--s-steel)">We answer within one working day.</p>
              <ContactForm action={contactAction} origin={origin} disabled={preview} />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-(--s-line) bg-white">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-7 text-sm text-(--s-muted)`}>
          <p className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-(--s-green-solid) text-white">
              <ClipboardList className="size-4" aria-hidden />
            </span>
            © {new Date().getFullYear()} RFQ Desk
          </p>
          <div className="flex gap-5">
            <a href={links.signIn} className="hover:text-(--s-ink)">
              Sign in
            </a>
            <a href={links.demo("footer")} className="hover:text-(--s-ink)">
              {c.hero.primary}
            </a>
          </div>
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
      icon: <PhoneIcon className="size-5" aria-hidden />,
      label: contact.phone,
      href: `tel:${contact.phone.replace(/[^\d+]/g, "")}`,
    });
  if (!lines.length) return null;
  return (
    <ul className="mt-10 flex flex-col gap-3 text-lg">
      {lines.map((l) => (
        <li key={l.href}>
          <a href={l.href} className="inline-flex items-center gap-3 text-white underline-offset-4 hover:text-white hover:underline">
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
    <Scroll axis="x" size="lg" fade label="The plans compared" className="mt-10 rounded-2xl border border-(--s-line) bg-white">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <caption className="sr-only">The plans compared</caption>
        <thead>
          <tr className="align-top">
            <th scope="col" className="w-[26%] min-w-56 p-5">
              <span className="sr-only">What you get</span>
            </th>
            {plans.map((p) => (
              <th key={p.id} scope="col" className="border-l border-(--s-line) p-5 font-normal">
                <span className="s-heading block text-lg">{p.name}</span>
                <span className="mt-2 block whitespace-nowrap">
                  <span className="s-display text-[2rem]">{money(p.price, p.currency)}</span>{" "}
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
                    <Check className="size-5 text-(--s-green-solid)" aria-label="Included" />
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
                  className="inline-flex h-10 items-center rounded-[10px] border border-(--s-green-solid) px-4 font-semibold whitespace-nowrap text-(--s-green) hover:bg-(--s-green-soft)"
                >
                  Ask about {p.name}
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Scroll>
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
