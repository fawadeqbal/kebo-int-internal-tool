import { requirePagePermission } from "@/lib/auth/session";
import { listAudit } from "@/modules/audit/repository";
import { listUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { auditTypeLabel, describeFilters, parseAuditParams } from "@/lib/list-filters";
import { formatDateTime } from "@/lib/utils/dates";
import { ReportSheet, ReportTable } from "@/components/documents/report-sheet";
import { generatedNow, limitNote, PDF_ROW_LIMIT, plural } from "../shared";

export const metadata = { title: "Audit log" };

function changes(oldValues: unknown, newValues: unknown) {
  const n = (newValues ?? {}) as Record<string, unknown>;
  const o = (oldValues ?? {}) as Record<string, unknown>;
  return Object.keys(n)
    .slice(0, 6)
    .map((k) => `${k}: ${k in o ? `${String(o[k] ?? "—").slice(0, 40)} → ` : ""}${String(n[k] ?? "—").slice(0, 60)}`)
    .join("; ");
}

export default async function AuditExport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePagePermission("audit.view");
  const people = await listUsers();
  const { filters, active } = parseAuditParams(await searchParams, people);
  const [data, settings] = await Promise.all([listAudit({ ...filters, pageSize: PDF_ROW_LIMIT }), getSettings()]);
  return (
    <ReportSheet
      landscape
      settings={settings}
      title="Audit log"
      kind="Change history"
      filters={describeFilters(active)}
      generatedAt={generatedNow()}
      generatedBy={user.name}
      records={plural(data.total, "entry", "entries")}
      note={limitNote(data.rows.length, data.total)}
    >
      <ReportTable
        empty="No activity matches these filters."
        columns={[{ header: "When", className: "w-[32mm]" }, { header: "Who", className: "w-[32mm]" }, { header: "Record", className: "w-[22mm]" }, { header: "What happened", className: "w-[80mm]" }, { header: "Changes" }]}
        rows={data.rows.map((r) => [
          <span key="w" className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span>,
          r.userName ?? "System",
          auditTypeLabel(r.entityType),
          r.summary ?? r.action,
          <span key="c" className="text-[9.5px] break-words text-stone-500">{changes(r.oldValues, r.newValues) || "—"}</span>,
        ])}
      />
    </ReportSheet>
  );
}
