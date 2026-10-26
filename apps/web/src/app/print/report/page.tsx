import type { ReactNode } from "react";
import { CHANNEL_LABEL, LOST_REASON_LABEL } from "@kebo/shared";
import { formatDuration } from "@kebo/utils";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { PersonWithRole, ProfitRow, ReportView } from "@/lib/types-deals";
import type { CompanySnapshot } from "@/lib/types-orders";
import { Letterhead, LinesTable, Sheet } from "@/components/print/doc";
import { PrintToolbar } from "@/components/print/toolbar";

export const metadata = { title: "Sales report" };

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 mb-1 text-[8pt] font-semibold tracking-[0.08em] text-kebo-deep uppercase break-after-avoid">{children}</h2>;
}

function Tiles({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2 break-inside-avoid">
      {items.map((t) => (
        <div key={t.label} className="rounded-md border border-kebo-line px-3 py-2">
          <p className="text-[7.5pt] text-[#64748b] uppercase">{t.label}</p>
          <p className="text-[13pt] font-bold tabular">{t.value}</p>
          {t.hint && <p className="text-[7.5pt] text-[#64748b]">{t.hint}</p>}
        </div>
      ))}
    </div>
  );
}

function Counts({ title, rows, empty }: { title: string; rows: { label: string; count: number }[]; empty: string }) {
  const total = rows.reduce((t, r) => t + r.count, 0);
  return (
    <div className="min-w-0 break-inside-avoid">
      <H2>{title}</H2>
      {rows.length === 0 ? (
        <p className="text-[#64748b]">{empty}</p>
      ) : (
        <LinesTable
          rows={rows}
          columns={[
            { label: "", render: (r) => r.label },
            { label: "Count", className: "w-14 text-right tabular", render: (r) => r.count },
            { label: "Share", className: "w-14 text-right tabular", render: (r) => `${total ? Math.round((r.count / total) * 100) : 0}%` },
          ]}
        />
      )}
    </div>
  );
}

function Profit({ title, rows, currency }: { title: string; rows: (ProfitRow & { key: string })[]; currency: string }) {
  return (
    <div className="break-inside-avoid">
      <H2>{title}</H2>
      {rows.length === 0 ? (
        <p className="text-[#64748b]">No orders in this period.</p>
      ) : (
        <LinesTable
          rows={rows}
          columns={[
            { label: title.replace(/^By /, ""), render: (r) => r.key },
            { label: "Orders", className: "w-14 text-right tabular", render: (r) => r.orders },
            { label: "Sales", className: "w-28 text-right tabular whitespace-nowrap", render: (r) => money(r.revenue, currency) },
            { label: "Profit", className: "w-28 text-right tabular whitespace-nowrap font-medium", render: (r) => money(r.profit, currency) },
            { label: "Margin", className: "w-16 text-right tabular", render: (r) => pct(r.marginPercent) },
          ]}
        />
      )}
    </div>
  );
}

/**
 * The Reports page on paper (and as a PDF: /pdf/report/summary?from&to): the
 * same figures from GET /reports for the same period and person.
 */
