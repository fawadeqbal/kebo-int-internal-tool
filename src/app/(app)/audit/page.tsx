import { ScrollText } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listAudit } from "@/modules/audit/repository";
import { Avatar, EmptyState, FilterBar, PageHeader, Table, THead, Td, Th, Tr } from "@/components/ui";
import { AutoSelect } from "@/components/ui/client";
import { Badge } from "@/components/ui/badge";
import { Pagination, toPage } from "@/components/ui/pagination";
import { formatDateTime } from "@/lib/utils/dates";

export const metadata = { title: "Audit log" };

const ENTITY_TYPES = ["query", "customer", "quotation", "invoice", "payment", "attachment", "user", "settings"];
const ENTITY_LABEL: Record<string, string> = { query: "Inquiry" };
const label = (t: string) => ENTITY_LABEL[t] ?? t[0].toUpperCase() + t.slice(1);

function Changes({ oldValues, newValues }: { oldValues: unknown; newValues: unknown }) {
  const n = (newValues ?? {}) as Record<string, unknown>;
  const o = (oldValues ?? {}) as Record<string, unknown>;
  const keys = Object.keys(n);
  if (keys.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted">
      {keys.slice(0, 6).map((k) => (
        <li key={k}>
          <span className="font-mono text-[11px] text-text-2">{k}</span>: {k in o ? <s className="mr-1">{String(o[k] ?? "—").slice(0, 60)}</s> : null}
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
    <div className="space-y-5">
      <PageHeader title="Audit log" description="Every important change: who did it, when, and what changed." />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <form>
          <FilterBar end={<span className="text-xs text-muted tabular">{data.total} entries</span>}>
            <AutoSelect name="type" defaultValue={type ?? ""} className="w-48" aria-label="Record type">
              <option value="">All records</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </AutoSelect>
          </FilterBar>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No activity yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th className="w-44">When</Th>
                <Th className="w-44">Who</Th>
                <Th className="w-28">Record</Th>
                <Th>What happened</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="py-2.5 align-top whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</Td>
                  <Td className="py-2.5 align-top">
                    <span className="flex items-center gap-2">
                      <Avatar name={r.userName ?? "System"} size={22} />
                      <span className="truncate">{r.userName ?? "System"}</span>
                    </span>
                  </Td>
                  <Td className="py-2.5 align-top">
                    <Badge tone="outline">{label(r.entityType)}</Badge>
                  </Td>
                  <Td className="py-2.5 align-top">
                    {r.summary ?? r.action}
                    <Changes oldValues={r.oldValues} newValues={r.newValues} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination base="/audit" params={{ type }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
