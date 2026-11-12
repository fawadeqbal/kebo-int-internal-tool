import { cn } from "@kebo/ui";

/** A grey bar where words will be (board "Loading"). */
export function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block h-3.5 animate-pulse rounded-full bg-surface-2", className)} />;
}

/** A card of rows of bars: a table on its way. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Bar className="w-[90px]" />
          <Bar className="w-2/5" />
          <Bar className="w-20 max-sm:hidden" />
          <Bar className="ml-auto w-[60px]" />
        </div>
      ))}
    </div>
  );
}

/** Figure tiles on their way. */
export function TilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-3.5">
          <Bar className="w-24" />
          <Bar className="h-5 w-32" />
          <Bar className="w-20" />
        </div>
      ))}
    </div>
  );
}

/** A list page on its way: header, figures, chips, the filter strip and the table. */
export function ListPageSkeleton({ tiles = 4, chips = 0 }: { tiles?: number; chips?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="size-11 animate-pulse rounded-xl bg-surface-2" aria-hidden />
        <span className="flex flex-col gap-2">
          <Bar className="h-6 w-48" />
          <Bar className="w-64" />
        </span>
      </div>
      {tiles > 0 && <TilesSkeleton count={tiles} />}
      {chips > 0 && (
        <div className="flex gap-2">
          {Array.from({ length: chips }, (_, i) => (
            <span key={i} className="h-9 w-24 animate-pulse rounded-[10px] bg-surface-2" aria-hidden />
          ))}
        </div>
      )}
      <div className="h-[66px] animate-pulse rounded-[14px] border border-line bg-surface" aria-hidden />
      <TableSkeleton />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** A record's tab on its way (the record's header stays). */
export function TabSkeleton({ side = true }: { side?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className={cn("grid items-start gap-4", side && "lg:grid-cols-[minmax(0,1fr)_320px]")}>
      <TableSkeleton rows={5} />
      {side && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <Bar className="w-28" />
          <Bar className="w-full" />
          <Bar className="w-3/4" />
          <Bar className="w-1/2" />
        </div>
      )}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
