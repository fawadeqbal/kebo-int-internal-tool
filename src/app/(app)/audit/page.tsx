import { requirePagePermission } from "@/lib/auth/session";
import { listAudit } from "@/modules/audit/repository";
import { Card, EmptyState, PageHeader, Select, Table, Td, Th, Button } from "@/components/ui";
import { Pagination, toPage } from "@/components/ui/pagination";
import { formatDateTime } from "@/lib/utils/dates";

export const metadata = { title: "Audit log" };

const ENTITY_TYPES = ["query", "customer", "quotation", "invoice", "payment", "attachment", "user", "settings"];

function Changes({ oldValues, newValues }: { oldValues: unknown; newValues: unknown }) {
  const n = (newValues ?? {}) as Record<string, unknown>;
  const o = (oldValues ?? {}) as Record<string, unknown>;
  const keys = Object.keys(n);
  if (keys.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted">
      {keys.slice(0, 6).map((k) => (
        <li key={k}>
          <span className="font-medium text-ink/80">{k}</span>: {k in o ? <s className="mr-1">{String(o[k] ?? "—").slice(0, 60)}</s> : null}
          {String(n[k] ?? "—").slice(0, 80)}
        </li>
      ))}
    </ul>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; type?: string }> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const page = toPage(sp.page);
  const type = ENTITY_TYPES.includes(sp.type ?? "") ? sp.type : undefined;
  const data = await listAudit({ page, entityType: type });
  return (
    <>
      <PageHeader title="Audit log" description="Every important change: who did it, when, and what changed." />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Record type
            <Select name="type" defaultValue={type ?? ""} className="w-48">
              <option value="">All</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="secondary">Filter</Button>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-44">When</Th>
                <Th className="w-40">Who</Th>
                <Th className="w-32">Record</Th>
                <Th>What happened</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <Td className="text-muted">{formatDateTime(r.createdAt)}</Td>
                  <Td>{r.userName ?? "System"}</Td>
                  <Td className="capitalize text-muted">{r.entityType}</Td>
                  <Td>
                    {r.summary ?? r.action}
                    <Changes oldValues={r.oldValues} newValues={r.newValues} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination base="/audit" params={{ type }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
