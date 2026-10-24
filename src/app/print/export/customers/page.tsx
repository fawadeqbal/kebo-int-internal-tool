import { requirePagePermission } from "@/lib/auth/session";
import { listCustomers } from "@/modules/customers/repository";
import { getSettings } from "@/modules/settings/service";
import { describeFilters, parseCustomerParams } from "@/lib/list-filters";
import { formatDate } from "@/lib/utils/dates";
import { Cell, ReportSheet, ReportTable } from "@/components/documents/report-sheet";
import { generatedNow, limitNote, PDF_ROW_LIMIT, plural } from "../shared";

export const metadata = { title: "Customers report" };

export default async function CustomersExport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePagePermission("customers.export");
  const { filters, active } = parseCustomerParams(await searchParams);
  const [data, settings] = await Promise.all([listCustomers(user, { ...filters, pageSize: PDF_ROW_LIMIT }), getSettings()]);
  const inquiries = data.rows.reduce((n, c) => n + c.queryCount, 0);
  return (
    <ReportSheet
      settings={settings}
      title="Customers"
      kind="Customer list"
      filters={describeFilters(active, filters.q)}
      generatedAt={generatedNow()}
      generatedBy={user.name}
      records={plural(data.total, "customer")}
      note={limitNote(data.rows.length, data.total)}
      kpis={[
        { label: "Customers", value: data.total },
        { label: "Inquiries from them", value: inquiries },
        { label: "With a company name", value: data.rows.filter((c) => c.companyName).length },
      ]}
    >
      <ReportTable
        empty="No customers match these filters."
        columns={[{ header: "Customer" }, { header: "Phone / WhatsApp", className: "w-[34mm]" }, { header: "Email", className: "w-[48mm]" }, { header: "Inquiries", align: "right", className: "w-[16mm]" }, { header: "Last inquiry", align: "right", className: "w-[24mm]" }]}
        rows={data.rows.map((c) => [
          <Cell key="c" main={c.contactPerson} sub={c.companyName ?? "No company"} />,
          <span key="p" className="whitespace-nowrap tabular-nums">{c.phone}</span>,
          <span key="e" className="break-all">{c.email ?? "—"}</span>,
          c.queryCount,
          c.lastQueryAt ? formatDate(c.lastQueryAt) : "—",
        ])}
        footer={["Total", "", "", inquiries, ""]}
      />
    </ReportSheet>
  );
}
