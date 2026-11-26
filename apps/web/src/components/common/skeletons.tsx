import { cn, RULES } from "@kebo/ui";
import { partsOf, type Part } from "@/lib/page-shapes";

/*
 * While a page's data comes, the page is drawn with grey bars in the same parts, sizes and places as the page
 * itself: its header, facts line, tabs, filter row, table, or a record's top, tabs and body. Nothing jumps when
 * the page arrives.
 *
 * The rule (Fawad 21 Nov): one shape per page, written once in lib/page-shapes.ts, drawn here from the same
 * pieces. Each piece carries the same data-part as the real one (PageHeader, FactsLine, TabRow, FilterCard,
 * Table, RecordTop, RecordBody…), and a browser test checks every page's skeleton against the page itself.
 */

/** A grey bar where words will be. */
export function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-3.5 animate-pulse rounded-full bg-line", className)} />;
}

/** A grey block (a chart, a photo). */
function Block({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("block animate-pulse bg-line", className)} style={style} />;
}

/** A button's outline where a button will be. */
function ButtonShape({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-10 shrink-0 rounded-[10px] border border-line bg-surface", className)} />;
}

/* ------------------------------------------------------------------ the parts, as the page draws them */

/** PageHeader of a list or a settings page: the path, the title, the buttons on the right. */
function Header({ buttons = 2 }: { buttons?: number }) {
  // A phone: the name is in the bar and the strong button is the bottom bar's +, so nothing here (PageHeader).
  return (
    <div data-part="header" className="max-md:hidden">
      <div className="mb-2 flex h-4 items-center gap-1.5">
        <Bar className="h-3 w-10" />
        <Bar className="h-3 w-16" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Bar className="h-7 w-44" />
        <div className="flex items-center gap-2">
          {Array.from({ length: buttons }, (_, i) => (
            <ButtonShape key={i} className={i === buttons - 1 ? "w-36" : "w-24 max-sm:hidden"} />
          ))}
          <ButtonShape className="w-10 max-sm:hidden" />
        </div>
      </div>
    </div>
  );
}

/** A record's top: ←, the name, its code and one line under it, the buttons. */
function RecordTop() {
  return (
    <div data-part="record-top">
      <div className="mb-2 flex h-4 items-center gap-1.5">
        <Bar className="h-3 w-10" />
        <Bar className="h-3 w-16" />
        <Bar className="h-3 w-28" />
      </div>
      <div className="flex items-start justify-between gap-3 max-sm:flex-col">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ButtonShape className="hidden w-10 sm:block" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1">
            <Bar className="h-7 w-72 max-w-[80%]" />
            <div className="flex items-center gap-2">
              <Bar className="h-5 w-20 rounded-md" />
              <Bar className="h-3 w-56 max-w-[60%]" />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ButtonShape className="w-20 max-sm:hidden" />
          <ButtonShape className="w-32" />
          <ButtonShape className="w-10" />
        </div>
      </div>
    </div>
  );
}

/** FactsLine: one row of label · figure · line, split by thin lines (a laptop only, as the page). */
function Facts({ n }: { n: number }) {
  return (
    <>
    <span aria-hidden className="flex h-5 items-center gap-2 sm:hidden">
      <Bar className="h-3 w-24" />
      <Bar className="h-3 w-32" />
    </span>
    <div data-part="facts" data-count={n} className="flex min-h-[46px] items-center rounded-xl border border-line bg-surface px-1.5 py-1.5 max-sm:hidden">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cn("flex items-center gap-2 px-3.5", i > 0 && "border-l border-line")}>
          <Bar className="h-3 w-16" />
          <Bar className="h-3.5 w-14" />
          <Bar className="h-3 w-20 max-lg:hidden" />
        </span>
      ))}
    </div>
    </>
  );
}

const TAB_W = ["w-12", "w-24", "w-16", "w-20", "w-14", "w-20", "w-24", "w-16", "w-20"];

/** A list's tabs: underlined on a laptop, round chips that slide on a phone (TabRow, phone "chips"). */
function Tabs({ n }: { n: number }) {
  return (
    <div data-part="tabs" data-count={n} aria-hidden className="-mx-4 flex items-center gap-2 overflow-hidden px-4 py-0.5 sm:mx-0 sm:h-[42px] sm:items-stretch sm:gap-x-[22px] sm:border-b sm:border-line sm:px-0 sm:py-0">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={cn(
            "flex shrink-0 items-center max-sm:h-10 max-sm:rounded-full max-sm:border max-sm:border-line max-sm:bg-surface max-sm:px-3 sm:-mb-px sm:border-b-2",
            i === 0 ? "sm:border-line-strong" : "sm:border-transparent",
          )}
        >
          <Bar className={cn("h-3", TAB_W[i % TAB_W.length])} />
        </span>
      ))}
    </div>
  );
}

