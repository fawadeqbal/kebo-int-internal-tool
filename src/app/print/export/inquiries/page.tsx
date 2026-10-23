import { requireUser } from "@/lib/auth/session";
import { listQueriesForExport } from "@/modules/queries/repository";
import { parseQueryFilters } from "@/modules/queries/filters";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { OPEN_STATUSES } from "@/modules/queries/workflow";
import { describeFilters, inquiryActiveFilters } from "@/lib/list-filters";
import { PRIORITY_LABEL, QUERY_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { Cell, ReportSheet, ReportTable } from "@/components/documents/report-sheet";
import { generatedNow, limitNote, PDF_ROW_LIMIT, plural } from "../shared";

export const metadata = { title: "Inquiries report" };

const STATUS_TAB: Record<string, string> = { open: "Open (pending + processing)", overdue: "Overdue", all: "All statuses" };

export default async function InquiriesExport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseQueryFilters({ ...sp, status: sp.status ?? "open" });
  const status = sp.status === "all" ? "all" : filters.raw.status;
  const [rows, people, settings] = await Promise.all([listQueriesForExport(user, filters), listActiveUsers(), getSettings()]);
  const shown = rows.slice(0, PDF_ROW_LIMIT);
  const today = todayISO();
  const statusLabel = status ? (STATUS_TAB[status] ?? QUERY_STATUS_LABEL[status as keyof typeof QUERY_STATUS_LABEL]) : "All statuses";
  const isOverdue = (r: (typeof rows)[number]) => OPEN_STATUSES.includes(r.status) && !!r.requiredBy && r.requiredBy < today;

  return (
    <ReportSheet
      landscape
      settings={settings}
      title="Inquiries"
      kind="RFQ register"
      filters={`Status: ${statusLabel}  ·  ${describeFilters(inquiryActiveFilters(filters.raw, people, user.id), filters.raw.q)}`}
      generatedAt={generatedNow()}
      generatedBy={user.name}
      records={plural(rows.length, "inquiry", "inquiries")}
      note={limitNote(shown.length, rows.length)}
      kpis={[
        { label: "Inquiries", value: rows.length },
        { label: "Open", value: rows.filter((r) => OPEN_STATUSES.includes(r.status)).length, hint: `${rows.filter((r) => r.status === "pending").length} not started` },
        { label: "Overdue", value: rows.filter(isOverdue).length, tone: rows.some(isOverdue) ? "bad" : undefined },
        { label: "Completed", value: rows.filter((r) => r.status === "completed").length, tone: "ok" },
        { label: "Not assigned", value: rows.filter((r) => OPEN_STATUSES.includes(r.status) && !r.assigneeName).length },
      ]}
    >
      <ReportTable
        empty="No inquiries match these filters."
        columns={[
          { header: "RFQ no.", className: "w-[25mm]" },
          { header: "Received", className: "w-[23mm] whitespace-nowrap" },
          { header: "Customer", className: "w-[45mm]" },
          { header: "Requirement" },
          { header: "Via", className: "w-[25mm] whitespace-nowrap" },
          { header: "Priority", className: "w-[15mm]" },
          { header: "Status", className: "w-[22mm]" },
          { header: "Handled by", className: "w-[26mm]" },
          { header: "Needed by", align: "right", className: "w-[23mm]" },
        ]}
        rows={shown.map((r) => [
          <span key="ref" className="font-mono text-[10px] whitespace-nowrap text-stone-900">{r.refNo}</span>,
          <span key="d" className="whitespace-nowrap">{formatDate(r.createdAt)}</span>,
          <Cell key="c" main={r.contactPerson} sub={r.companyName !== r.contactPerson ? r.companyName : r.customerPhone} />,
          <Cell key="t" main={r.title} sub={[r.category, r.quantity > 1 ? `Qty ${r.quantity}` : null].filter(Boolean).join(" · ")} />,
          SOURCE_LABEL[r.source],
          PRIORITY_LABEL[r.priority],
          <span key="s" className={r.status === "completed" ? "font-medium text-emerald-700" : r.status === "pending" ? "font-medium text-amber-700" : undefined}>
            {QUERY_STATUS_LABEL[r.status]}
          </span>,
          r.assigneeName ?? <span key="a" className="text-amber-700">Not assigned</span>,
          r.requiredBy ? <span key="n" className={isOverdue(r) ? "font-semibold text-red-700" : undefined}>{formatDate(r.requiredBy)}</span> : "—",
        ])}
      />
    </ReportSheet>
  );
}
