import { CHANNEL_LABEL, LOST_REASON_LABEL } from "@kebo/shared";
import { apiFetch } from "@/lib/api";
import { excelRefusal } from "@/app/sheets/guard";
import type { ReportView } from "@/lib/types-deals";

/** The report's tables as one CSV file (the API checks the person may see reports). */
const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote when needed; neutralise spreadsheet formulas. Only a plain number may start with "-".
  const safe = typeof v !== "number" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** Byte order mark, so Excel opens the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const row = (...cells: (string | number | null | undefined)[]) => cells.map(cell).join(",");

function toCsv(r: ReportView) {
  const p = r.profit;
  const lines = [
    row("Report", `${r.range.from} to ${r.range.to}`, `Amounts in ${r.currency}`),
    "",
    row("Funnel"),
    row("Received", "Quoted", "Won", "Lost", "Win rate %", "Won value"),
    row(r.funnel.received, r.funnel.quoted, r.funnel.won, r.funnel.lost, r.funnel.winRatePercent, r.wonValue),
    "",
    row("Lost reasons"),
    row("Reason", "Inquiries"),
    ...r.lostReasons.map((x) => row(LOST_REASON_LABEL[x.reason], x.count)),
    "",
    row("By channel"),
    row("Channel", "Inquiries"),
    ...r.byChannel.map((x) => row(CHANNEL_LABEL[x.key] ?? x.key, x.count)),
    "",
    row("By category"),
    row("Category", "Inquiries"),
    ...r.byCategory.map((x) => row(x.key, x.count)),
    "",
    row("Win rate by person"),
    row("Person", "Won", "Lost", "Win rate %"),
    ...r.people.map((x) => row(x.person, x.won, x.lost, x.winRatePercent)),
    "",
    row("Estimated profit (lines without a cost are left out of profit and margin)"),
    row("Group", "Name", "Orders", "Sales", "Cost", "Profit", "Margin %", "Costed %"),
    row("Total", "", p.total.orders, p.total.revenue, p.total.cost, p.total.profit, p.total.marginPercent, p.total.coveragePercent),
    ...(
      [
        ["Customer", p.byCustomer],
        ["Category", p.byCategory],
        ["Person", p.byPerson],
      ] as const
    ).flatMap(([group, rows]) => rows.map((x) => row(group, x.key, x.orders, x.revenue, x.cost, x.profit, x.marginPercent, x.coveragePercent))),
    "",
    row("Last 12 months"),
    row("Month", "Received", "Won"),
    ...r.trend.map((x) => row(x.month, x.received, x.won)),
  ];
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

export async function GET(req: Request) {
  // A spreadsheet file: Excel is a plan feature.
  const refused = await excelRefusal();
  if (refused) return refused;
  const sp = new URL(req.url).searchParams;
  const query: Record<string, string | undefined> = {};
  for (const k of ["from", "to", "staff"]) {
    const v = sp.get(k);
    if (v) query[k] = v;
  }
  const res = await apiFetch("/reports", { query });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return new Response(body.error ?? "Could not make the report.", { status: res.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const r = (await res.json()) as ReportView;
  return new Response(toCsv(r), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kebo-report-${r.range.from}-to-${r.range.to}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
