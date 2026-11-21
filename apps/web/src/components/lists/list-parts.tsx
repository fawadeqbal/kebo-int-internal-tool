import type { ReactNode } from "react";
import { Avatar, Badge, cn, Dash, PhoneRow } from "@kebo/ui";

/*
 * The pieces every list page is made of (design "RFQ Desk — list pages", 18 Nov 2026): the facts line under the
 * header, the person responsible, a next follow-up, a priority tag that shows only when it is news, and a phone
 * row of three lines. Drawn on the inquiries list; orders, customers, suppliers and quotations use the same.
 */

/** The facts line is the one in @kebo/ui (FactsLine), the same on every list. */
export { FactsLine as FactLine, type Fact } from "@kebo/ui";

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
  if (!next) return <Dash />;
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
 * One record of a list on a phone: the one PhoneRow (two lines) — what it is, its tag and its next day; who it is for
 * and its number, where it stands as a coloured word. Who is responsible and the stage's words are the laptop's.
 */
export function ListRow({ href, title, tag, end, line, stands }: { href: string; title: ReactNode; tag?: ReactNode; end?: ReactNode; line: ReactNode; stands: ReactNode; who?: ReactNode }) {
  return (
    <PhoneRow
      href={href}
      title={
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{title}</span>
          {tag}
        </span>
      }
      figure={end ? <span className="text-xs font-medium">{end}</span> : undefined}
      line={line}
      status={stands}
    />
  );
}
