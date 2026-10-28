import Link from "next/link";
import { CHANNEL_LABEL, INQUIRY_STAGE_LABEL, REVISION_STATUS_LABEL } from "@kebo/shared";
import { buildHref, ButtonLink, Card, EmptyState, FilterBar, LinkTabs, PageHeader, Pagination, PriorityBadge, SearchField, StageBadge, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { ExportLink } from "@/components/sheets/export-link";
import { requireUser } from "@/lib/session";
import { date, money, timeAgo } from "@/lib/format";
import type { DealRow, Paged } from "@/lib/types";

export const metadata = { title: "Inquiries" };

type Params = Record<string, string | undefined>;

/** Every inquiry, by stage. "Open" is the working list: New, Sourcing and Quoted. */
export default async function DealsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const sp = await searchParams;
  const stage = sp.stage ?? "open";
  const data = await api.get<Paged<DealRow> & { counts: Record<string, number> }>("/inquiries", {
    stage: stage === "all" ? undefined : stage,
    q: sp.q,
    assignee: sp.assignee,
    customerId: sp.customer,
    sort: sp.sort,
    page: toPage(sp.page),
  });
  const c = data.counts;
  const keep = { q: sp.q, assignee: sp.assignee, customer: sp.customer, sort: sp.sort };
  const tab = (value: string, label: string, count?: number) => ({ href: buildHref("/inquiries", keep, { stage: value === "open" ? undefined : value }), label, count, active: stage === value });
  const open = (c.new ?? 0) + (c.sourcing ?? 0) + (c.quoted ?? 0);
  return (
    <div>
      <PageHeader title="Inquiries" description="Every RFQ from first message to won or lost." actions={
          <>
            <ExportLink what="inquiries" query={{ stage, q: sp.q, assignee: sp.assignee, customer: sp.customer, sort: sp.sort }} />
            <ButtonLink href="/inquiries/new" variant="primary">
              New inquiry
            </ButtonLink>
          </>
        } />
      <LinkTabs
        label="Stage"
        className="mb-4"
        tabs={[
          tab("open", "Open", open),
          tab("new", INQUIRY_STAGE_LABEL.new, c.new),
          tab("sourcing", INQUIRY_STAGE_LABEL.sourcing, c.sourcing),
          tab("quoted", INQUIRY_STAGE_LABEL.quoted, c.quoted),
          tab("overdue", "Past needed-by"),
          tab("on_hold", "On hold"),
          tab("won", INQUIRY_STAGE_LABEL.won, c.won),
          tab("lost", INQUIRY_STAGE_LABEL.lost, c.lost),
          tab("all", "All"),
        ]}
      />
      <FilterBar className="mb-4">
        <form className="flex flex-1 flex-wrap items-center gap-2">
          {stage !== "open" && <input type="hidden" name="stage" value={stage} />}
          <SearchField defaultValue={sp.q} placeholder="Search RFQ no., customer, item, model…" clearHref={buildHref("/inquiries", { ...keep, stage: stage === "open" ? undefined : stage }, { q: undefined })} className="min-w-64 flex-1" />
          <select name="assignee" defaultValue={sp.assignee ?? ""} className="h-9 rounded-md border border-line bg-surface px-2 text-sm" aria-label="Handled by">
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Nobody yet</option>
          </select>
          <select name="sort" defaultValue={sp.sort ?? "newest"} className="h-9 rounded-md border border-line bg-surface px-2 text-sm" aria-label="Sort">
            <option value="newest">Newest</option>
            <option value="required">Needed-by date</option>
            <option value="priority">Priority</option>
            <option value="updated">Recently changed</option>
            <option value="oldest">Oldest</option>
          </select>
          <button className="h-9 rounded-md border border-line px-3 text-sm">Apply</button>
        </form>
      </FilterBar>
      {data.rows.length === 0 ? (
        <EmptyState title={sp.q ? `Nothing matches "${sp.q}"` : "No inquiries here"} description="New inquiries from the website arrive here by themselves." action={<ButtonLink href="/inquiries/new">New inquiry</ButtonLink>} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <THead>
              <tr>
                <Th>Inquiry</Th>
                <Th>Customer</Th>
                <Th>Stage</Th>
                <Th>Quotation</Th>
                <Th>Handled by</Th>
                <Th className="text-right">Received</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <Link href={`/inquiries/${d.id}`} className="font-medium hover:text-primary">
                      {d.refNo}
                    </Link>
                    <span className="block max-w-80 truncate text-xs text-muted">
                      {d.title} · {d.items} item{d.items === 1 ? "" : "s"} · {CHANNEL_LABEL[d.channel]}
                    </span>
                  </Td>
                  <Td>
                    <Link href={`/customers/${d.customer.id}`} className="hover:text-primary">
                      {d.customer.name}
                    </Link>
                    {d.customer.country === "ZZ" && <span className="block text-xs text-warn">Country not set</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      <StageBadge stage={d.stage} onHold={d.onHold} />
                      <PriorityBadge priority={d.priority} />
                    </div>
                    {d.requiredBy && <span className={`block text-xs ${d.overdue ? "font-medium text-bad" : "text-muted"}`}>needed by {date(d.requiredBy)}</span>}
                  </Td>
                  <Td>
                    {d.order ? (
                      <Link href={`/orders/${d.order.id}`} className="text-sm hover:text-primary">
                        Order {d.order.refNo}
                      </Link>
                    ) : d.quotation?.latest ? (
                      <span className="text-sm">
                        R{d.quotation.latest.number} {REVISION_STATUS_LABEL[d.quotation.latest.status].toLowerCase()}
                        <span className="block text-xs text-muted tabular">{money(d.quotation.latest.total, d.quotation.latest.currency)}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Not quoted</span>
                    )}
                  </Td>
                  <Td>{d.assignee?.name ?? <span className="text-xs font-medium text-warn">Nobody yet</span>}</Td>
                  <Td className="text-right text-xs whitespace-nowrap text-muted">{timeAgo(d.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {data.total > data.pageSize && <Pagination base="/inquiries" params={{ ...keep, stage: stage === "open" ? undefined : stage }} page={data.page} pageSize={data.pageSize} total={data.total} />}
    </div>
  );
}
