import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recordAudit } from "@/modules/audit/service";
import { listQueriesForExport } from "@/modules/queries/repository";
import { parseQueryFilters } from "@/modules/queries/filters";
import { PRIORITY_LABEL, QUERY_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { toCsv } from "@/lib/utils/csv";
import { formatDateTime, todayISO } from "@/lib/utils/dates";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const rows = await listQueriesForExport(user, parseQueryFilters(sp));
  await recordAudit(db, { userId: user.id, action: "export", entityType: "export", summary: `Downloaded the Inquiries CSV (${rows.length} rows)` });
  const csv = toCsv(
    ["RFQ no.", "Title", "Customer", "Company", "Phone / WhatsApp", "Sourcing category", "Quantity", "Received via", "Priority", "Status", "Handled by", "Needed by", "Received", "Closed"],
    rows.map((r) => [
      r.refNo,
      r.title,
      r.contactPerson,
      r.companyName === r.contactPerson ? "" : r.companyName,
      r.customerPhone,
      r.category,
      r.quantity,
      SOURCE_LABEL[r.source],
      PRIORITY_LABEL[r.priority],
      QUERY_STATUS_LABEL[r.status],
      r.assigneeName ?? "Not assigned",
      r.requiredBy,
      formatDateTime(r.createdAt),
      formatDateTime(r.completedAt),
    ]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inquiries-${todayISO()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
