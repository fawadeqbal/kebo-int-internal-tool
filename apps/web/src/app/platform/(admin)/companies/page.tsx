import Link from "next/link";
import { Building2 } from "lucide-react";
import {
  buildHref,
  ButtonLink,
  Card,
  cn,
  EmptyState,
  FilterBar,
  FilterChip,
  PageHeader,
  SearchField,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { date, dateTime, timeAgo } from "@/lib/format";
import type { CompanyRow } from "@/lib/types-platform";
import { BillingBadge, CompanyStatusBadge, KindBadge } from "@/components/platform/badges";

export const metadata = { title: "Companies & demos" };

type Search = { kind?: string; status?: string; q?: string };

/** Every company using the app: clients, demos and trials, with their plan, people, files and activity. */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const rows = await platformApi.get<CompanyRow[]>("/companies", { kind: sp.kind, status: sp.status, q: sp.q });
  const href = (patch: Partial<Search>) => buildHref("/platform/companies", sp, patch);
  return (
    <div>
      <PageHeader
        title="Companies & demos"
        description="Each company works in its own space; nothing is shared between them."
        actions={
          <ButtonLink href="/platform/companies/new" variant="primary">
            New company or demo
          </ButtonLink>
        }
      />
      <Card className="overflow-hidden p-0">
        <FilterBar
          end={
            <form action="/platform/companies" role="search">
              {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
              {sp.status && <input type="hidden" name="status" value={sp.status} />}
              <SearchField defaultValue={sp.q} placeholder="Name, short name or email" clearHref={href({ q: undefined })} />
            </form>
          }
        >
          <FilterChip href={href({ kind: undefined })} active={!sp.kind}>
            All
          </FilterChip>
          <FilterChip href={href({ kind: "client" })} active={sp.kind === "client"}>
            Clients
          </FilterChip>
          <FilterChip href={href({ kind: "demo" })} active={sp.kind === "demo"}>
            Demos
          </FilterChip>
          <FilterChip href={href({ kind: "trial" })} active={sp.kind === "trial"}>
            Trials
          </FilterChip>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <FilterChip href={href({ status: sp.status === "off" ? undefined : "off" })} active={sp.status === "off"}>
            Switched off
          </FilterChip>
          <FilterChip href={href({ status: sp.status === "deleted" ? undefined : "deleted" })} active={sp.status === "deleted"}>
            Deleted
          </FilterChip>
        </FilterBar>
        {rows.length ? (
          <Table>
            <THead>
              <tr>
                <Th>Company</Th>
                <Th>Status</Th>
                <Th>Plan</Th>
                <Th>Ends / paid until</Th>
                <Th className="text-right">People</Th>
                <Th className="text-right">Files</Th>
                <Th className="text-right">Last active</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id} className={cn("hover:bg-surface-2/50", c.status === "deleted" && "text-muted")}>
                  <Td>
                    <Link href={`/platform/companies/${c.id}`} className="group block min-w-0">
                      <span className="block font-medium group-hover:text-primary">{c.name}</span>
                      <span className="block text-xs text-muted">
                        {c.slug} · {c.contactEmail ?? "no contact"}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <KindBadge kind={c.kind} />
                      <CompanyStatusBadge status={c.status} />
                      {c.kind === "client" && c.status !== "deleted" && c.billing !== "active" && <BillingBadge billing={c.billing} />}
                    </span>
                  </Td>
                  <Td className="text-sm">{c.plan?.name ?? <span className="text-muted">No plan (no limits)</span>}</Td>
                  <Td className="text-sm whitespace-nowrap">
                    {c.kind === "client" ? (c.renewsOn ? date(c.renewsOn) : "—") : dateTime(c.endsAt)}
                  </Td>
                  <Td className="text-right tabular">
                    {c.usage?.users ?? 0}
                    {c.plan?.maxUsers ? <span className="text-muted"> / {c.plan.maxUsers}</span> : null}
                  </Td>
                  <Td className="text-right text-sm whitespace-nowrap tabular">{c.usage ? `${c.usage.storageMb} MB` : "—"}</Td>
                  <Td className="text-right text-xs whitespace-nowrap text-muted">{c.lastActiveAt ? timeAgo(c.lastActiveAt) : "Never"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon={Building2}
            title="No companies here"
            description="Make a company for a client, or a demo for someone who asked."
          />
        )}
      </Card>
    </div>
  );
}
