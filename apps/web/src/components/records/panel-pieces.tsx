import type { ReactNode } from "react";
import Link from "next/link";
import { cn, linkClass } from "@kebo/ui";
import { SideSheet } from "@/components/common/side-sheet";
import { SideSection } from "@/components/orders/side-panel-parts";
import { SidePanelCard } from "@/components/orders/side-panel-parts";

/**
 * The record panel's pieces (canvas board "One side panel for every record"): every record's panel is made of the
 * same three — Who, Facts and Notes — one under another in one card, and on a phone one bar that opens them as a
 * sheet. The bar's line is put together from what each piece says matters (`bar`), so no record writes it by hand.
 */

/** A row's value colour: late (red), next (orange), done (quiet), or plain. */
export type PanelTone = "late" | "next" | "done" | "ok";

const TONE: Record<PanelTone, string> = { late: "font-semibold text-bad", next: "font-semibold text-action", done: "text-text-2", ok: "font-semibold text-ok" };

/** One row of a panel section: the label on the left, its value on the right (a link when it goes somewhere). */
export function PanelRow({ label, children, href, tone, sub }: { label: ReactNode; children: ReactNode; href?: string; tone?: PanelTone; sub?: ReactNode }) {
  const value = href ? (
    <Link href={href} className="hover:underline">
      {children}
    </Link>
  ) : (
    children
  );
  return (
    <li className="flex items-baseline justify-between gap-3 py-1 text-md">
      <span className="max-w-[55%] shrink-0 text-text-2 [overflow-wrap:anywhere]">{label}</span>
      <span className={cn("min-w-0 text-right tabular [overflow-wrap:anywhere]", tone ? TONE[tone] : "font-semibold", href && !tone && "text-primary")}>
        {value}
        {sub && <span className="block text-xs font-normal text-text-2">{sub}</span>}
      </span>
    </li>
  );
}

/** A section of the panel: the one side section (SideSection), so a record's panel and a step's look the same. */
const PanelSection = SideSection;

/** A quiet link beside a section's title ("All history", "Costs"). */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(linkClass, "text-md")}>
      {children}
    </Link>
  );
}

/**
 * The panel itself: one card with its sections, beside every tab of the record; on a phone the bar
 * "<title> · <bar>" that opens it. `bar`: the short facts the pieces gave, joined.
 */
export function PanelCard({ title, bar, children }: { title: string; bar: (string | null | undefined | false)[]; children: ReactNode }) {
  return (
    <SideSheet title={title} summary={bar.filter(Boolean).join(" · ")}>
      <SidePanelCard>{children}</SidePanelCard>
    </SideSheet>
  );
}

/** Who: the responsible person (a picker when they may change it), the other side, and the next follow-up. */
export function PanelWho({
  title,
  responsible,
  picker,
  take,
  people = [],
  followUp,
}: {
  title: string;
  /** Who handles it now, when it is shown read only. */
  responsible?: string | null;
  /** The picker that saves at once (in place of the read-only row). */
  picker?: ReactNode;
  /** "Take it", when nobody handles it and they may take it. */
  take?: ReactNode;
  /** The other people of the record: the supplier, the contact, the forwarder… */
  people?: { role: string; name: string; href?: string; sub?: string | null }[];
  followUp?: { text: string; late?: boolean; href: string } | null;
}) {
  return (
    <PanelSection title={title} lead={picker ? <div className="mb-1.5">{picker}</div> : undefined}>
      {!picker && (
        <PanelRow label="Responsible person" tone={responsible ? undefined : "next"}>
          {responsible ?? "Nobody yet"}
          {take && <span className="ml-2 inline-block">{take}</span>}
        </PanelRow>
      )}
      {people.map((p, i) => (
        <PanelRow key={`${p.role}-${i}`} label={p.role} href={p.href} sub={p.sub}>
          {p.name}
        </PanelRow>
      ))}
      {followUp && (
        <PanelRow label="Next follow-up" href={followUp.href} tone={followUp.late ? "late" : "next"}>
          {followUp.text}
        </PanelRow>
      )}
    </PanelSection>
  );
}

/** Facts: label · value rows (dates, money, where it is quoted), each with its tone. */
export function PanelFacts({ title, rows, action }: { title: string; rows: { label: string; value: ReactNode; tone?: PanelTone; href?: string; sub?: string | null }[]; action?: ReactNode }) {
  return (
    <PanelSection title={title} action={action}>
      {rows.map((r) => (
        <PanelRow key={r.label} label={r.label} tone={r.tone} href={r.href} sub={r.sub}>
          {r.value}
        </PanelRow>
      ))}
    </PanelSection>
  );
}

/** Notes: the latest ones, newest first, and the box to write one; All history beside the title. */
export function PanelNotes({ notes, allHref, form, max = 4 }: { notes: { id: string; body: string; by: string; when: string }[]; allHref?: string; form?: ReactNode; max?: number }) {
  return (
    <PanelSection title="Notes" action={allHref ? <PanelLink href={allHref}>All history</PanelLink> : undefined} empty={form ? undefined : "No notes yet."} footer={form ? <div className="mt-2">{form}</div> : undefined}>
      {notes.slice(0, max).map((n) => (
        <li key={n.id} className="flex flex-col py-1.5">
          <span className="line-clamp-3 text-sm whitespace-pre-line [overflow-wrap:anywhere]">{n.body}</span>
          <span className="text-xs text-text-2">
            {n.by} · {n.when}
          </span>
        </li>
      ))}
    </PanelSection>
  );
}
