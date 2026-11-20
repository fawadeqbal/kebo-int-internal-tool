import { cn, RULES } from "@kebo/ui";

/*
 * Board "Loading": while a page's data comes, the page's own frame is drawn with grey bars where the words
 * will be, at the same sizes and in the same places as the parts it will hold (the page header, figure
 * tiles, tabs, the filter strip, the table or the record's cards). Nothing jumps when the page arrives.
 * Each part copies the frame of the real one (PageHeader, StatTile, LinkTabs, FilterCard, Table, record tabs).
 */

/** A grey bar where words will be. */
export function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-3.5 animate-pulse rounded-full bg-line", className)} />;
}

/** A grey block (an icon tile, a button, a chart). */
function Block({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("block animate-pulse bg-line", className)} style={style} />;
}

/** A button's outline where a button will be. */
function ButtonShape({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-10 shrink-0 rounded-[10px] border border-line bg-surface", className)} />;
}

/** The whole page on its way: a status for screen readers, the parts for the eye. */
function Loading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn(RULES.page.stack, className)}>
      {children}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/* ------------------------------------------------------------------ the parts */

/**
 * PageHeader: the path above, the module's icon tile, the title and its one line, the buttons on the right.
 * `record`: a record's title with its status chip; its buttons go under the title on a phone.
 */
