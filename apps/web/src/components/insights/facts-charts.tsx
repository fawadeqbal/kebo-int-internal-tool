"use client";

import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/*
 * Insights charts (dataviz method): one axis per chart, thin marks (bars ≤ 24px, 4px rounded at the data
 * end; lines 2px; dots with a surface ring), solid hairline grid, a legend for two or more series, a hover
 * and keyboard tooltip that leads with the values, text in text colours. Every chart sits in a ChartCard,
 * whose "Table" shows the same figures.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;
const monthLong = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const compact = (v: number) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v).replace("K", "k");
const full = (v: number, c: string) => `${c} ${Math.round(v).toLocaleString("en-US")}`;
const axisTick = { fill: "var(--muted)", fontSize: 11 };
const grid = <CartesianGrid vertical={false} stroke="var(--line)" />;

type Key = { name: string; color: string; kind: "bar" | "line" };

/** The legend: a swatch that looks like the mark (a square for bars, a short line for lines), the name in text colour. */
export function Legend({ keys }: { keys: Key[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
      {keys.map((k) => (
        <li key={k.name} className="flex items-center gap-1.5">
          {k.kind === "bar" ? (
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: k.color }} />
          ) : (
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: k.color }} />
          )}
          {k.name}
        </li>
      ))}
    </ul>
  );
}

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { name?: string | number; value?: unknown; color?: string; dataKey?: unknown; payload?: Record<string, unknown> }[];
}

/** The tooltip: the month, then each series' value (strong) and its name, keyed by a short line of its colour. */
function tip(currency: string, opts: { abs?: boolean; extra?: (row: Record<string, unknown>) => string | null } = {}) {
  return function Tip({ active, payload }: TipProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0]!.payload ?? {};
    const extra = opts.extra?.(row);
    return (
      <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
        <p className="mb-1.5 font-medium text-text-2">{monthLong(String(row.month))}</p>
        <ul className="flex flex-col gap-1">
          {payload.map((p) => (
            <li key={String(p.dataKey)} className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="font-semibold text-text tabular">
                {full(opts.abs ? Math.abs(Number(p.value)) : Number(p.value), currency)}
              </span>
              <span className="text-muted">{p.name}</span>
            </li>
          ))}
        </ul>
        {extra && <p className="mt-1.5 text-muted">{extra}</p>}
      </div>
    );
  };
}

const dot = (color: string) => ({ r: 4, fill: color, stroke: "var(--surface)", strokeWidth: 2 });

/** Sales by month as bars and gross profit as a line on the same axis; a month opens its orders. */
export function SalesProfitChart({
  rows,
  currency,
  monthHref,
  names = ["Sales", "Gross profit"],
}: {
  rows: { month: string; sales: number; profit: number; orders: number }[];
  currency: string;
  /** What the bars and the line are called (Reports: "Sold" and "Profit"). */
  names?: [string, string];
  /** Where a click on a month goes (its orders). */
  monthHref?: Record<string, string>;
}) {
  const router = useRouter();
  const data = rows.map((r) => ({ ...r, label: monthShort(r.month) }));
  const last = data.length - 1;
  return (
    <div>
      <Legend
        keys={[
          { name: names[0], color: "var(--chart-1)", kind: "bar" },
          { name: names[1], color: "var(--chart-2)", kind: "line" },
        ]}
      />
      <div className="h-56 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 18, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="22%"
            onClick={(e) => {
              const m = e?.activeIndex !== undefined && e.activeIndex !== null ? data[Number(e.activeIndex)]?.month : undefined;
              if (m && monthHref?.[m]) router.push(monthHref[m], { scroll: false });
            }}
            style={monthHref ? { cursor: "pointer" } : undefined}
          >
            {grid}
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: "var(--line-strong)" }}
              interval={0}
              minTickGap={0}
            />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={tip(currency, {
                extra: (r) => `${r.orders} order${r.orders === 1 ? "" : "s"}${monthHref ? " · click for them" : ""}`,
              })}
            />
            <Bar dataKey="sales" name={names[0]} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
              <LabelList
                dataKey="sales"
                content={(p) => {
                  const { index, x, y, width, value } = p as { index?: number; x?: number; y?: number; width?: number; value?: number };
                  if (index !== last || !value) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) / 2}
                      y={Number(y) - 6}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--text)"
                    >
                      {compact(Number(value))}
                    </text>
                  );
                }}
              />
            </Bar>
            <Line
              dataKey="profit"
              name={names[1]}
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={dot("var(--chart-2)")}
              activeDot={{ ...dot("var(--chart-2)"), r: 5 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

