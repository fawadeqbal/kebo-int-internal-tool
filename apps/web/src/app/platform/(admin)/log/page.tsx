import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { PLATFORM_LOG_KINDS, platformLogKind, type PlatformLogKind } from "@kebo/shared";
import {
  Badge,
  buildHref,
  buttonClass,
  Card,
  DataRow,
  EmptyState,
  ListToolbar,
  PageHeader,
  Pager,
  PhoneList,
  PhoneRow,
  Td,
  Th,
  THead,
  Tr,
  toPage,
} from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { dateTime } from "@/lib/format";
import type { LogEntry, LogPage } from "@/lib/types-platform";
import { DataTable } from "@/components/common/data-table";

export const metadata = { title: "Platform log" };

type Search = { q?: string; kind?: string; page?: string };

const kindLabel = (k: string) => (k in PLATFORM_LOG_KINDS ? PLATFORM_LOG_KINDS[k as PlatformLogKind].label : "Other");
/** Where an entry opens: its company, or its client inquiry. */
const target = (e: LogEntry) => (e.companyId ? `/platform/companies/${e.companyId}` : e.leadId ? `/platform/leads/${e.leadId}` : null);

/**
 * Everything done on the platform, by platform admins and by the automatic
 * rules (design system: List frame): search and kind chips with counts and
 * Excel in one row, newest first, 25 a page, filters in the URL; a row about a
 * company or a client inquiry opens it.
 */
export default async function PlatformLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const log = await platformApi.get<LogPage>("/log", { q: sp.q, kind: sp.kind, page: sp.page ? String(toPage(sp.page)) : undefined });
  const keep = { q: sp.q, kind: sp.kind };
  const href = (patch: Partial<Search>) => buildHref("/platform/log", keep, { page: undefined, ...patch });
  const kinds = [...(Object.keys(PLATFORM_LOG_KINDS) as PlatformLogKind[]), ...((log.counts.other ?? 0) > 0 ? ["other"] : [])];
  return (
    <div>
      <PageHeader
        title="Platform log"
        summary="Everything done on the platform. What a platform admin does inside a company is also in that company's own audit log."
      />
      <ListToolbar
        search={{ placeholder: "What or who", value: sp.q, clearHref: href({ q: undefined }) }}
        keep={keep}
        label="Filter the log"
        chips={[
          { key: "all", label: "All", count: log.counts.all ?? 0, href: href({ kind: undefined }), active: !log.kind },
          ...kinds.map((k) => ({
            key: k,
            label: kindLabel(k),
            count: log.counts[k] ?? 0,
            href: href({ kind: log.kind === k ? undefined : k }),
            active: log.kind === k,
          })),
        ].filter((c) => c.key === "all" || c.active || c.count > 0)}
        end={
          <a href={buildHref("/platform/log/excel", {}, keep)} download className={buttonClass("secondary", "sm")} title="Export to Excel">
            <FileSpreadsheet aria-hidden /> Excel
          </a>
        }
      />
      <Card className="overflow-clip p-0">
        {log.rows.length === 0 ? (
          <EmptyState
            framed
            title={sp.q || sp.kind ? "Nothing matches these filters" : "Nothing yet"}
            description={
              sp.q || sp.kind ? "Try other words, or clear the filters." : "What platform admins and the automatic rules do shows here."
            }
            action={
              sp.q || sp.kind ? (
                <Link href="/platform/log" className={buttonClass("secondary", "sm")}>
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <PhoneList label="Platform log">
              {log.rows.map((e) => (
                <PhoneRow
                  key={e.id}
                  href={target(e) ?? undefined}
                  title={e.summary}
                  line={`${e.adminName ?? "Automatic rules"} · ${dateTime(e.at)}`}
                />
              ))}
            </PhoneList>
            <DataTable label="Platform log" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Kind</Th>
                  <Th>What</Th>
                </tr>
              </THead>
              <tbody>
                {log.rows.map((e) => {
                  const to = target(e);
                  const cells = (
                    <>
                      <Td className="text-xs whitespace-nowrap text-text-2">{dateTime(e.at)}</Td>
                      <Td className="text-sm whitespace-nowrap">{e.adminName ?? <span className="text-text-2">Automatic rules</span>}</Td>
                      <Td>
                        <Badge tone="neutral">{kindLabel(platformLogKind(e.action))}</Badge>
                      </Td>
                      <Td className="text-sm">
                        {to ? (
                          <Link href={to} className="hover:text-primary">
                            {e.summary}
                          </Link>
                        ) : (
                          e.summary
                        )}
                      </Td>
                    </>
                  );
                  return to ? (
                    <DataRow key={e.id} href={to}>
                      {cells}
                    </DataRow>
                  ) : (
                    <Tr key={e.id}>{cells}</Tr>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/platform/log" params={keep} page={log.page} pageSize={log.pageSize} total={log.total} />
      </Card>
    </div>
  );
}