export function HeaderSkeleton({ buttons = 1, record = false, line = true, icon = true }: { buttons?: number; record?: boolean; line?: boolean; icon?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex h-4 items-center gap-1.5">
        <Bar className="h-3 w-10" />
        <Bar className="h-3 w-16" />
        {record && <Bar className="h-3 w-24" />}
      </div>
      <div className={cn("flex items-start justify-between gap-3", record ? "max-sm:flex-col" : "flex-wrap")}>
        <div className={cn("flex min-w-0 items-start gap-3", record ? "flex-1" : "flex-[1_1_18rem]")}>
          {icon && <Block className="mt-0.5 hidden size-11 shrink-0 rounded-xl sm:block" />}
          <div className="flex min-h-[54px] min-w-0 flex-1 flex-col justify-center gap-2.5">
            <div className="flex items-center gap-2.5">
              <Bar className={cn("h-6", record ? "w-64 max-w-[70%]" : "w-40")} />
              {record && <Bar className="h-6 w-20 max-sm:hidden" />}
            </div>
            {line && <Bar className={cn("h-3", record ? "w-[28rem] max-w-full" : "w-60 max-w-full")} />}
          </div>
        </div>
        {buttons > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            {Array.from({ length: buttons }, (_, i) => (
              <ButtonShape key={i} className={i === buttons - 1 ? "w-28" : cn("w-24", record && "max-sm:hidden")} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** StatRow of StatTiles: two to a row on a phone, as many as fit on a wider screen. */
export function TilesSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-[94px] min-w-0 items-start gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5">
          <Block className="hidden size-[42px] shrink-0 rounded-xl sm:block" />
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

/** LinkTabs: the row of tabs with their counts. */
export function ChipsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  const widths = ["w-20", "w-28", "w-24", "w-32", "w-24", "w-28", "w-20"];
  return (
    <div className={cn("-mx-4 flex items-center gap-2 overflow-hidden px-4 py-0.5 sm:mx-0 sm:px-0.5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} aria-hidden className={cn("inline-flex h-9 shrink-0 items-center rounded-[10px] border border-line bg-surface px-3", widths[i % widths.length])}>
          <Bar className="h-3 w-full" />
        </span>
      ))}
    </div>
  );
}

/** FilterCard: the search box, a choice or two, and Filter. */
export function FilterSkeleton({ selects = 1, className }: { selects?: number; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5 rounded-[14px] border border-line bg-surface p-3", className)}>
      <span aria-hidden className="flex h-10 w-full min-w-0 flex-[1_1_260px] items-center gap-2 rounded-[10px] border border-line px-3 sm:w-auto">
        <Block className="size-4 rounded" />
        <Bar className="h-3 w-40" />
      </span>
      {Array.from({ length: selects }, (_, i) => (
        <ButtonShape key={i} className="w-40 max-sm:flex-[1_1_40%]" />
      ))}
      <ButtonShape className="w-[86px]" />
    </div>
  );
}

const CELL = ["w-[88px]", "w-40", "w-24", "w-20", "w-24", "w-28", "w-16", "w-20"];

/** A list in its card: on a phone, rows of two lines and an amount; wider, the table with its head row. */
export function TableSkeleton({ rows = 8, cols = 6, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-surface", className)}>
      <ul className="divide-y divide-line sm:hidden">
        {Array.from({ length: Math.min(rows, 6) }, (_, i) => (
          <li key={i} className="flex h-[69px] items-start justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 flex-col gap-2 pt-0.5">
              <Bar className="w-36" />
              <Bar className="h-3 w-48 max-w-full" />
            </span>
            <Bar className="mt-0.5 w-16" />
          </li>
        ))}
      </ul>
      <div className="max-sm:hidden">
        <div className="flex h-[42px] items-center gap-6 border-b border-line bg-faint px-3.5">
          {Array.from({ length: cols }, (_, i) => (
            <Bar key={i} className={cn("h-3 shrink-0", i === 1 ? "w-24" : "w-16", i === cols - 1 && "ml-auto")} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-[61px] items-center gap-6 border-b border-line px-3.5 last:border-b-0">
            {Array.from({ length: cols }, (_, j) => (
              <span key={j} className={cn("flex shrink-0 flex-col gap-1.5", j === cols - 1 && "ml-auto")}>
                <Bar className={CELL[j % CELL.length]} />
                {j === 1 && <Bar className="h-3 w-28" />}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A card with a title and a few lines (a record's sections, the side card). */
export function CardSkeleton({ lines = 4, title = true, className }: { lines?: number; title?: boolean; className?: string }) {
  const widths = ["w-full", "w-11/12", "w-3/4", "w-5/6", "w-2/3", "w-1/2"];
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-surface", className)}>
      {title && (
        <div className="flex h-[52px] items-center justify-between border-b border-line px-5">
          <Bar className="w-32" />
          <Bar className="h-3 w-16" />
        </div>
      )}
      <div className="flex flex-col gap-3.5 p-5">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Bar className={cn("h-3", widths[i % widths.length], "max-w-[60%]")} />
            <Bar className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pager under a list: "1–25 of 300" and the page buttons. */
function PagerSkeleton() {
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <Bar className="h-3 w-28" />
      <div className="flex gap-2">
        <ButtonShape className="h-9 w-20" />
        <ButtonShape className="h-9 w-16" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ whole pages */

/**
 * A list page on its way: header, figure tiles, tabs, the filter strip and the table, each where the page
 * draws it. Leave out what the page has not (tiles 0, chips 0, filter false).
 */
export function ListPageSkeleton({
  tiles = 4,
  chips = 0,
  filter = true,
  selects = 1,
  buttons = 1,
  rows = 8,
  cols = 6,
  views = false,
  segment = false,
}: {
  tiles?: number;
  chips?: number;
  filter?: boolean;
  selects?: number;
  buttons?: number;
  rows?: number;
  cols?: number;
  /** A List · Board switch next to the buttons. */
  views?: boolean;
  /** A switch between the page's sides under the header (Customers owe · We owe). */
  segment?: boolean;
}) {
  return (
    <Loading>
      <HeaderSkeleton buttons={buttons + (views ? 1 : 0)} />
      {segment && <Block className="h-[38px] w-[335px] max-w-full rounded-[10px]" />}
      {tiles > 0 && <TilesSkeleton count={tiles} />}
      {chips > 0 && <ChipsSkeleton count={chips} />}
      {filter && <FilterSkeleton selects={selects} />}
      <TableSkeleton rows={rows} cols={cols} />
      <PagerSkeleton />
    </Loading>
  );
}

/** The record tabs under a record's header (Overview, Items, Money…). */
export function RecordTabsSkeleton({ count = 6 }: { count?: number }) {
  const widths = ["w-16", "w-24", "w-20", "w-14", "w-20", "w-24", "w-16", "w-20", "w-14"];
  return (
    <div aria-hidden className="flex h-[42px] gap-x-[22px] overflow-hidden border-b border-line">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn("flex shrink-0 items-center border-b-2", i === 0 ? "border-line-strong" : "border-transparent")}>
          <Bar className={cn("h-3", widths[i % widths.length])} />
        </span>
      ))}
    </div>
  );
}

/**
 * A record's tab on its way (the record's header and tabs stay): the main column of cards and the side card,
 * as the record's Overview draws them. `tiles`: the figure tiles over them (customer and supplier pages).
 */
export function TabSkeleton({ side = true, tiles = 0, table = false }: { side?: boolean; tiles?: number; table?: boolean }) {
  return (
    <Loading>
      {tiles > 0 && <TilesSkeleton count={tiles} />}
      <div className={cn("grid items-start gap-4", side && RULES.page.withPanel)}>
        <div className="flex min-w-0 flex-col gap-4">
          {table ? (
            <TableSkeleton rows={6} cols={5} />
          ) : (
            <>
              <CardSkeleton lines={5} />
              <CardSkeleton lines={3} />
            </>
          )}
        </div>
        {side && <CardSkeleton lines={6} className="max-lg:hidden" />}
      </div>
    </Loading>
  );
}

/** A record on its way: its header (title, status, the line under it, buttons), its tabs and the Overview. */
export function RecordSkeleton({ tabs = 6, tiles = 0, side = true }: { tabs?: number; tiles?: number; side?: boolean }) {
  return (
    <Loading>
      <HeaderSkeleton record buttons={2} />
      {tabs > 0 && <RecordTabsSkeleton count={tabs} />}
      <div>
        <TabSkeleton tiles={tiles} side={side} />
      </div>
    </Loading>
  );
}

/** A board (Inquiries, Orders): header, tabs, filter, then columns of cards side by side. */
export function BoardSkeleton({ columns = 5, chips = 3 }: { columns?: number; chips?: number }) {
  return (
    <Loading>
      <HeaderSkeleton buttons={2} />
      {chips > 0 && <ChipsSkeleton count={chips} />}
      <FilterSkeleton selects={1} />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: columns }, (_, c) => (
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
    </Loading>
  );
}

/** A settings or form page: header, then cards of labelled fields. */
export function FormPageSkeleton({ sections = 2, fields = 4, icon = true }: { sections?: number; fields?: number; icon?: boolean }) {
  return (
    <Loading>
      <HeaderSkeleton buttons={0} icon={icon} />
      <div className="flex flex-col gap-4">
        {Array.from({ length: sections }, (_, s) => (
          <div key={s} className="rounded-2xl border border-line bg-surface p-5">
            <Bar className="mb-1 h-4 w-40" />
            <Bar className="mb-5 h-3 w-72 max-w-full" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: fields }, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Bar className="h-3 w-24" />
                  <ButtonShape className="w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Reports: header with the period, the report tabs, the figure tiles, then chart cards two to a row. */
export function ReportSkeleton({ tiles = 4, charts = 4 }: { tiles?: number; charts?: number }) {
  return (
    <Loading>
      <HeaderSkeleton buttons={3} />
      <ChipsSkeleton count={7} />
      {tiles > 0 && <TilesSkeleton count={tiles} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: charts }, (_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5">
            <Bar className="mb-1 w-36" />
            <Bar className="mb-5 h-3 w-52" />
            <div className="flex h-44 items-end gap-2">
              {[40, 65, 50, 80, 60, 90, 70, 55].map((h, j) => (
                <Block key={j} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Home: the greeting and its buttons, the card of what waits, the figures, then two columns of lists. */
export function DashboardSkeleton() {
  return (
    <Loading>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2.5">
          <Bar className="h-6 w-56" />
          <Bar className="h-3 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <ButtonShape className="w-32 max-sm:hidden" />
          <ButtonShape className="w-24 max-sm:hidden" />
          <ButtonShape className="w-32" />
        </div>
      </div>
      <CardSkeleton lines={4} />
      <TilesSkeleton count={4} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <CardSkeleton lines={6} />
        <CardSkeleton lines={4} />
      </div>
    </Loading>
  );
}
