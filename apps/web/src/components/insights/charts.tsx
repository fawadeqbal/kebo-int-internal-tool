"use client";

import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const compact = (v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const full = (v: number, c: string) => `${c} ${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const axis = { tickLine: false, tick: { fill: "var(--muted)", fontSize: 11 } } as const;
const tooltip = {
  cursor: { fill: "var(--surface-2)" },
  contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12, color: "var(--text)", boxShadow: "0 8px 24px rgb(0 0 0 / 0.08)" },
  labelStyle: { color: "var(--text)", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "var(--text-2)", padding: 0 },
} as const;
const legend = {
  iconType: "circle" as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 12, paddingTop: 8 },
  formatter: (value: string) => <span style={{ color: "var(--text-2)" }}>{value}</span>,
};

/** A small trend line for a KPI card (no axes). */
export function Sparkline({ values, tone = "primary" }: { values: number[]; tone?: "primary" | "ok" | "bad" }) {
  const data = values.map((v, i) => ({ i, v }));
  const colour = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--chart-1)";
  const id = `spark-${tone}`;
  if (values.length < 2) return null;
  return (
    <div className="h-10 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.25} />
              <stop offset="100%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={colour} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Sales by month as bars, profit as a line, last year faintly behind, and the target as a dashed line. */
export function RevenueChart({
  data,
  currency,
  showNet,
  height = 300,
}: {
  data: { month: string; revenue: string; grossProfit: string; netProfit: string | null; lastYearRevenue: string; target: string | null }[];
  currency: string;
  showNet: boolean;
  height?: number;
}) {
  const rows = data.map((d) => ({
    label: monthLabel(d.month),
    month: d.month,
    revenue: Number(d.revenue),
    gross: Number(d.grossProfit),
    net: d.netProfit === null ? null : Number(d.netProfit),
    lastYear: Number(d.lastYearRevenue),
    target: d.target === null ? null : Number(d.target),
  }));
  const anyLastYear = rows.some((r) => r.lastYear > 0);
  const anyTarget = rows.some((r) => r.target !== null);
  return (
    <div
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={`Sales by month: ${rows.map((r) => `${r.label} ${full(r.revenue, currency)}`).join("; ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={-18} barCategoryGap="28%">
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.95} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.65} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} axisLine={{ stroke: "var(--line-strong)" }} interval="preserveStartEnd" minTickGap={6} />
          <YAxis {...axis} axisLine={false} width={48} tickFormatter={compact} />
          <Tooltip {...tooltip} formatter={(v, name) => [v === null || v === undefined ? "—" : full(Number(v), currency), String(name)]} />
          <Legend {...legend} />
          {anyLastYear && <Bar dataKey="lastYear" name="Sales a year before" fill="var(--surface-3)" radius={[6, 6, 0, 0]} maxBarSize={18} />}
          <Bar dataKey="revenue" name="Sales" fill="url(#rev)" radius={[6, 6, 0, 0]} maxBarSize={18} />
          <Line type="monotone" dataKey="gross" name="Gross profit" stroke="var(--chart-2)" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
          {showNet && <Line type="monotone" dataKey="net" name="Profit after expenses" stroke="var(--chart-3)" strokeWidth={2} dot={false} strokeDasharray="0" />}
          {anyTarget && <Line type="stepAfter" dataKey="target" name="Target" stroke="var(--chart-4)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Money in and out each month, and what was left. */
export function CashFlowChart({ data, currency }: { data: { month: string; cashIn: string; cashOut: string | null }[]; currency: string }) {
  const rows = data.map((d) => {
    const cin = Number(d.cashIn);
    const out = d.cashOut === null ? 0 : Number(d.cashOut);
    return { label: monthLabel(d.month), in: cin, out: -out, net: cin - out };
  });
  return (
    <div className="h-64 w-full" role="img" aria-label={`Money in and out by month: ${rows.map((r) => `${r.label} in ${full(r.in, currency)}, out ${full(-r.out, currency)}`).join("; ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} axisLine={{ stroke: "var(--line-strong)" }} interval="preserveStartEnd" minTickGap={6} />
          <YAxis {...axis} axisLine={false} width={48} tickFormatter={compact} />
          <Tooltip {...tooltip} formatter={(v, name) => [full(Math.abs(Number(v)), currency), String(name)]} />
          <Legend {...legend} />
          <Bar dataKey="in" name="Money in" stackId="cash" fill="var(--ok)" radius={[5, 5, 0, 0]} maxBarSize={20} />
          <Bar dataKey="out" name="Money out" stackId="cash" fill="var(--bad)" fillOpacity={0.75} radius={[5, 5, 0, 0]} maxBarSize={20} />
          <Line type="monotone" dataKey="net" name="Left over" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 2.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--muted)"];

/** A ring chart with the total in the middle and a legend beside it. */
export function Donut({ data, centre, centreLabel }: { data: { label: string; value: number }[]; centre: string; centreLabel: string }) {
  const total = data.reduce((t, d) => t + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative size-40 shrink-0" role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join("; ")}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular">{centre}</span>
          <span className="text-xs text-muted">{centreLabel}</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 text-text-2 tabular">
              {d.value} <span className="text-xs text-muted">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
