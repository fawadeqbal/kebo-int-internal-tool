import Link from "next/link";
import { Plus } from "lucide-react";
import { can, CHANNEL_LABEL, INQUIRY_STAGE_LABEL, INQUIRY_STAGE_TONE, PRIORITY_LABEL, REVISION_STATUS_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { buildHref, ButtonLink, Card, DataRow, EmptyState, ListToolbar, PageHeader, Pager, PhoneList, PhoneRow, StatusBadge, Td, Th, THead, toPage } from "@kebo/ui";
import { AutoSelect } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { ExportLink } from "@/components/sheets/export-link";
import { DataTable } from "@/components/common/data-table";
import { MoreMenu, RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { hasFeature, requireUser } from "@/lib/session";
import { date, money, timeAgo } from "@/lib/format";
import type { DealRow, Paged } from "@/lib/types";

export const metadata = { title: "Inquiries" };

type Params = Record<string, string | undefined>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The chips, in order: the working list (Open) first, then each stage, the two flags, and All. */
const STAGES = ["open", "new", "sourcing", "quoted", "overdue", "on_hold", "won", "lost", "all"] as const;
const STAGE_CHIP: Record<(typeof STAGES)[number], string> = {
  open: "Open",
  new: INQUIRY_STAGE_LABEL.new,
  sourcing: INQUIRY_STAGE_LABEL.sourcing,
  quoted: INQUIRY_STAGE_LABEL.quoted,
  overdue: "Past needed-by",
  on_hold: "On hold",
  won: INQUIRY_STAGE_LABEL.won,
  lost: INQUIRY_STAGE_LABEL.lost,
  all: "All",
};

/** The latest quotation in a few words ("R2 sent · USD 12,400"), or the order it became. */
function quoted(d: DealRow): { text: string; figure?: string } | null {
  if (d.order) return { text: `Order ${d.order.refNo}` };
  const r = d.quotation?.latest;
  if (!r) return null;
  return {
    text: `R${r.number} ${REVISION_STATUS_LABEL[r.status].toLowerCase()}`,
    figure: `${money(r.total, r.currency)}${r.totalUpTo ? `–${money(r.totalUpTo, r.currency)}` : ""}`,
  };
}

/**
 * Inquiries (design system: List frame): New inquiry is the one primary (its
 * own page); search, a chip per stage with its count, "handled by" and sort,
 * and Excel in one row; rows open the inquiry, ⋯ at the end; 25 a page, every
 * filter in the URL. "Open" (New, Sourcing, Quoted) is the working list.
 */
export default async function DealsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const stage = STAGES.includes(sp.stage as (typeof STAGES)[number]) ? (sp.stage as (typeof STAGES)[number]) : "open";
  const [data, insights] = await Promise.all([
    api.get<Paged<DealRow> & { counts: Record<string, number> }>("/inquiries", {
      stage: stage === "all" ? undefined : stage,
      q: sp.q,
      assignee: sp.assignee,
      customerId: sp.customer,
      sort: sp.sort,
      page: toPage(sp.page),
    }),
    can(me, "reports.view") ? hasFeature("insights") : false,
  ]);
  const c = data.counts;
  const count = (s: (typeof STAGES)[number]) =>
    s === "open" ? (c.new ?? 0) + (c.sourcing ?? 0) + (c.quoted ?? 0) : s === "all" ? (c.new ?? 0) + (c.sourcing ?? 0) + (c.quoted ?? 0) + (c.won ?? 0) + (c.lost ?? 0) : (c[s] ?? 0);
  const keep = { q: sp.q, assignee: sp.assignee, customer: sp.customer, sort: sp.sort, stage: stage === "open" ? undefined : stage };
  const href = (patch: Params) => buildHref("/inquiries", keep, { page: undefined, ...patch });
  const open = count("open");
  const everything = count("all");
  const narrowed = !!(sp.q || sp.assignee || sp.customer);
  const customerName = sp.customer ? (data.rows[0]?.customer.name ?? "One customer") : null;
  const canCreate = can(me, "inquiries.create");

  const chips = [
    // Sourcing and Quoted show when picked (the dashboard links to them); the others when they hold something.
    ...STAGES.filter((s) => s === stage || s === "open" || s === "all" || (s !== "sourcing" && s !== "quoted" && count(s) > 0)).map((s) => ({
      key: s,
      label: STAGE_CHIP[s],
      count: count(s),
      href: href({ stage: s === "open" ? undefined : s }),
      active: stage === s,
    })),
    ...(customerName ? [{ key: "customer", label: `${customerName} ✕`, href: href({ customer: undefined }), active: true }] : []),
  ];

  const rowMenu = (d: DealRow): MenuEntry[] => [
    { label: "Open", href: `/inquiries/${d.id}` },
    ...(d.order ? [{ label: `Order ${d.order.refNo}`, href: `/orders/${d.order.id}` }] : []),
    { label: "The customer", href: `/customers/${d.customer.id}` },
    { label: "Their other inquiries", href: buildHref("/inquiries", {}, { customer: d.customer.id, stage: "all" }) },
    { label: "Copy link", copy: `/inquiries/${d.id}` },
  ];

  const badge = (d: DealRow) => (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge meaning={INQUIRY_STAGE_TONE[d.stage]}>{INQUIRY_STAGE_LABEL[d.stage]}</StatusBadge>
      {d.onHold && <StatusBadge meaning="neutral">On hold</StatusBadge>}
      {(d.priority === "high" || d.priority === "urgent") && <StatusBadge meaning={d.priority === "urgent" ? "bad" : "warn"}>{PRIORITY_LABEL[d.priority]}</StatusBadge>}
    </span>
  );

  return (
    <div>
      <PageHeader
        title="Inquiries"
        summary={
          <>
            {plural(open, "open inquiry", "open inquiries")}
            {count("overdue") > 0 && ` · ${count("overdue")} past needed-by`}
            <span className="max-sm:hidden"> · every RFQ from first message to won or lost</span>
          </>
        }
        primary={
          canCreate && (
            <ButtonLink href="/inquiries/new" variant="primary">
              <Plus aria-hidden /> <span className="sm:hidden">New</span>
              <span className="max-sm:hidden">New inquiry</span>
            </ButtonLink>
          )
        }
        more={insights ? <MoreMenu items={[{ label: "Sales in Insights", href: "/insights?tab=sales" }]} /> : undefined}
      />

      <ListToolbar
        search={{ placeholder: "Search RFQ no., customer, item, model…", value: sp.q, clearHref: href({ q: undefined }) }}
        keep={keep}
        chips={chips}
        label="Filter inquiries"
        filters={
          <form className="flex items-center gap-1.5">
            {Object.entries(keep).map(([k, v]) => (v && k !== "assignee" && k !== "sort" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <AutoSelect name="assignee" defaultValue={sp.assignee ?? ""} aria-label="Handled by" className="w-28">
              <option value="">Anyone</option>
              <option value="me">Handled by me</option>
              <option value="unassigned">Nobody yet</option>
            </AutoSelect>
            <AutoSelect name="sort" defaultValue={sp.sort ?? ""} aria-label="Sort" className="w-32">
              <option value="">Newest first</option>
              <option value="required">Needed-by date</option>
              <option value="priority">Priority</option>
              <option value="updated">Recently changed</option>
              <option value="oldest">Oldest first</option>
            </AutoSelect>
          </form>
        }
        end={<ExportLink what="inquiries" query={{ stage, q: sp.q, assignee: sp.assignee, customer: sp.customer, sort: sp.sort }} />}
      />

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          everything === 0 && !narrowed ? (
            <EmptyState
              framed
              title="No inquiries yet"
              description="Every RFQ shows here, from the first message to won or lost. Inquiries from the website arrive by themselves."
              action={
                canCreate ? (
                  <ButtonLink href="/inquiries/new" size="sm">
                    <Plus aria-hidden /> Add the first inquiry
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              framed
              title="No inquiries match these filters"
              description={sp.q ? `Nothing matches “${sp.q}” here. Try part of the RFQ number, the customer or an item.` : "Try another stage, or clear the filters."}
              action={
                <ButtonLink href={open > 0 && !narrowed ? "/inquiries" : "/inquiries?stage=all"} size="sm">
                  Clear filters
                </ButtonLink>
              }
            />
          )
        ) : (
          <>
            <PhoneList label="Inquiries">
              {data.rows.map((d) => {
                const qt = quoted(d);
                return (
                  <PhoneRow
                    key={d.id}
                    href={`/inquiries/${d.id}`}
                    title={d.customer.name}
                    line={`${d.refNo} · ${d.title}`}
                    status={<StatusBadge meaning={INQUIRY_STAGE_TONE[d.stage]}>{INQUIRY_STAGE_LABEL[d.stage]}</StatusBadge>}
                    figure={
                      d.overdue && d.requiredBy ? <span className="font-medium text-bad">Needed {date(d.requiredBy)}</span> : (qt?.figure ?? (d.requiredBy ? `Needed ${date(d.requiredBy)}` : timeAgo(d.createdAt)))
                    }
                  />
                );
              })}
            </PhoneList>
            <DataTable label="Inquiries" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Inquiry</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Quotation</Th>
                  <Th>Handled by</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((d) => {
                  const qt = quoted(d);
                  return (
                    <DataRow key={d.id} href={`/inquiries/${d.id}`}>
                      <Td>
                        <Link href={`/inquiries/${d.id}`} className="font-semibold hover:text-primary">
                          {d.refNo}
                        </Link>
                        <span className="block max-w-80 truncate text-xs text-text-2">
                          {d.title} · {plural(d.items, "item")} · {CHANNEL_LABEL[d.channel]}
                        </span>
                      </Td>
                      <Td>
                        {d.customer.name}
                        {d.customer.country === UNKNOWN_COUNTRY && <span className="block text-xs text-warn">Country not set</span>}
                      </Td>
                      <Td>
                        {badge(d)}
                        {d.requiredBy && <span className={`block text-xs ${d.overdue ? "font-medium text-bad" : "text-text-2"}`}>needed by {date(d.requiredBy)}</span>}
                      </Td>
                      <Td>
                        {qt ? (
                          <span className="text-sm">
                            {qt.text}
                            {qt.figure && (
                              <span className="block text-xs text-text-2 tabular" title={d.quotation?.latest?.totalOf || undefined}>
                                {qt.figure}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-text-2">Not quoted</span>
                        )}
                      </Td>
                      <Td>{d.assignee?.name ?? <StatusBadge meaning="warn">Nobody yet</StatusBadge>}</Td>
                      <Td className="text-right text-xs whitespace-nowrap text-text-2">{timeAgo(d.createdAt)}</Td>
                      <Td className="text-right">
                        <RowMenu items={rowMenu(d)} label={`Actions for ${d.refNo}`} />
                      </Td>
                    </DataRow>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/inquiries" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </div>
  );
}
