"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Deals received and won per month over 12 months (one axis, two series in the theme's chart colours). */
export function ReportTrendChart({ data }: { data: { month: string; received: number; won: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) }));
  return (
    <div className="h-64 w-full" role="img" aria-label={`Deals received and won per month: ${rows.map((r) => `${r.label} ${r.received} received, ${r.won} won`).join("; ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tick={{ fill: "var(--muted)", fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} width={40} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
            labelStyle={{ color: "var(--text)", fontWeight: 600 }}
            itemStyle={{ color: "var(--text-2)" }}
          />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(value: string) => <span style={{ color: "var(--text-2)" }}>{value}</span>} />
          <Bar dataKey="received" name="Received" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="won" name="Won" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
