import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Mail, MessageCircle, Pencil, Phone } from "lucide-react";
import { buttonClass, Card, cn, LinkTabs, StatusBadge, type StatusMeaning } from "@kebo/ui";
import { InfoTip } from "@kebo/ui/client";
import { OpenPanelButton } from "@/components/common/panel";
import { CopyButton } from "./party-client";

/**
 * The parts of a customer's and a factory's page (approved design 36): the tabs, the four figure tiles, the
 * Overview cards (Needs attention, what is open, primary contact, key details, latest activity), the tabs'
 * cards and the phone's bottom bar. The same on both pages, so later supplier and item pages can use them.
 */

export type PartyTab = { key: string; label: string; count?: number };

/** One tab at a time; the URL (?tab=) remembers it. On a phone the row scrolls sideways. */
export function PartyTabs({ base, tabs, current }: { base: string; tabs: PartyTab[]; current: string }) {
  return (
    <LinkTabs
      label="Sections"
      className="-mx-1 mb-5 px-1"
      tabs={tabs.map((t) => ({ href: t.key === "overview" ? base : `${base}?tab=${t.key}`, label: t.label, count: t.count, active: t.key === current }))}
    />
  );
}

/* ---------------------------------------------------------------- figures */

export interface TileProps {
  label: string;
  help?: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "bad" | "warn";
}

