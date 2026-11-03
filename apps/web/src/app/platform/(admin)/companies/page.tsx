import Link from "next/link";
import { Plus } from "lucide-react";
import { COMPANY_KIND_LABEL } from "@kebo/shared";
import { buildHref, ButtonLink, Card, cn, DataRow, EmptyState, ListToolbar, PAGE_SIZE, PageHeader, Pager, PhoneList, PhoneRow, Td, Th, THead, toPage } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { date, dateTime, timeAgo } from "@/lib/format";
import type { CompanyRow } from "@/lib/types-platform";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { BillingBadge, CompanyStatusBadge, KindBadge } from "@/components/platform/badges";

export const metadata = { title: "Companies & demos" };

type Search = { kind?: string; status?: string; q?: string; page?: string };

const KINDS = ["client", "demo", "trial"] as const;

/**
 * Every company using the app (design system: List frame): clients, demos and
 * trials, with their plan, people, files and activity. New company or demo is
 * the one primary; search and chips with counts (by kind, switched off,
 * deleted) in one row; rows open the company, ⋯ at the end; 25 a page. There
 * are tens of companies, so the list is read whole and filtered here.
 */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const deleted = sp.status === "deleted";
  const [live, gone] = await Promise.all([
    platformApi.get<CompanyRow[]>("/companies", { q: sp.q }),
    platformApi.get<CompanyRow[]>("/companies", { q: sp.q, status: "deleted" }),
  ]);
  const keep = { kind: sp.kind, status: sp.status, q: sp.q };
  const href = (patch: Partial<Search>) => buildHref("/platform/companies", keep, { page: undefined, ...patch });
  const ofKind = (r: CompanyRow) => !sp.kind || r.kind === sp.kind;
  const ofStatus = (r: CompanyRow) => !sp.status || deleted || r.status === sp.status;
  const rows = (deleted ? gone : live).filter((r) => ofKind(r) && ofStatus(r));
  const page = Math.min(toPage(sp.page), Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const chips = [
    { key: "all", label: "All", count: live.filter(ofStatus).length, href: href({ kind: undefined, status: deleted ? undefined : sp.status }), active: !sp.kind && !deleted },
    ...KINDS.map((k) => ({
      key: k,
      label: `${COMPANY_KIND_LABEL[k]}s`,
      count: live.filter((r) => r.kind === k && ofStatus(r)).length,
      href: href({ kind: sp.kind === k ? undefined : k, status: deleted ? undefined : sp.status }),
      active: sp.kind === k && !deleted,
    })),
    { key: "off", label: "Switched off", count: live.filter((r) => r.status === "off" && ofKind(r)).length, href: href({ status: sp.status === "off" ? undefined : "off" }), active: sp.status === "off" },
    { key: "deleted", label: "Deleted", count: gone.filter(ofKind).length, href: href({ status: deleted ? undefined : "deleted" }), active: deleted },
  ].filter((c) => c.key === "all" || c.active || c.count > 0);

  const rowMenu = (c: CompanyRow): MenuEntry[] => [
    { label: "Open", href: `/platform/companies/${c.id}` },
    { label: "Copy link", copy: `/platform/companies/${c.id}` },
  ];

  return (
    <div>
      <PageHeader
        title="Companies & demos"
        summary={
          <>
            {live.length} {live.length === 1 ? "company" : "companies"}
            <span className="max-sm:hidden"> · each works in its own space; nothing is shared between them</span>
          </>
        }
        primary={
          <ButtonLink href="/platform/companies/new" variant="primary">
            <Plus aria-hidden /> <span className="sm:hidden">New</span>
            <span className="max-sm:hidden">New company or demo</span>
          </ButtonLink>
        }
      />
      <ListToolbar
        search={{ placeholder: "Name, short name or email", value: sp.q, clearHref: href({ q: undefined }) }}
        keep={keep}
        chips={chips}
        label="Filter companies"
      />
      <Card className="overflow-clip p-0">
        {shown.length === 0 ? (
          live.length + gone.length === 0 && !sp.q ? (
            <EmptyState
              framed
              title="No companies yet"
              description="Make a company for a client, or a demo for someone who asked."
              action={
                <ButtonLink href="/platform/companies/new" size="sm">
                  <Plus aria-hidden /> Make the first one
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              framed
              title="No companies match these filters"
              description="Try another name, or clear the filters."
              action={
                <ButtonLink href="/platform/companies" size="sm">
                  Clear filters
                </ButtonLink>
              }
            />
          )
        ) : (
          <>
            <PhoneList label="Companies">
              {shown.map((c) => (
                <PhoneRow
                  key={c.id}
                  href={`/platform/companies/${c.id}`}
                  title={c.name}
                  line={`${COMPANY_KIND_LABEL[c.kind]} · ${c.plan?.name ?? "no plan"} · ${c.usage?.users ?? 0} people`}
                  muted={c.status === "deleted"}
                  status={<CompanyStatusBadge status={c.status} />}
                  figure={c.lastActiveAt ? timeAgo(c.lastActiveAt) : "Never active"}
                />
              ))}
            </PhoneList>
            <DataTable label="Companies" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Company</Th>
                  <Th>Status</Th>
                  <Th>Plan</Th>
                  <Th>Ends / paid until</Th>
                  <Th className="text-right">People</Th>
                  <Th className="text-right">Files</Th>
                  <Th className="text-right">Last active</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {shown.map((c) => (
                  <DataRow key={c.id} href={`/platform/companies/${c.id}`} className={cn(c.status === "deleted" && "text-text-2")}>
                    <Td>
                      <Link href={`/platform/companies/${c.id}`} className="block font-semibold hover:text-primary">
                        {c.name}
                      </Link>
                      <span className="block text-xs text-text-2">
                        {c.slug} · {c.contactEmail ?? "no contact"}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <KindBadge kind={c.kind} />
                        <CompanyStatusBadge status={c.status} />
                        {c.kind === "client" && c.status !== "deleted" && c.billing !== "active" && <BillingBadge billing={c.billing} />}
                      </span>
                    </Td>
                    <Td className="text-sm">{c.plan?.name ?? <span className="text-text-2">No plan (no limits)</span>}</Td>
                    <Td className="text-sm whitespace-nowrap">{c.kind === "client" ? (c.renewsOn ? date(c.renewsOn) : "—") : dateTime(c.endsAt)}</Td>
                    <Td className="text-right tabular">
                      {c.usage?.users ?? 0}
                      {c.plan?.maxUsers ? <span className="text-text-2"> / {c.plan.maxUsers}</span> : null}
                    </Td>
                    <Td className="text-right text-sm whitespace-nowrap tabular">{c.usage ? `${c.usage.storageMb} MB` : "—"}</Td>
                    <Td className="text-right text-xs whitespace-nowrap text-text-2">{c.lastActiveAt ? timeAgo(c.lastActiveAt) : "Never"}</Td>
                    <Td className="text-right">
                      <RowMenu items={rowMenu(c)} label={`Actions for ${c.name}`} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/platform/companies" params={keep} page={page} total={rows.length} />
      </Card>
    </div>
  );
}