/** A record's tabs (TabRow): underlined everywhere, the first one current. */
function RecordTabs({ n }: { n: number }) {
  return (
    <div data-part="record-tabs" data-count={n} aria-hidden className="flex h-[42px] gap-x-[22px] overflow-hidden border-b border-line">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cn("-mb-px flex shrink-0 items-center border-b-2", i === 0 ? "border-line-strong" : "border-transparent")}>
          <Bar className={cn("h-3", TAB_W[i % TAB_W.length])} />
        </span>
      ))}
    </div>
  );
}

/** FilterCard: the search box, its choices, and how many on the right. */
function Filter({ n }: { n: number }) {
  return (
    <div data-part="filter" data-count={n} className="flex flex-wrap items-center gap-2">
      <span aria-hidden className={cn("flex h-10 min-w-0 flex-[0_1_340px] items-center gap-2 rounded-[10px] border border-line bg-surface px-3", n > 0 ? "max-sm:flex-1" : "max-sm:basis-full")}>
        <Block className="size-4 rounded" />
        <Bar className="h-3 w-40" />
      </span>
      {Array.from({ length: n }, (_, i) => (
        <ButtonShape key={i} className="w-28 max-sm:hidden" />
      ))}
      {n > 0 && <ButtonShape className="w-11 sm:hidden" />}
      <Bar className="ml-auto h-3 w-24 max-sm:hidden" />
    </div>
  );
}

const CELL = ["w-[72px]", "w-44", "w-20", "w-16", "w-12", "w-20", "w-24", "w-16"];

