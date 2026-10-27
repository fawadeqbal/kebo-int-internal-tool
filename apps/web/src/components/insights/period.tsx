import { buildHref, buttonClass, Input, Segmented } from "@kebo/ui";
import { addDays } from "@kebo/utils";
import { date } from "@/lib/format";

/** The quick periods: this month, last month, this quarter, this year, the last 12 months. */
export function presets(today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastEnd = addDays(monthStart, -1);
  const m = Number(today.slice(5, 7));
  const qStart = `${today.slice(0, 4)}-${String(m - ((m - 1) % 3)).padStart(2, "0")}-01`;
  const yearAgo = new Date(`${monthStart}T00:00:00Z`);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11);
  return [
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "last", label: "Last month", from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd },
    { key: "quarter", label: "This quarter", from: qStart, to: today },
    { key: "year", label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
    { key: "12m", label: "Last 12 months", from: yearAgo.toISOString().slice(0, 10), to: today },
  ];
}

/** The period for every number on the page, and what it is compared with. */
export function PeriodPicker({
  path,
  keep,
  range,
  previous,
  today,
}: {
  path: string;
  keep: Record<string, string | undefined>;
  range: { from: string; to: string };
  previous: { from: string; to: string };
  today: string;
}) {
  const list = presets(today);
  const at = list.findIndex((p) => p.from === range.from && p.to === range.to);
  const custom = at < 0;
  return (
    <div className="no-print flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-1.5">
          <Segmented
            label="Period"
            options={list.map((p, n) => ({
              href: buildHref(path, keep, { from: p.key === "month" ? undefined : p.from, to: p.key === "month" ? undefined : p.to }),
              label: p.label,
              active: n === at,
            }))}
          />
        
        <p className="px-1 text-xs text-muted">
          {custom ? "Your dates: " : ""}
          {date(range.from)} – {date(range.to)} · compared with {date(previous.from)} – {date(previous.to)}
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-2" action={path}>
        {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <label className="text-xs text-muted">
          From
          <Input name="from" type="date" defaultValue={range.from} max={today} className="mt-1 h-8 w-38" />
        </label>
        <label className="text-xs text-muted">
          To
          <Input name="to" type="date" defaultValue={range.to} max={today} className="mt-1 h-8 w-38" />
        </label>
        <button className={buttonClass("secondary", "sm")}>Show</button>
      </form>
    </div>
  );
}
