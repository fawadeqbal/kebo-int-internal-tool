import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Segmented } from "@kebo/ui";
import { addDays } from "@kebo/utils";

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** A month or a year to look at, with links to the one before and after (the cash book, Payments). */
/** A month (YYYY-MM) or a year (YYYY) from ?p=, never after today. */
export function periodOf(asked: string | undefined, today: string) {
  const thisMonth = today.slice(0, 7);
  const period = /^\d{4}(-\d{2})?$/.test(asked ?? "") && asked! <= thisMonth ? asked! : thisMonth;
  const isYear = period.length === 4;
  const from = isYear ? `${period}-01-01` : `${period}-01`;
  const to = isYear ? `${period}-12-31` : addDays(`${addDays(`${period}-28`, 4).slice(0, 7)}-01`, -1);
  const prev = isYear ? String(Number(period) - 1) : addDays(from, -1).slice(0, 7);
  const next = isYear ? String(Number(period) + 1) : addDays(`${period}-28`, 4).slice(0, 7);
  const hasNext = isYear ? next <= today.slice(0, 4) : next <= thisMonth;
  const name = isYear ? period : MONTH_YEAR.format(new Date(`${period}-01T00:00:00Z`));
  return { period, isYear, from, to: to > today ? today : to, prev, next, hasNext, name, thisMonth };
}

export function PeriodBar({
  pr,
  href,
  today,
}: {
  pr: ReturnType<typeof periodOf>;
  href: (c: Record<string, string | undefined>) => string;
  today: string;
}) {
  const p = (v: string) => (v === pr.thisMonth ? undefined : v);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Period" className="inline-flex items-center rounded-lg border border-line bg-surface-2 p-0.5">
        <Link
          href={href({ p: pr.prev })}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:text-text"
          aria-label={`Previous ${pr.isYear ? "year" : "month"}`}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
        <span className="min-w-28 px-2 text-center text-sm font-medium">{pr.name}</span>
        {pr.hasNext ? (
          <Link
            href={href({ p: p(pr.next) })}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:text-text"
            aria-label={`Next ${pr.isYear ? "year" : "month"}`}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className="inline-flex size-7 items-center justify-center text-line-strong" aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        )}
      </nav>
      <Segmented
        label="Show a month or a year"
        options={[
          {
            href: href({ p: pr.isYear ? (pr.period === today.slice(0, 4) ? undefined : `${pr.period}-12`) : p(pr.period) }),
            label: "Month",
            active: !pr.isYear,
          },
          { href: href({ p: pr.period.slice(0, 4) }), label: "Year", active: pr.isYear },
        ]}
      />
    </div>
  );
}
