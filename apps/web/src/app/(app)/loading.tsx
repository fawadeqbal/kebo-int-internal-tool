/** Board "Loading": grey bars where the rows will be, while a page's data comes. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="h-10 w-72 max-w-full animate-pulse rounded-[10px] bg-surface-2" />
      <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-4">
            <div className="h-3.5 w-[90px] rounded-full bg-surface-2" />
            <div className="h-3.5 w-2/5 rounded-full bg-surface-2" />
            <div className="h-3.5 w-20 rounded-full bg-surface-2" />
            <div className="h-3.5 w-[60px] rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
