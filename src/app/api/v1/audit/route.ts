import { apiUser, handle, json, page, searchParams } from "@/lib/api/http";
import { AUDIT_TYPES, auditTypeLabel, parseAuditParams } from "@/lib/list-filters";
import { listAudit } from "@/modules/audit/repository";
import { listUsers } from "@/modules/users/repository";

export const runtime = "nodejs";

/** ?type=<record type>&who=<user id>&from&to&page */
export const GET = handle(async (request: Request) => {
  await apiUser("audit.view");
  const sp = searchParams(request);
  const people = await listUsers();
  const { filters } = parseAuditParams(sp, people);
  const result = await listAudit({ ...filters, page: page(sp.page), pageSize: 50 });
  return json({ ...result, types: AUDIT_TYPES.map((t) => ({ value: t, label: auditTypeLabel(t) })), people: people.map((p) => ({ id: p.id, name: p.name })) });
});
