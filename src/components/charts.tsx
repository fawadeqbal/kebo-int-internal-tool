"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/* Theme chart slots 1 and 2 (validated pair, both themes). */
const SERIES = { received: "var(--chart-1)", completed: "var(--chart-2)" };
const GRID = "var(--line)";
const AXIS = "var(--muted)";

interface TrendPoint {
  label: string;
  received: number;
  completed: number;
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-text">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-text">
          <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[p.dataKey as keyof typeof SERIES] }} aria-hidden />
          <span className="text-muted">{p.dataKey === "received" ? "Received" : "Completed"}</span>
          <span className="ml-auto font-medium tabular">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Queries received vs completed per month. */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const total = data.reduce((s, d) => s + d.received + d.completed, 0);
  return (
    <figure>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.received }} /> Received
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.completed }} /> Completed
        </span>
      </div>
      <div className="h-64" role="img" aria-label={`Queries received and completed per month. ${data.map((d) => `${d.label}: ${d.received} received, ${d.completed} completed`).join("; ")}`}>
        {total === 0 ? (
          <p className="grid h-full place-items-center text-sm text-muted">No activity in this period yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: AXIS, fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 11 }} width={44} />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="received" fill={SERIES.received} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="completed" fill={SERIES.completed} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}

interface ProfitPoint {
  label: string;
  revenue: number;
  profit: number;
  margin: number | null;
}

const PROFIT_SERIES = { revenue: "var(--chart-1)", profit: "var(--chart-2)" };
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function ProfitTooltip({ active, payload, label, currency }: { active?: boolean; payload?: { dataKey: string; value: number; payload: ProfitPoint }[]; label?: string; currency: string }) {
  if (!active || !payload?.length) return null;
  const money = (n: number) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const margin = payload[0].payload.margin;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-text">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-text">
          <span className="h-2 w-2 rounded-sm" style={{ background: PROFIT_SERIES[p.dataKey as keyof typeof PROFIT_SERIES] }} aria-hidden />
          <span className="text-muted">{p.dataKey === "revenue" ? "Invoiced" : "Profit"}</span>
          <span className="ml-auto font-medium tabular">{money(p.value)}</span>
        </p>
      ))}
      {margin !== null && <p className="mt-1 text-muted">Margin {margin}%</p>}
    </div>
  );
}

/** Invoiced (after discounts, before tax) vs gross profit per month. */
export function ProfitChart({ data, currency }: { data: ProfitPoint[]; currency: string }) {
  const any = data.some((d) => d.revenue !== 0);
  return (
    <figure>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PROFIT_SERIES.revenue }} /> Invoiced
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PROFIT_SERIES.profit }} /> Gross profit
        </span>
      </div>
      <div
        className="h-64"
        role="img"
        aria-label={`Invoiced and gross profit per month in ${currency}. ${data.map((d) => `${d.label}: ${Math.round(d.revenue)} invoiced, ${Math.round(d.profit)} profit`).join("; ")}`}
      >
        {!any ? (
          <p className="grid h-full place-items-center text-sm text-muted">No invoices in the last 12 months yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: AXIS, fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tickFormatter={(v: number) => compact.format(v)} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 11 }} width={48} />
              <Tooltip content={<ProfitTooltip currency={currency} />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="revenue" fill={PROFIT_SERIES.revenue} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="profit" fill={PROFIT_SERIES.profit} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
