import { requireUser } from "@/lib/auth/session";
import { listQuotations } from "@/modules/quotations/repository";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { describeFilters, parseQuotationParams } from "@/lib/list-filters";
import { QUOTATION_STATUS_LABEL } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { Cell, ReportSheet, ReportTable } from "@/components/documents/report-sheet";
import { generatedNow, limitNote, PDF_ROW_LIMIT, plural } from "../shared";

export const metadata = { title: "Quotations report" };

export default async function QuotationsExport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const people = await listActiveUsers();
  const { filters, active } = parseQuotationParams(await searchParams, people);
  const [data, settings] = await Promise.all([listQuotations(user, { ...filters, pageSize: PDF_ROW_LIMIT }), getSettings()]);
  const c = settings.currency;
  const today = todayISO();
  const sum = (rows: typeof data.rows) => rows.reduce((n, r) => n + toCents(r.total), 0);
  const accepted = data.rows.filter((r) => r.status === "accepted");
  const waiting = data.rows.filter((r) => r.status === "sent");
  return (
    <ReportSheet
      landscape
      settings={settings}
      title="Quotations"
      kind="Quotation register"
      filters={describeFilters(active, filters.q)}
      generatedAt={generatedNow()}
      generatedBy={user.name}
      records={plural(data.total, "quotation")}
      note={limitNote(data.rows.length, data.total)}
      kpis={[
        { label: "Quotations", value: data.total },
        { label: "Total value", value: formatCents(sum(data.rows), c) },
        { label: "Accepted", value: formatCents(sum(accepted), c), hint: `${accepted.length} quotations`, tone: "ok" },
        { label: "Waiting for reply", value: formatCents(sum(waiting), c), hint: `${waiting.length} sent` },
      ]}
    >
      <ReportTable
        empty="No quotations match these filters."
        columns={[
          { header: "Quotation", className: "w-[30mm]" },
          { header: "Date", className: "w-[23mm] whitespace-nowrap" },
          { header: "Customer", className: "w-[48mm]" },
          { header: "Inquiry" },
          { header: "Status", className: "w-[20mm]" },
          { header: "Prepared by", className: "w-[26mm]" },
          { header: "Valid until", align: "right", className: "w-[23mm]" },
          { header: `Total (${c})`, align: "right", className: "w-[30mm]" },
        ]}
        rows={data.rows.map((r) => [
          <Cell key="n" mono main={r.refNo} sub={`version ${r.version}`} />,
          formatDate(r.submittedAt ?? r.createdAt),
          r.companyName,
          <Cell key="i" main={r.queryTitle} sub={r.queryRef} />,
          QUOTATION_STATUS_LABEL[r.status],
          r.preparedBy ?? "—",
          <span key="v" className={r.status === "sent" && r.dueDate < today ? "font-semibold text-red-700" : undefined}>{formatDate(r.dueDate)}</span>,
          formatMoney(r.total, c),
        ])}
        footer={["Total", "", "", "", "", "", "", formatCents(sum(data.rows), c)]}
      />
    </ReportSheet>
  );
}