/** The four figures, each once on the page; ⓘ says what it is. Two by two on a phone. */
export function Tiles({ items }: { items: TileProps[] }) {
  return (
    <section aria-label="Figures" className={cn("mb-5 grid grid-cols-2 gap-3", items.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {items.map((t, i) => (
        <div key={t.label} className="min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
          <p className="flex items-center gap-1 text-xs font-medium text-text-2">
            {t.label}
            {t.help && (
              <InfoTip label={`About ${t.label}`} align={i % 2 === 0 ? "start" : "end"}>
                {t.help}
              </InfoTip>
            )}
          </p>
          <p className={cn("mt-1 truncate text-lg font-bold tabular sm:text-[22px] sm:leading-7", t.tone === "bad" && "text-bad", t.tone === "warn" && "text-warn")}>{t.value}</p>
          {t.sub && <p className="mt-0.5 truncate text-xs text-text-2">{t.sub}</p>}
        </div>
      ))}
    </section>
  );
}

/* ---------------------------------------------------------------- cards */

/** A card with its title (and count), an action on the right, then its body. */
export function PartyCard({
  title,
  count,
  help,
  action,
  children,
  className,
  id,
}: {
  title: string;
  count?: number | string;
  help?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card id={id} className={cn("overflow-visible", className)}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="flex min-w-0 items-center gap-1 text-[15px] font-semibold text-text">
          <span className="truncate">
            {title}
            {count !== undefined && ` · ${count}`}
          </span>
          {help && <InfoTip label={`About ${title}`}>{help}</InfoTip>}
        </h2>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

/** "All 7 →": the whole list on its tab. */
export function AllTab({ href, count }: { href: string; count: number }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
      All {count} <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

/** "✎ Edit" in a card's header: the record's side panel. */
export function EditButton({ panel, id, label }: { panel: string; id: string; label: string }) {
  return (
    <OpenPanelButton panel={panel} id={id} size="sm" className="h-8 px-2.5 text-[13px] [&_svg]:size-3.5" label={label}>
      <Pencil aria-hidden /> Edit
    </OpenPanelButton>
  );
}

export interface AttentionRow {
  key: string;
  tone: "bad" | "warn";
  title: ReactNode;
  sub: ReactNode;
  href?: string;
  action: ReactNode;
}

/** Needs attention: only what is overdue or due today, five at most, each with its one button. Not drawn when empty. */
export function AttentionCard({ rows }: { rows: AttentionRow[] }) {
  if (!rows.length) return null;
  return (
    <PartyCard title="Needs attention" count={rows.length}>
      <ul className="divide-y divide-line">
        {rows.slice(0, 5).map((r) => (
          <li key={r.key} className="flex items-center gap-3 px-4 py-2.5">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", r.tone === "bad" ? "bg-bad" : "bg-warn")} />
            <span className="min-w-0 flex-1">
              {r.href ? (
                <Link href={r.href} className="block text-sm font-medium [overflow-wrap:anywhere] hover:text-primary">
                  {r.title}
                </Link>
              ) : (
                <span className="block text-sm font-medium [overflow-wrap:anywhere]">{r.title}</span>
              )}
              <span className="block text-xs text-text-2">
                <span className="sr-only">{r.tone === "bad" ? "Overdue: " : "Due today: "}</span>
                {r.sub}
              </span>
            </span>
            <span className="shrink-0">{r.action}</span>
          </li>
        ))}
      </ul>
    </PartyCard>
  );
}

/** A row of a list card: name, one line under it, a badge on the right. The whole row opens `href`. */
export function ListRow({ href, title, sub, badge, figure }: { href?: string; title: ReactNode; sub?: ReactNode; badge?: ReactNode; figure?: ReactNode }) {
  return (
    <li className={cn("relative flex items-center gap-3 px-4 py-2.5", href && "hover:bg-primary-soft/50")}>
      <span className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="block truncate text-sm font-medium tabular outline-none after:absolute after:inset-0 hover:text-primary focus-visible:underline">
            {title}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium">{title}</span>
        )}
        {sub && <span className="block truncate text-xs text-text-2">{sub}</span>}
      </span>
      {figure !== undefined && <span className="shrink-0 text-right text-sm tabular">{figure}</span>}
      {badge && <span className="shrink-0">{badge}</span>}
    </li>
  );
}

/** An empty tab or card: one line, then the button that adds one. */
export function EmptyLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <p className="text-sm text-text-2">{children}</p>
      {action}
    </div>
  );
}

/** Label and value rows (Key details, Company, Sales terms, Bank). */
export function Facts({ items, wide }: { items: { label: string; value: ReactNode }[]; wide?: boolean }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-2 px-4 py-3.5 text-sm", wide ? "grid-cols-[minmax(7rem,11rem)_1fr]" : "grid-cols-[minmax(6rem,7.5rem)_1fr]")}>
      {items.map((i) => (
        <div key={i.label} className="contents">
          <dt className="text-text-2">{i.label}</dt>
          <dd className="min-w-0 break-words text-text">{i.value === null || i.value === undefined || i.value === "" ? <span className="text-muted">—</span> : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------------------------------------------------------- contact */

export interface ReachableContact {
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  whatsapp?: string | null;
  wechat?: string | null;
}

const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;

/** The primary contact with Call / WhatsApp (WeChat for a factory) / Email. */
export function ContactCard({ contact, all, chat, empty }: { contact: ReachableContact | null; all?: { href: string; count: number }; chat: "whatsapp" | "wechat"; empty: ReactNode }) {
  const wa = contact?.whatsapp || contact?.phone;
  return (
    <PartyCard title="Primary contact" action={all && all.count > 1 ? <AllTab href={all.href} count={all.count} /> : undefined}>
      {contact ? (
        <div className="px-4 py-3">
          <p className="text-sm font-semibold">{contact.name}</p>
          {contact.position && <p className="text-xs text-text-2">{contact.position}</p>}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className={buttonClass("secondary", "sm")} aria-label={`Call ${contact.name} on ${contact.phone}`}>
                <Phone aria-hidden /> Call
              </a>
            )}
            {chat === "whatsapp" && wa && (
              <a href={waLink(wa)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")} aria-label={`WhatsApp ${contact.name}`}>
                <MessageCircle aria-hidden /> WhatsApp
              </a>
            )}
            {chat === "wechat" && contact.wechat && <CopyButton text={contact.wechat} label="WeChat" done="WeChat ID copied" />}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className={buttonClass("secondary", "sm")} aria-label={`Email ${contact.name}`}>
                <Mail aria-hidden /> Email
              </a>
            )}
          </div>
        </div>
      ) : (
        empty
      )}
    </PartyCard>
  );
}

/* ---------------------------------------------------------------- activity */

export type ActivityKind = "note" | "follow_up" | "payment" | "quotation" | "supplier_quote" | "change" | "order" | "inquiry";

export interface ActivityItem {
  key: string;
  /** ISO date or date-time: newest first. */
  at: string;
  kind: ActivityKind;
  who: string | null;
  text: ReactNode;
  href?: string;
}

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  note: "note",
  follow_up: "follow-up done",
  payment: "payment",
  quotation: "quotation",
  supplier_quote: "supplier quote",
  change: "change",
  order: "sales order",
  inquiry: "inquiry",
};

/** One line of the timeline: who · kind, what, when. */
export function ActivityLine({ a, when }: { a: ActivityItem; when: string }) {
  return (
    <li className="px-4 py-2.5">
      <p className="text-sm [overflow-wrap:anywhere]">
        {a.who && <span className="font-semibold">{a.who} · </span>}
        <span className="font-semibold">{a.who ? ACTIVITY_KIND_LABEL[a.kind] : ACTIVITY_KIND_LABEL[a.kind].replace(/^./, (c) => c.toUpperCase())}</span>{" "}
        {a.href ? (
          <Link href={a.href} className="hover:text-primary hover:underline">
            {a.text}
          </Link>
        ) : (
          a.text
        )}
      </p>
      <p className="text-xs text-text-2">{when}</p>
    </li>
  );
}

/* ---------------------------------------------------------------- status */

/** The one badge of a customer or factory, from what is owed (glossary: Outstanding · Overdue · Paid up · No order yet · New). */
export function partyStatus(p: { overdue: boolean; outstanding: boolean; ordered: boolean; started: boolean }): { meaning: StatusMeaning; label: string } {
  if (p.overdue) return { meaning: "bad", label: "Overdue" };
  if (p.outstanding) return { meaning: "warn", label: "Outstanding" };
  if (p.ordered) return { meaning: "ok", label: "Paid up" };
  return { meaning: "neutral", label: p.started ? "No order yet" : "New" };
}

export function PartyBadge({ s }: { s: { meaning: StatusMeaning; label: string } }) {
  return <StatusBadge meaning={s.meaning}>{s.label}</StatusBadge>;
}

/* ---------------------------------------------------------------- layout */

/** Overview: work on the left, reference in a 320px column on the right (under it on a phone). */
export function OverviewFrame({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-5">{main}</div>
      <aside aria-label="Reference" className="flex min-w-0 flex-col gap-5">
        {side}
      </aside>
    </div>
  );
}

/** Phone only: the page's quick actions, pinned to the bottom of the screen. */
export function PhoneBar({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden className="h-16 sm:hidden" />
      <div className="no-print fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-line bg-surface/95 px-3 py-2.5 shadow-pop backdrop-blur sm:hidden [&>*]:flex-1">
        {children}
      </div>
    </>
  );
}

/** A row of filter chips (links) with an end slot: Export, Add note… */
export function ChipRow({ chips, end }: { chips: { href: string; label: string; count: number; active: boolean }[]; end?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <nav aria-label="Filter" className="flex flex-wrap items-center gap-1">
        {chips.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            scroll={false}
            aria-current={c.active ? "true" : undefined}
            className={cn("inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-text-2 hover:bg-surface-2 hover:text-text", c.active && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary")}
          >
            {c.label} · {c.count}
          </Link>
        ))}
      </nav>
      {end && <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/** "Total USD 186,420.00   Received USD 93,620.32   Balance due USD 92,799.68" under a table. */
export function TotalsLine({ items }: { items: { label: string; value: string }[][] }) {
  return (
    <div className="mt-2.5 flex flex-col items-end gap-1 px-1 text-sm">
      {items.map((line, i) => (
        <p key={i} className="flex flex-wrap justify-end gap-x-5 gap-y-1">
          {line.map((x) => (
            <span key={x.label}>
              <span className="text-text-2">{x.label}</span> <span className="font-semibold tabular">{x.value}</span>
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
