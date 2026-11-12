import Link from "next/link";
import {
  Archive,
  Download,
  FileText,
  LayoutGrid,
  List,
  MessageSquare,
  Plus,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { OrderGroups } from "@/lib/types-facts";
import { can, PARTY_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import {
  RefCode,
  buildHref,
  ButtonLink,
  Card,
  DataRow,
  EmptyState,
  LinkTabs,
  PageHeader,
  Pager,
  PhoneList,
  PhoneRow,
  StatRow,
  StatTile,
  StatusBadge,
  Td,
  Th,
  THead,
  toPage,
  Tr,
} from "@kebo/ui";
import { FilterCard } from "@/components/common/filter-card";
import { ConfirmAction } from "@/components/people/confirm-action";
import { api } from "@/lib/api";
import { PartyExcel } from "@/components/sheets/party-excel";
import { DataTable } from "@/components/common/data-table";
import { OpenPanelButton } from "@/components/common/panel";
import { importCustomersAction, restoreCustomerAction, saveCustomerAction, undoNewCustomerAction } from "../actions";
import { hasFeature, requireUser } from "@/lib/session";
import { COUNTRIES, countryName } from "@/lib/countries";
import type { Paged } from "@/lib/types";
import type { CustomerDetail, CustomerRow, Owed } from "@/lib/types-people";
import { CustomerPanel } from "../customer-panel";
import { currenciesFrom } from "../currencies";
import { crumbsFor } from "@/lib/nav";
import { plural, short, whole } from "@/lib/format";
import { getSettings } from "@/lib/loaders";

export const metadata = { title: "Customers" };

type Params = Record<string, string | undefined>;

const SHOWS = ["all", "company", "individual", "owing", "archived"] as const;
type Show = (typeof SHOWS)[number];
const STATUSES = [
  { value: "late", label: "Pays late" },
  { value: "owing", label: "Owes money" },
  { value: "order", label: "Order open" },
  { value: "inquiry", label: "Inquiry open" },
  { value: "none", label: "No orders yet" },
] as const;

/**
 * Customers (design system: List frame) — the proof page of the building
 * blocks: header with its one primary (New customer, in the side panel),
 * search + chips with counts + Excel in one row, a table whose rows open the
 * customer with ⋯ at the end, 25 a page, every filter in the URL. Staff see
 * the customers of their own deals.
 */
/** The customer's state in one word: late money first, then money due, an open order, nothing yet. */
function CustomerState({ c, owe }: { c: CustomerRow; owe?: Owed["rows"][number] }) {
  if (owe && Number(owe.overdue) > 0.005) return <StatusBadge meaning="bad">Pays late</StatusBadge>;
  if (owe) return <StatusBadge meaning="warn">Money due</StatusBadge>;
  if (c.openOrders > 0) return <StatusBadge meaning="info">Order open</StatusBadge>;
  if (c.openDeals > 0) return <StatusBadge meaning="info">Inquiry open</StatusBadge>;
  if (c.orders > 0) return <StatusBadge meaning="ok">Paid up</StatusBadge>;
  return <StatusBadge meaning="neutral">No orders yet</StatusBadge>;
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const show = SHOWS.includes(sp.show as Show) ? (sp.show as Show) : "all";
  const country = sp.country?.toUpperCase() || undefined;
  const currency = sp.currency?.toUpperCase() || undefined;
  const status = STATUSES.find((x) => x.value === sp.status)?.value;
  const canAdd = can(me, "customers.manage");
  const keep = { show: show === "all" ? undefined : show, q: sp.q, country, currency, status };
  const href = (patch: Params) => buildHref("/customers", { ...keep }, { page: undefined, ...patch });

  const panel = canAdd ? sp.panel : undefined;
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const year = new Date().getFullYear();
  const [owed, settings] = await Promise.all([
    // What each customer owes (managers with Insights): the "They owe" column, the figure and the Owe money chip.
    insights ? api.get<Owed>("/insights/facts/owed", { side: "receivable" }).catch(() => null) : null,
    getSettings(),
  ]);
  const owes = new Map((owed?.rows ?? []).map((r) => [r.partyId, r]));
  // The Owe money chip and the Pays late / Owes money statuses: only those customers (from what they owe).
  const lateIds = (owed?.rows ?? []).filter((r) => Number(r.overdue) > 0.005).map((r) => r.partyId);
  const ids = status === "late" ? lateIds : status === "owing" || show === "owing" ? [...owes.keys()] : undefined;
  const none = ids !== undefined && ids.length === 0;
  const query = {
    q: sp.q,
    country,
    currency,
    type: show === "company" || show === "individual" ? show : undefined,
    archived: show === "archived" ? "true" : undefined,
    status: status === "order" || status === "inquiry" || status === "none" ? status : undefined,
    ids: ids?.length ? ids.join(",") : undefined,
  };
  const empty: Paged<CustomerRow> = { rows: [], total: 0, page: 1, pageSize: 25 };
  const [data, all, openInquiries, askingCustomers, editing, sold, soldYear, soldLastYear] = await Promise.all([
    none ? empty : api.get<Paged<CustomerRow>>("/customers", { ...query, page: toPage(sp.page) }),
    api.get<Paged<CustomerRow> & { newThisYear?: number }>("/customers", { pageSize: 1 }),
    api.get<Paged<unknown>>("/inquiries", { stage: "open", pageSize: 1 }).catch(() => null),
    api.get<Paged<CustomerRow>>("/customers", { status: "inquiry", pageSize: 1 }),
    panel === "edit-customer" && sp.id ? api.get<CustomerDetail>(`/customers/${sp.id}`).catch(() => null) : null,
    // What each customer bought (all time) and this year's sales against last year's (Insights).
    insights ? api.get<OrderGroups>("/insights/facts/orders/groups", { period: "all", by: "customer" }).catch(() => null) : null,
    insights
      ? api
          .get<OrderGroups>("/insights/facts/orders/groups", { period: "all", by: "company", from: `${year}-01-01`, to: `${year}-12-31` })
          .catch(() => null)
      : null,
    insights
      ? api
          .get<OrderGroups>("/insights/facts/orders/groups", {
            period: "all",
            by: "company",
            from: `${year - 1}-01-01`,
            to: `${year - 1}-12-31`,
          })
          .catch(() => null)
      : null,
  ]);
  const soldBy = new Map((sold?.rows ?? []).map((r) => [r.key, r]));
  const salesYear = (soldYear?.rows ?? []).reduce((t, r) => t + Number(r.sales), 0);
  const salesLast = (soldLastYear?.rows ?? []).reduce((t, r) => t + Number(r.sales), 0);
  const owedTotal = (owed?.rows ?? []).reduce((t, r) => t + Number(r.total), 0);
  const overdueTotal = (owed?.rows ?? []).reduce((t, r) => t + Number(r.overdue), 0);
  const filtered = !!(sp.q || country || currency || status || show !== "all");
  const currencies = currenciesFrom(settings);

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/customers")}
        title="Customers"
        summary="Companies and people who buy from you"
        papers={
          <>
            {canAdd && <PartyExcel kind="customers" importAction={importCustomersAction} />}
            <ButtonLink href={buildHref("/sheets/export/customers", {}, { ...query, format: "csv" })} prefetch={false}>
              <Download aria-hidden /> Export CSV
            </ButtonLink>
          </>
        }
        primary={
          canAdd && (
            <OpenPanelButton panel="new-customer" variant="primary" label="Add customer">
              <Plus aria-hidden /> <span className="sm:hidden">Add</span>
              <span className="max-sm:hidden">Add customer</span>
            </OpenPanelButton>
          )
        }
      />

      <StatRow className="mb-4">
        <StatTile
          icon={Users}
          iconColor={1}
          label="Customers"
          value={all.total}
          sub={filtered ? `${data.total} shown` : "companies and people"}
        />
        {owed && (
          <StatTile
            icon={FileText}
            iconColor={2}
            label="They owe you"
            value={short(owedTotal, owed.currency)}
            tone={overdueTotal > 0.005 ? "bad" : undefined}
            sub={overdueTotal > 0.005 ? `${short(overdueTotal, owed.currency)} late` : "nothing late"}
            href="/finance/to-receive"
          />
        )}
        {soldYear && (
          <StatTile
            icon={TrendingUp}
            iconColor={3}
            label="Sold this year"
            value={short(salesYear, soldYear.currency)}
            tone={salesLast > 0 && salesYear >= salesLast ? "ok" : undefined}
            sub={
              salesLast > 0
                ? `${salesYear >= salesLast ? "▲" : "▼"} ${Math.abs(Math.round(((salesYear - salesLast) / salesLast) * 100))}%`
                : `${year}`
            }
            href="/reports/customers"
          />
        )}
        <StatTile
          icon={MessageSquare}
          iconColor={4}
          label="Open inquiries"
          value={openInquiries?.total ?? "—"}
          sub={`from ${plural(askingCustomers.total, "customer")}`}
          href="/inquiries"
        />
      </StatRow>

      <LinkTabs
        label="Which customers"
        className="mb-4"
        tabs={[
          {
            href: href({ show: undefined }),
            label: (
              <>
                <List aria-hidden />
                All
              </>
            ),
            active: show === "all",
          },
          {
            href: href({ show: "company" }),
            label: (
              <>
                <LayoutGrid aria-hidden />
                Companies
              </>
            ),
            active: show === "company",
          },
          {
            href: href({ show: "individual" }),
            label: (
              <>
                <UserRound aria-hidden />
                People
              </>
            ),
            active: show === "individual",
          },
          ...(owed
            ? [
                {
                  href: href({ show: "owing" }),
                  label: (
                    <>
                      <TriangleAlert aria-hidden />
                      Owe money
                    </>
                  ),
                  active: show === "owing",
                },
              ]
            : []),
          ...(can(me, "customers.delete")
            ? [
                {
                  href: href({ show: "archived" }),
                  label: (
                    <>
                      <Archive aria-hidden />
                      Archived
                    </>
                  ),
                  active: show === "archived",
                },
              ]
            : []),
        ]}
      />

      <FilterCard
        search="Search name, contact, phone, tax no…"
        value={sp.q}
        keep={{ show: keep.show }}
        clearHref={href({ q: undefined })}
        selects={[
          {
            name: "country",
            label: "Country",
            value: country,
            options: [{ value: UNKNOWN_COUNTRY, label: "Not set" }, ...COUNTRIES.map(([code, name]) => ({ value: code, label: name }))],
          },
          { name: "currency", label: "Currency", value: currency, options: currencies.map((c) => ({ value: c, label: c })) },
          {
            name: "status",
            label: "Status",
            value: status,
            options: STATUSES.filter((x) => owed || (x.value !== "late" && x.value !== "owing")).map((x) => ({
              value: x.value,
              label: x.label,
            })),
          },
        ]}
      />

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={show === "archived" && !filtered ? "Nothing archived" : filtered ? "No customers match" : "No customers yet"}
            description={
              show === "archived"
                ? "Customers you remove show here, and can be brought back."
                : filtered
                  ? "Try another name or filter, or clear the filters."
                  : "Every buyer you quote shows here, with their contacts. They are added with their first inquiry, or here."
            }
            action={
              filtered ? (
                <ButtonLink href="/customers">
                  <X aria-hidden /> Clear filters
                </ButtonLink>
              ) : canAdd ? (
                <OpenPanelButton panel="new-customer">
                  <Plus aria-hidden /> Add the first customer
                </OpenPanelButton>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Phones: a row per customer — name, one line, the key number. */}
            <PhoneList label="Customers">
              {data.rows.map((c) => (
                <PhoneRow
                  key={c.id}
                  href={show === "archived" ? "/customers?show=archived" : `/customers/${c.id}`}
                  flash={sp.saved === c.id}
                  title={c.code ? `${c.name} · ${c.code}` : c.name}
                  line={`${c.country === UNKNOWN_COUNTRY ? "Country not set" : countryName(c.country)} · ${plural(c.orders, "order")}`}
                  status={
                    show === "archived" ? (
                      <StatusBadge meaning="neutral">Archived</StatusBadge>
                    ) : (
                      <CustomerState c={c} owe={owes.get(c.id)} />
                    )
                  }
                  figure={owed && owes.has(c.id) ? whole(owes.get(c.id)!.total, owed.currency) : undefined}
                />
              ))}
            </PhoneList>
            <DataTable label="Customers" clearParam="saved" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Code</Th>
                  <Th>Customer</Th>
                  <Th>Country</Th>
                  <Th>Currency</Th>
                  <Th className="text-right">Orders</Th>
                  {sold && <Th className="text-right">Sold</Th>}
                  {owed && <Th className="text-right">They owe</Th>}
                  <Th>Status</Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((c) => {
                  const pc = c.primaryContact;
                  const reach = pc
                    ? (pc.email ?? (pc.whatsapp ? "WhatsApp" : (pc.phone ?? (pc.wechat ? `WeChat ${pc.wechat}` : null))))
                    : null;
                  const archived = show === "archived";
                  const cells = (
                    <>
                      <Td>{c.code ? <RefCode>{c.code}</RefCode> : "—"}</Td>
                      <Td>
                        {archived ? (
                          <span className="font-semibold">{c.name}</span>
                        ) : (
                          <Link href={`/customers/${c.id}`} className="font-semibold hover:text-primary">
                            {c.name}
                          </Link>
                        )}
                        <span className="block text-xs text-text-2">
                          {[c.type === "individual" ? PARTY_TYPE_LABEL.individual : null, pc?.name, reach].filter(Boolean).join(" · ") ||
                            "No contact"}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {c.country === UNKNOWN_COUNTRY ? <StatusBadge meaning="warn">Country not set</StatusBadge> : countryName(c.country)}
                      </Td>
                      <Td>{c.defaultCurrency ?? "—"}</Td>
                      <Td className="text-right tabular">{c.orders}</Td>
                      {sold && (
                        <Td className="text-right whitespace-nowrap tabular">
                          {soldBy.has(c.id) && Number(soldBy.get(c.id)!.sales) > 0 ? whole(soldBy.get(c.id)!.sales, sold.currency) : "—"}
                        </Td>
                      )}
                      {owed && (
                        <Td className="text-right font-bold whitespace-nowrap tabular">
                          {owes.has(c.id) ? whole(owes.get(c.id)!.total, owed.currency) : <span className="font-normal">—</span>}
                        </Td>
                      )}
                      <Td>
                        {archived ? (
                          can(me, "customers.delete") && (
                            <ConfirmAction
                              action={restoreCustomerAction.bind(null, c.id)}
                              label="Restore"
                              pendingText="Restoring…"
                              variant="secondary"
                              size="sm"
                              showSuccess={false}
                            />
                          )
                        ) : (
                          <CustomerState c={c} owe={owes.get(c.id)} />
                        )}
                      </Td>
                    </>
                  );
                  return archived ? (
                    <Tr key={c.id}>{cells}</Tr>
                  ) : (
                    <DataRow key={c.id} href={`/customers/${c.id}`} flash={sp.saved === c.id}>
                      {cells}
                    </DataRow>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
      </Card>
      <Pager base="/customers" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />

      {settings && (panel === "new-customer" || editing) && (
        <CustomerPanel
          key={editing?.id ?? "new"}
          action={saveCustomerAction.bind(null, editing?.id ?? null)}
          undo={editing ? undefined : undoNewCustomerAction}
          customer={editing}
          currencies={currenciesFrom(settings)}
        />
      )}
    </div>
  );
}