/** A list's table in its card (DataTable, Table): the head row and rows; on a phone, rows of two lines. */
function TablePart({ rows = 8, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <div data-part="table" className="overflow-hidden rounded-2xl border border-line bg-surface">
      <ul className="divide-y divide-line sm:hidden">
        {Array.from({ length: Math.min(rows, 6) }, (_, i) => (
          <li key={i} className="flex h-[58px] flex-col justify-center gap-2 px-4">
            <span className="flex items-center justify-between gap-3">
              <Bar className="w-36" />
              <Bar className="w-16" />
            </span>
            <span className="flex items-center justify-between gap-3">
              <Bar className="h-3 w-48 max-w-[60%]" />
              <Bar className="h-3 w-14" />
            </span>
          </li>
        ))}
      </ul>
      <div className="max-sm:hidden">
        <div className="flex h-[42px] items-center gap-8 border-b border-line px-5">
          {Array.from({ length: cols }, (_, i) => (
            <Bar key={i} className={cn("h-3 shrink-0", i === 1 ? "w-20" : "w-14", i === cols - 1 && "ml-auto")} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-[60px] items-center gap-8 border-b border-line px-5 last:border-b-0">
            {Array.from({ length: cols }, (_, j) => (
              <span key={j} className={cn("flex shrink-0 flex-col gap-1.5", j === cols - 1 && "ml-auto")}>
                <Bar className={CELL[j % CELL.length]} />
                {j === 1 && <Bar className="h-3 w-32" />}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A card with a title and a few label · value lines (a record's boxes, the side panel). */
export function CardSkeleton({ lines = 4, title = true, className }: { lines?: number; title?: boolean; className?: string }) {
  const widths = ["w-28", "w-36", "w-24", "w-32", "w-20", "w-28"];
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-surface", className)}>
      {title && (
        <div className="flex h-[52px] items-center justify-between border-b border-line px-5">
          <Bar className="w-28" />
          <Bar className="h-3 w-12" />
        </div>
      )}
      <div className="flex flex-col gap-3.5 p-5">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Bar className={cn("h-3", widths[i % widths.length])} />
            <Bar className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A record's body (RecordBody): its boxes, and the side panel of 320 when it has one (on a phone, its bar). */
function RecordBodyPart({ panel }: { panel: boolean }) {
  return (
    <div data-part="record-body" data-panel={panel ? "" : undefined} className={cn("grid items-start gap-4", panel ? RULES.page.withPanel : "grid-cols-[minmax(0,1fr)]")}>
      <div className="flex min-w-0 flex-col gap-4">
        <span aria-hidden className="flex h-[52px] items-center gap-4 rounded-xl border border-line bg-surface px-5 max-sm:hidden">
          <Bar className="h-3 w-40" />
          <Bar className="h-3 w-40" />
          <Bar className="h-3 w-32" />
        </span>
        <CardSkeleton lines={5} />
        <CardSkeleton lines={3} />
      </div>
      {panel && (
        <div className="flex min-w-0 flex-col gap-4 max-lg:order-first">
          <span aria-hidden className="flex h-12 items-center justify-between rounded-xl border border-line bg-surface px-4 lg:hidden">
            <Bar className="w-28" />
            <Bar className="h-3 w-10" />
          </span>
          <CardSkeleton lines={6} className="max-lg:hidden" />
          <CardSkeleton lines={3} className="max-lg:hidden" />
        </div>
      )}
    </div>
  );
}

/** StatRow of StatTiles: two to a row on a phone, as many as fit on a wider screen. */
export function TilesSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div data-part="tiles" data-count={count} className={cn("grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-[94px] min-w-0 items-start gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <Bar className="h-3 w-20 max-w-full" />
            <Bar className="h-5 w-24 max-w-full" />
            <Bar className="h-3 w-16 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ what the shape names but the test does not check */

/** Home's greeting and its buttons. */
function Greeting() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-2.5">
        <Bar className="h-7 w-56" />
        <Bar className="h-3 w-72 max-w-full" />
      </div>
      <div className="flex gap-2">
        <ButtonShape className="w-32 max-sm:hidden" />
        <ButtonShape className="w-32" />
      </div>
    </div>
  );
}

/** A board's columns of cards. */
function Board({ n }: { n: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: n }, (_, c) => (
        <div key={c} className="flex w-[272px] shrink-0 flex-col gap-2.5 rounded-2xl border border-line bg-surface-2/60 p-2.5">
          <div className="flex items-center justify-between px-1.5 py-1">
            <Bar className="w-24" />
            <Bar className="h-3 w-6" />
          </div>
          {Array.from({ length: 4 - (c % 2) }, (_, i) => (
            <div key={i} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3.5">
              <Bar className="h-3 w-20" />
              <Bar className="w-40" />
              <Bar className="h-3 w-28" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Settings: boxes of labelled fields, laid out as the page's cards are (one 720 column; two on a big screen). */
function Form({ n }: { n: number }) {
  return (
    <div className="@container">
      <div className={RULES.page.cards}>
      {Array.from({ length: n }, (_, s) => (
        <div key={s} className="rounded-2xl border border-line bg-surface p-5">
          <Bar className="mb-5 h-4 w-40" />
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Bar className="h-3 w-24" />
                <ButtonShape className="w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

/** Report charts, two to a row. */
function Charts({ n }: { n: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface p-5">
          <Bar className="mb-5 w-36" />
          <div className="flex h-44 items-end gap-2">
            {[40, 65, 50, 80, 60, 90, 70, 55].map((h, j) => (
              <Block key={j} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** "1–25 of 204" and the page buttons under a list. */
function Pager() {
  return (
    <div aria-hidden className="flex items-center justify-between gap-3">
      <Bar className="h-3 w-24" />
      <div className="flex gap-2">
        <ButtonShape className="h-9 w-9" />
        <ButtonShape className="h-9 w-9" />
        <ButtonShape className="h-9 w-9" />
      </div>
    </div>
  );
}

function PartOf({ p }: { p: Part }) {
  switch (p.name) {
    case "header":
      return <Header />;
    case "record-top":
      return <RecordTop />;
    case "facts":
      return <Facts n={p.n ?? 4} />;
    case "tiles":
      return <TilesSkeleton count={p.n ?? 4} />;
    case "tabs":
      return <Tabs n={p.n ?? 4} />;
    case "record-tabs":
      return <RecordTabs n={p.n ?? 6} />;
    case "filter":
      return <Filter n={p.n ?? 1} />;
    case "table":
      return <TablePart />;
    case "record-body":
      return <RecordBodyPart panel={!!p.panel} />;
    case "~greeting":
      return <Greeting />;
    case "~board":
      return <Board n={p.n ?? 4} />;
    case "~form":
      return <Form n={p.n ?? 2} />;
    case "~charts":
      return <Charts n={p.n ?? 2} />;
    case "~cards":
      return (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {Array.from({ length: p.n ?? 2 }, (_, i) => (
            <CardSkeleton key={i} lines={i % 2 ? 4 : 6} />
          ))}
        </div>
      );
    case "~pager":
      return <Pager />;
  }
}

/**
 * A page on its way, drawn from its shape ("header · facts:4 · tabs:5 · filter:3 · table · ~pager").
 * `tab`: only what changes when a record's tab changes (its body): the record's top and tabs stay.
 */
export function PageSkeleton({ shape, tab = false }: { shape: string; tab?: boolean }) {
  const parts = partsOf(shape).filter((p) => !tab || !["record-top", "record-tabs", "header"].includes(p.name));
  return (
    <div role="status" aria-label="Loading" className={RULES.page.stack}>
      {parts.map((p, i) => (
        <PartOf key={i} p={p} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