export default async function ReportPrint({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const from = isDay(sp.from) ? sp.from : undefined;
  const to = isDay(sp.to) ? sp.to : undefined;
  const staff = isId(sp.staff) ? sp.staff : undefined;
  const [r, people, settings] = await Promise.all([
    api.get<ReportView>("/reports", { from, to, staff }),
    api.get<PersonWithRole[]>("/users/people"),
    api.get<{ company: CompanySnapshot }>("/settings"),
  ]);
  const person = people.find((p) => p.id === staff);
  const f = r.funnel;
  const t = r.profit.total;
  const query = new URLSearchParams({ from: r.range.from, to: r.range.to, ...(staff ? { staff } : {}) }).toString();

  return (
    <>
      <PrintToolbar title={`Sales report ${date(r.range.from)} – ${date(r.range.to)}`} backHref={`/reports?${query}`} pdfHref={`/pdf/report/summary?${query}`} />
      <Sheet>
        <Letterhead
          company={settings.company}
          title="Sales report"
          number={`${date(r.range.from)} – ${date(r.range.to)}`}
          meta={[
            { label: "Deals of", value: person ? person.name : "Everyone" },
            { label: "Amounts in", value: `${r.currency}, at today's rates` },
          ]}
        />

        <H2>Deals in the period</H2>
        <Tiles
          items={[
            { label: "Received", value: f.received, hint: "New inquiries" },
            { label: "Quoted", value: f.quoted, hint: f.received ? `${Math.round((f.quoted / f.received) * 100)}% of those received` : undefined },
            { label: "Won", value: f.won, hint: r.turnaroundMs.won ? `Took ${formatDuration(r.turnaroundMs.won)} on average` : undefined },
            { label: "Lost", value: f.lost, hint: r.turnaroundMs.lost ? `Took ${formatDuration(r.turnaroundMs.lost)} on average` : undefined },
            { label: "Win rate", value: pct(f.winRatePercent), hint: "Won ÷ (won + lost)" },
            { label: "Won value", value: money(r.wonValue, r.currency), hint: "Orders made in the period" },
          ]}
        />

        <H2>Estimated profit</H2>
        <p className="text-[8pt] text-[#64748b]">
          On {t.orders} order{t.orders === 1 ? "" : "s"} made in the period, from the costs recorded on their lines (sales after discount).
          {t.coveragePercent !== null && t.coveragePercent < 100 ? ` Only ${t.coveragePercent}% of sales have a cost; lines without one are left out of profit and margin.` : ""}
        </p>
        <Tiles
          items={[
            { label: "Sales", value: money(t.revenue, r.currency) },
            { label: "Profit", value: money(t.profit, r.currency), hint: `Cost ${money(t.cost, r.currency)}` },
            { label: "Margin", value: pct(t.marginPercent) },
          ]}
        />
        <Profit title="By customer" rows={r.profit.byCustomer} currency={r.currency} />
        <Profit title="By category" rows={r.profit.byCategory} currency={r.currency} />
        <Profit title="By person" rows={r.profit.byPerson} currency={r.currency} />

        <div className="grid grid-cols-2 gap-x-6">
          <Counts title="Why deals were lost" rows={r.lostReasons.map((x) => ({ label: LOST_REASON_LABEL[x.reason], count: x.count }))} empty="No deals lost in this period." />
          <Counts title="By channel" rows={r.byChannel.map((x) => ({ label: CHANNEL_LABEL[x.key] ?? x.key, count: x.count }))} empty="No inquiries in this period." />
          <Counts title="By category" rows={r.byCategory.map((x) => ({ label: x.key, count: x.count }))} empty="No inquiries in this period." />
          <div className="min-w-0 break-inside-avoid">
            <H2>Win rate by person</H2>
            {r.people.length === 0 ? (
              <p className="text-[#64748b]">No deals closed in this period.</p>
            ) : (
              <LinesTable
                rows={r.people}
                columns={[
                  { label: "Person", render: (p) => p.person },
                  { label: "Won", className: "w-12 text-right tabular", render: (p) => p.won },
                  { label: "Lost", className: "w-12 text-right tabular", render: (p) => p.lost },
                  { label: "Rate", className: "w-14 text-right tabular font-medium", render: (p) => `${p.winRatePercent}%` },
                ]}
              />
            )}
          </div>
        </div>

        <div className="break-inside-avoid">
          <H2>Last 12 months</H2>
          <LinesTable
            rows={r.trend}
            columns={[
              { label: "Month", render: (m) => monthLabel(m.month) },
              { label: "Received", className: "w-24 text-right tabular", render: (m) => m.received },
              { label: "Won", className: "w-24 text-right tabular", render: (m) => m.won },
            ]}
          />
        </div>
      </Sheet>
    </>
  );
}
