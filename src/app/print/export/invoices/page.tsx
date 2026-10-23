import { requirePagePermission } from "@/lib/auth/session";
import { listInvoices } from "@/modules/invoices/repository";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { describeFilters, parseInvoiceParams } from "@/lib/list-filters";
import { INVOICE_STATUS_LABEL } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { Cell, ReportSheet, ReportTable } from "@/components/documents/report-sheet";
import { generatedNow, limitNote, PDF_ROW_LIMIT, plural } from "../shared";

export const metadata = { title: "Invoices report" };

export default async function InvoicesExport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePagePermission("invoices.manage");
  const { filters, active } = parseInvoiceParams(await searchParams);
  const [data, settings] = await Promise.all([listInvoices(user, { ...filters, pageSize: PDF_ROW_LIMIT }), getSettings()]);
  const c = settings.currency;
  const today = todayISO();
  const live = data.rows.filter((r) => r.status !== "cancelled");
  const total = live.reduce((n, r) => n + toCents(r.total), 0);
  const paid = live.reduce((n, r) => n + toCents(r.amountPaid), 0);
  const overdue = live.filter((r) => invoiceDisplayStatus(r, today) === "overdue").reduce((n, r) => n + toCents(r.total) - toCents(r.amountPaid), 0);
  return (
    <ReportSheet
      landscape
      settings={settings}
      title="Invoices"
      kind="Invoice register"
      filters={describeFilters(active, filters.q)}
      generatedAt={generatedNow()}
      generatedBy={user.name}
      records={plural(data.total, "invoice")}
      note={limitNote(data.rows.length, data.total)}
      kpis={[
        { label: "Invoiced", value: formatCents(total, c), hint: `${live.length} invoices, cancelled excluded` },
        { label: "Received", value: formatCents(paid, c), tone: "ok" },
        { label: "Outstanding", value: formatCents(total - paid, c) },
        { label: "Overdue", value: formatCents(overdue, c), tone: overdue > 0 ? "bad" : undefined },
      ]}
    >
      <ReportTable
        empty="No invoices match these filters."
        columns={[
          { header: "Invoice", className: "w-[30mm]" },
          { header: "Issued", className: "w-[23mm] whitespace-nowrap" },
          { header: "Customer" },
          { header: "Status", className: "w-[24mm]" },
          { header: "Payment due", className: "w-[24mm] whitespace-nowrap" },
          { header: `Total (${c})`, align: "right", className: "w-[30mm]" },
          { header: "Received", align: "right", className: "w-[30mm]" },
          { header: "Balance", align: "right", className: "w-[30mm]" },
        ]}
        rows={data.rows.map((r) => {
          const display = invoiceDisplayStatus(r, today);
          const balance = r.status === "cancelled" ? 0 : toCents(r.total) - toCents(r.amountPaid);
          return [
            <Cell key="n" mono main={r.invoiceNo} sub={r.queryRef} />,
            formatDate(r.issueDate),
            r.companyName,
            <span key="s" className={display === "overdue" ? "font-semibold text-red-700" : display === "paid" ? "font-medium text-emerald-700" : undefined}>
              {INVOICE_STATUS_LABEL[display]}
            </span>,
            formatDate(r.dueDate),
            <span key="t" className={r.status === "cancelled" ? "text-stone-400 line-through" : undefined}>{formatMoney(r.total, c)}</span>,
            formatMoney(r.amountPaid, c),
            balance > 0 ? <span key="b" className="font-medium text-stone-900">{formatCents(balance, c)}</span> : "—",
          ];
        })}
        footer={["Total", "", "", "", "", formatCents(total, c), formatCents(paid, c), formatCents(total - paid, c)]}
      />
    </ReportSheet>
  );
}
