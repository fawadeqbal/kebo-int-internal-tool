import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { Tone } from "@kebo/shared";
import { Badge, EmptyLine, LinkTabs, linkClass, cn } from "@kebo/ui";

/** One column of a board: a state of the record type, its count, the cards it shows and where the rest are. */
export interface BoardColumn<R> {
  key: string;
  label: string;
  tone: Tone;
  total: number;
  rows: R[];
  /** With no cards ("Nothing on hold."). */
  empty: string;
  /** The list of all of them, for "Show N more". */
  moreHref: string;
  /** What the column is worth ("USD 26.4K"), at the end of its head. */
  value?: string | null;
}

/** The grid for 3, 4 or 5 columns and the folded Closed one (whole class names, for Tailwind). */
const GRID: Record<number, string> = {
  3: "xl:grid-cols-[repeat(3,minmax(0,1fr))_200px]",
  4: "xl:grid-cols-[repeat(4,minmax(0,1fr))_200px]",
  5: "xl:grid-cols-[repeat(5,minmax(0,1fr))_200px]",
};
/** The same without a folded column (a board whose every state is a column: the orders'). */
const GRID_OPEN: Record<number, string> = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
};

/**
 * A board (canvas "RFQ Desk — the pieces", board "Board"; design rule 15): the open states are the columns, each
 * with its pill and count, its cards (the row's facts, in the row's order) and "Show N more"; the closed ones fold
 * into one small column. Below a wide laptop one column at a time, chosen by tabs.
 */
export function Board<R>({
  columns,
  card,
  rowKey,
  closed,
  phoneKey,
  phoneHref,
}: {
  columns: BoardColumn<R>[];
  /** One card: an <li> (the record type's card). */
  card: (row: R) => ReactNode;
  rowKey: (row: R) => string;
  /** The folded column for the closed states (none: every state is a column). */
  closed?: ReactNode;
  /** The column shown alone below a wide laptop, and each column's link. */
  phoneKey: string;
  phoneHref: (key: string) => string;
}) {
  const column = (c: BoardColumn<R>, hideTitle = false) => (
    <section key={c.key} aria-label={c.label} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-3/70 p-2.5">
      {!hideTitle && (
        <h2 className="mx-0.5 flex items-center gap-2 text-md font-bold">
          <Badge tone={c.tone}>{c.label}</Badge>
          <span className="text-xs font-semibold text-muted">{c.total}</span>
          {c.value && <span className="ml-auto text-xs font-medium text-muted">{c.value}</span>}
        </h2>
      )}
      {c.rows.length ? (
        <ul className="flex flex-col gap-2">
          {c.rows.map((r) => (
            <Fragment key={rowKey(r)}>{card(r)}</Fragment>
          ))}
        </ul>
      ) : (
        <EmptyLine className="px-1 pt-1 pb-2">{c.empty}</EmptyLine>
      )}
      {c.total > c.rows.length && (
        <Link href={c.moreHref} className={cn(linkClass, "px-1 text-md")}>
          Show {c.total - c.rows.length} more
        </Link>
      )}
    </section>
  );
  return (
    <>
      <div className="xl:hidden">
        <LinkTabs
          label="Stage"
          look="tabs"
          className="mb-4"
          tabs={columns.map((c) => ({ href: phoneHref(c.key), label: c.label, count: c.total, active: c.key === phoneKey }))}
        />
        {column(columns.find((c) => c.key === phoneKey) ?? columns[0]!, true)}
        {closed && <div className="mt-3">{closed}</div>}
      </div>
      <div className={`hidden items-start gap-3 xl:grid ${closed ? (GRID[columns.length] ?? GRID[4]) : (GRID_OPEN[columns.length] ?? GRID_OPEN[4])}`}>
        {columns.map((c) => column(c))}
        {closed}
      </div>
    </>
  );
}
