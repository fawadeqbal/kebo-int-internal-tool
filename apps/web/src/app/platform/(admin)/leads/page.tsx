import Link from "next/link";
import { Plus } from "lucide-react";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUSES } from "@kebo/shared";
import { buildHref, ButtonLink, Card, cn, DataRow, EmptyState, ListToolbar, PAGE_SIZE, PageHeader, Pager, PhoneList, PhoneRow, Td, Th, THead, toPage } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { date, timeAgo } from "@/lib/format";
import type { LeadRow } from "@/lib/types-platform";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { CompanyStatusBadge, LeadStatusBadge } from "@/components/platform/badges";

export const metadata = { title: "Client inquiries" };

type Search = { status?: string; q?: string; page?: string };

/**
 * People who asked about the app (design system: List frame): demo requests,
 * self sign-ups and the ones added by hand. Add by hand is the one primary;
 * search and a chip per status with its count in one row; rows open the lead,
 * ⋯ at the end; 25 a page. The list is read whole (tens of leads) and
 * filtered here.
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const all = await platformApi.get<LeadRow[]>("/leads", { q: sp.q });
  const status = (LEAD_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const keep = { status, q: sp.q };
  const href = (patch: Partial<Search>) => buildHref("/platform/leads", keep, { page: undefined, ...patch });
  const rows = status ? all.filter((l) => l.status === status) : all;
  const page = Math.min(toPage(sp.page), Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const today = new Date().toISOString().slice(0, 10);
  const followUp = all.filter((l) => l.followUpOn && l.followUpOn <= today && l.status !== "client" && l.status !== "lost").length;

  const chips = [
    { key: "all", label: "All", count: all.length, href: href({ status: undefined }), active: !status },
    ...LEAD_STATUSES.map((s) => ({ key: s, label: LEAD_STATUS_LABEL[s], count: all.filter((l) => l.status === s).length, href: href({ status: s }), active: status === s })).filter((c) => c.active || c.count > 0),
  ];
  const rowMenu = (l: LeadRow): MenuEntry[] => [
    { label: "Open", href: `/platform/leads/${l.id}` },
    ...(l.company ? [{ label: `Open ${l.company.slug}`, href: `/platform/companies/${l.company.id}` }] : []),
    { label: "Copy link", copy: `/platform/leads/${l.id}` },
  ];

  return (
    <div>
      <PageHeader
        title="Client inquiries"
        summary={
          <>
            {all.length} {all.length === 1 ? "inquiry" : "inquiries"}
            {followUp > 0 && <span className="text-warn"> · {followUp} to follow up</span>}
            <span className="max-sm:hidden"> · new → contacted → demo given → client, or lost</span>
          </>
        }
        primary={
          <ButtonLink href="/platform/leads/new" variant="primary">
            <Plus aria-hidden /> Add by hand
          </ButtonLink>
        }
      />
      <ListToolbar search={{ placeholder: "Company, name or email", value: sp.q, clearHref: href({ q: undefined }) }} keep={keep} chips={chips} label="Filter client inquiries" />
      <Card className="overflow-clip p-0">
        {shown.length === 0 ? (
          all.length === 0 && !sp.q ? (
            <EmptyState
              framed
              title="No client inquiries yet"
              description="Requests from the public “Request a demo” page and self sign-ups land here."
              action={
                <ButtonLink href="/platform/leads/new" size="sm">
                  <Plus aria-hidden /> Add one by hand
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              framed
              title="No client inquiries match these filters"
              description="Try another name or status, or clear the filters."
              action={
                <ButtonLink href="/platform/leads" size="sm">
                  Clear filters
                </ButtonLink>
              }
            />
          )
        ) : (
          <>
            <PhoneList label="Client inquiries">
              {shown.map((l) => (
                <PhoneRow
                  key={l.id}
                  href={`/platform/leads/${l.id}`}
                  title={l.companyName}
                  line={`${l.name} · ${LEAD_SOURCE_LABEL[l.source]}`}
                  status={<LeadStatusBadge status={l.status} />}
                  figure={l.followUpOn ? `Follow up ${date(l.followUpOn)}` : timeAgo(l.createdAt)}
                />
              ))}
            </PhoneList>
            <DataTable label="Client inquiries" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Company</Th>
                  <Th>Status</Th>
                  <Th>From</Th>
                  <Th>Demo / company</Th>
                  <Th>Follow up</Th>
                  <Th className="text-right">Came in</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {shown.map((l) => (
                  <DataRow key={l.id} href={`/platform/leads/${l.id}`}>
                    <Td>
                      <Link href={`/platform/leads/${l.id}`} className="block font-semibold hover:text-primary">
                        {l.companyName}
                      </Link>
                      <span className="block text-xs text-text-2">
                        {l.name} · {l.email}
                        {l.country ? ` · ${l.country}` : ""}
                      </span>
                    </Td>
                    <Td>
                      <LeadStatusBadge status={l.status} />
                    </Td>
                    <Td className="text-sm text-text-2">
                      {LEAD_SOURCE_LABEL[l.source]}
                      {l.channel && <span className="block text-xs">{l.channel}</span>}
                    </Td>
                    <Td>
                      {l.company ? (
                        <span className="flex items-center gap-1.5 text-sm">
                          {l.company.slug} <CompanyStatusBadge status={l.company.status} />
                        </span>
                      ) : (
                        <span className="text-sm text-text-2">—</span>
                      )}
                    </Td>
                    <Td className={cn("text-sm whitespace-nowrap", l.followUpOn && l.followUpOn <= today && "font-medium text-warn")}>{date(l.followUpOn)}</Td>
                    <Td className="text-right text-xs whitespace-nowrap text-text-2">{timeAgo(l.createdAt)}</Td>
                    <Td className="text-right">
                      <RowMenu items={rowMenu(l)} label={`Actions for ${l.companyName}`} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/platform/leads" params={keep} page={page} total={rows.length} />
      </Card>
    </div>
  );
}
