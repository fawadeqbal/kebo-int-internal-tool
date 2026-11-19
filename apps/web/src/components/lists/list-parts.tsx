import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, Badge, cn } from "@kebo/ui";

/*
 * The pieces every list page is made of (design "RFQ Desk — list pages", 18 Nov 2026): the facts line under the
 * header, the person responsible, a next follow-up, a priority tag that shows only when it is news, and a phone
 * row of three lines. Drawn on the inquiries list; orders, customers, suppliers and quotations use the same.
 */

export interface Fact {
  label: string;
  value: ReactNode;
  /** After the value, in grey ("9 quotations", "this year"). */
  sub?: string;
  tone?: "bad";
}

/**
 * One slim line of facts, only what the tabs do not already say (never a big card per number). Not on a phone:
 * there the tabs and the rows are the page.
 */
export function FactLine({ facts, className }: { facts: Fact[]; className?: string }) {
  if (!facts.length) return null;
  return (
    <dl aria-label="Facts" className={cn("mb-4 flex min-h-[46px] flex-wrap items-center rounded-xl border border-line bg-surface px-1.5 py-1.5 max-sm:hidden", className)}>
      {facts.map((f, i) => (
        <div key={f.label} className={cn("flex items-baseline gap-1.5 px-3.5 text-md whitespace-nowrap text-muted", i > 0 && "border-l border-line")}>
          <dt>{f.label}</dt>
          <dd className={cn("text-sm font-bold text-text tabular", f.tone === "bad" && "text-bad")}>{f.value}</dd>
          {f.sub && <dd>{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Who is responsible: initials and name, or "Nobody yet" in orange. `short`: the phone's smaller one. */
export function Responsible({ name, short }: { name: string | null | undefined; short?: boolean }) {
  if (!name) return <span className={cn("font-semibold whitespace-nowrap text-action", short ? "text-xs" : "text-md")}>Nobody yet</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center whitespace-nowrap text-text", short ? "gap-1.5 text-xs text-text-2" : "gap-2 text-md")}>
      <Avatar name={name} size={short ? 20 : 24} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export interface NextUp {
  dueOn: string;
  today: boolean;
  late: boolean;
}

/** A next follow-up: Today in orange, late in red with its date, else its day; none: a grey dash. */
export function FollowUpDay({ next, day }: { next: NextUp | null | undefined; day: (iso: string) => string }) {
  if (!next) return <span className="text-muted">—</span>;
  if (next.today) return <span className="font-semibold whitespace-nowrap text-action">Today</span>;
  if (next.late) return <span className="font-semibold whitespace-nowrap text-bad">Late · {day(next.dueOn)}</span>;
  return <span className="whitespace-nowrap text-text">{day(next.dueOn)}</span>;
}

/** Priority only when it is news (High, Urgent); Normal and Low say nothing. */
export function PriorityTag({ priority }: { priority: string }) {
  if (priority !== "high" && priority !== "urgent") return null;
  return (
    <Badge tone={priority === "urgent" ? "bad" : "warn"} className="ml-1.5 align-[1px]">
      {priority === "urgent" ? "Urgent" : "High"}
    </Badge>
  );
}

/** The stage pill and the one fact that matters now beside it ("1 of 3 suppliers answered"). */
export function Stands({ pill, fact }: { pill: ReactNode; fact?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
      {pill}
      {fact && <span className="truncate text-md text-text-2">{fact}</span>}
    </span>
  );
}

/**
 * One record on a phone, in three lines: what it is and its next step (right); who it is for and its number; where
 * it stands and who is responsible (right). The whole row opens it.
 */
export function ListRow({ href, title, tag, end, line, stands, who }: { href: string; title: ReactNode; tag?: ReactNode; end?: ReactNode; line: ReactNode; stands: ReactNode; who?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="block px-4 py-3 text-md leading-[18px] active:bg-surface-2">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-semibold text-text">{title}</span>
          {tag}
          {end && <span className="shrink-0 text-md">{end}</span>}
        </span>
        <span className="mt-px block truncate text-text-2">{line}</span>
        <span className="mt-1.5 flex items-center gap-2">
          <span className="min-w-0 flex-1">{stands}</span>
          {who}
        </span>
      </Link>
    </li>
  );
}
