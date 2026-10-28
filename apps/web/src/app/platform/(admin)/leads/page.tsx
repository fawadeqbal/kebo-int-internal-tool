import Link from "next/link";
import { Inbox } from "lucide-react";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUSES } from "@kebo/shared";
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
import { date, timeAgo } from "@/lib/format";
import type { LeadRow } from "@/lib/types-platform";
import { CompanyStatusBadge, LeadStatusBadge } from "@/components/platform/badges";

export const metadata = { title: "Client inquiries" };

type Search = { status?: string; q?: string };

/** People who asked about the app: demo requests, self sign-ups and the ones added by hand. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const rows = await platformApi.get<LeadRow[]>("/leads", { status: sp.status, q: sp.q });
  const href = (patch: Partial<Search>) => buildHref("/platform/leads", sp, patch);
  return (
    <div>
      <PageHeader
        title="Client inquiries"
        description="New → contacted → demo given → client, or lost. Set a follow-up date so nobody is forgotten."
        actions={
          <ButtonLink href="/platform/leads/new" variant="primary">
            Add by hand
          </ButtonLink>
        }
      />
      <Card className="overflow-hidden p-0">
        <FilterBar
          end={
            <form action="/platform/leads" role="search">
              {sp.status && <input type="hidden" name="status" value={sp.status} />}
              <SearchField defaultValue={sp.q} placeholder="Company, name or email" clearHref={href({ q: undefined })} />
            </form>
          }
        >
          <FilterChip href={href({ status: undefined })} active={!sp.status}>
            All
          </FilterChip>
          {LEAD_STATUSES.map((s) => (
            <FilterChip key={s} href={href({ status: s })} active={sp.status === s}>
              {LEAD_STATUS_LABEL[s]}
            </FilterChip>
          ))}
        </FilterBar>
        {rows.length ? (
          <Table>
            <THead>
              <tr>
                <Th>Company</Th>
                <Th>Status</Th>
                <Th>From</Th>
                <Th>Demo / company</Th>
                <Th>Follow up</Th>
                <Th className="text-right">Came in</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((l) => (
                <Tr key={l.id} className="hover:bg-surface-2/50">
                  <Td>
                    <Link href={`/platform/leads/${l.id}`} className="group block">
                      <span className="block font-medium group-hover:text-primary">{l.companyName}</span>
                      <span className="block text-xs text-muted">
                        {l.name} · {l.email}
                        {l.country ? ` · ${l.country}` : ""}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <LeadStatusBadge status={l.status} />
                  </Td>
                  <Td className="text-sm text-text-2">
                    {LEAD_SOURCE_LABEL[l.source]}
                    {l.channel && <span className="block text-xs text-muted">{l.channel}</span>}
                  </Td>
                  <Td>
                    {l.company ? (
                      <Link href={`/platform/companies/${l.company.id}`} className="flex items-center gap-1.5 text-sm hover:text-primary">
                        {l.company.slug} <CompanyStatusBadge status={l.company.status} />
                      </Link>
                    ) : (
                      <span className="text-sm text-muted">—</span>
                    )}
                  </Td>
                  <Td
                    className={cn(
                      "text-sm whitespace-nowrap",
                      l.followUpOn && l.followUpOn <= new Date().toISOString().slice(0, 10) && "font-medium text-warn",
                    )}
                  >
                    {date(l.followUpOn)}
                  </Td>
                  <Td className="text-right text-xs whitespace-nowrap text-muted">{timeAgo(l.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon={Inbox}
            title="No client inquiries here"
            description="Requests from the public “Request a demo” page and self sign-ups land here."
          />
        )}
      </Card>
    </div>
  );
}
