import Link from "next/link";
import { Plus } from "lucide-react";
import { can, CUSTOMER_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { buildHref, ButtonLink, Card, DataRow, EmptyState, ListToolbar, PageHeader, Pager, PhoneList, PhoneRow, StatusBadge, Td, Th, THead, toPage } from "@kebo/ui";
import { AutoSelect } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { PartyExcel } from "@/components/sheets/party-excel";
import { DataTable } from "@/components/common/data-table";
import { MoreMenu, RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";
import { importCustomersAction, removeCustomerAction, saveCustomerAction, undoNewCustomerAction } from "./actions";
import { hasFeature, requireUser } from "@/lib/session";
import { COUNTRIES, countryName } from "@/lib/countries";
import type { Paged } from "@/lib/types";
import type { CustomerDetail, CustomerRow } from "@/lib/types-people";
import { CustomerPanel } from "./customer-panel";
import { currenciesFrom, type SalesCurrencies } from "./currencies";

export const metadata = { title: "Customers" };

type Params = Record<string, string | undefined>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Customers (design system: List frame) — the proof page of the building
 * blocks: header with its one primary (New customer, in the side panel),
 * search + chips with counts + Excel in one row, a table whose rows open the
 * customer with ⋯ at the end, 25 a page, every filter in the URL. Staff see
 * the customers of their own deals.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const country = sp.country?.toUpperCase();
  const canAdd = can(me, "customers.manage");
  const keep = { q: sp.q, country };
  const href = (patch: Params) => buildHref("/customers", { ...keep }, { page: undefined, ...patch });

  const panel = canAdd ? sp.panel : undefined;
  const [data, all, notSet, settings, editing, insights] = await Promise.all([
    api.get<Paged<CustomerRow>>("/customers", { q: sp.q, country, page: toPage(sp.page) }),
    // The chips' counts (for the same search).
    country ? api.get<Paged<CustomerRow>>("/customers", { q: sp.q, pageSize: 1 }) : null,
    country === UNKNOWN_COUNTRY ? null : api.get<Paged<CustomerRow>>("/customers", { q: sp.q, country: UNKNOWN_COUNTRY, pageSize: 1 }),
    panel === "new-customer" || panel === "edit-customer" ? api.get<SalesCurrencies>("/settings") : null,
    panel === "edit-customer" && sp.id ? api.get<CustomerDetail>(`/customers/${sp.id}`).catch(() => null) : null,
    can(me, "reports.view") ? hasFeature("insights") : false,
  ]);
  const total = all?.total ?? data.total;
  const unknown = country === UNKNOWN_COUNTRY ? data.total : (notSet?.total ?? 0);
  const filtered = !!(sp.q || country);

  const chips = [
    { key: "all", label: "All", count: total, href: href({ country: undefined }), active: !country },
    ...(unknown || country === UNKNOWN_COUNTRY
      ? [{ key: "unknown", label: "Country not set", count: unknown, href: href({ country: country === UNKNOWN_COUNTRY ? undefined : UNKNOWN_COUNTRY }), active: country === UNKNOWN_COUNTRY }]
      : []),
    ...(country && country !== UNKNOWN_COUNTRY ? [{ key: "country", label: `${countryName(country)} ✕`, count: data.total, href: href({ country: undefined }), active: true }] : []),
  ];

  const rowMenu = (c: CustomerRow): MenuEntry[] => [
    { label: "Open", href: `/customers/${c.id}` },
    ...(canAdd ? [{ label: "Edit", panel: "edit-customer", id: c.id }] : []),
    { label: "Their inquiries", href: `/inquiries?customer=${c.id}` },
    { label: "Copy link", copy: `/customers/${c.id}` },
    ...(canAdd
      ? [
          { separator: true as const },
          {
            label: "Remove…",
            danger: true as const,
            confirm: {
              title: `Remove ${c.name}?`,
              body: "They stay on past inquiries and orders, but no longer appear in lists and pickers.",
              confirmLabel: "Remove",
            },
            action: removeCustomerAction.bind(null, c.id),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        summary={
          <>
            {plural(total, "customer")}
            <span className="max-sm:hidden">
              {can(me, "inquiries.viewAll") ? " · every buyer, their contacts and what is open with them" : " · the customers of the inquiries you handle or created"}
            </span>
          </>
        }
        primary={
          canAdd && (
            <OpenPanelButton panel="new-customer" variant="primary" label="New customer">
              <Plus aria-hidden /> <span className="sm:hidden">New</span>
              <span className="max-sm:hidden">New customer</span>
            </OpenPanelButton>
          )
        }
        more={insights ? <MoreMenu items={[{ label: "Customers in Insights", href: "/insights?tab=customers" }]} /> : undefined}
      />

      <ListToolbar
        search={{ placeholder: "Search name, contact, phone…", value: sp.q, clearHref: href({ q: undefined }) }}
        keep={keep}
        chips={chips}
        label="Filter customers"
        filters={
          !country && (
            <form>
              {sp.q && <input type="hidden" name="q" value={sp.q} />}
              <AutoSelect name="country" defaultValue="" aria-label="Filter by country" className="w-32">
                <option value="">+ Country</option>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </AutoSelect>
            </form>
          )
        }
        end={<PartyExcel kind="customers" importAction={canAdd ? importCustomersAction : undefined} exportHref={buildHref("/sheets/export/customers", {}, keep)} />}
      />

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          <EmptyState
            framed
            title={filtered ? "No customers match" : "No customers yet"}
            description={filtered ? "Try another name or country, or clear the filters." : "Every buyer you quote shows here, with their contacts. They are added with their first inquiry, or here."}
            action={
              filtered ? (
                <ButtonLink href="/customers" size="sm">
                  Clear filters
                </ButtonLink>
              ) : canAdd ? (
                <OpenPanelButton panel="new-customer" size="sm">
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
                  href={`/customers/${c.id}`}
                  flash={sp.saved === c.id}
                  title={c.name}
                  line={`${c.country === UNKNOWN_COUNTRY ? "Country not set" : countryName(c.country)} · ${plural(c.openOrders, "open order")}`}
                  status={c.country === UNKNOWN_COUNTRY ? <StatusBadge meaning="warn">Check country</StatusBadge> : undefined}
                  figure={plural(c.openDeals, "inquiry", "inquiries")}
                />
              ))}
            </PhoneList>
            <DataTable label="Customers" clearParam="saved" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Country</Th>
                  <Th className="text-right">Open inquiries</Th>
                  <Th className="text-right">Open orders</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((c) => {
                  const pc = c.primaryContact;
                  const reach = pc ? (pc.email ? "Email" : pc.whatsapp ? "WhatsApp" : pc.phone ? "Phone" : pc.wechat ? "WeChat" : null) : null;
                  return (
                    <DataRow key={c.id} href={`/customers/${c.id}`} flash={sp.saved === c.id}>
                      <Td>
                        <Link href={`/customers/${c.id}`} className="font-semibold hover:text-primary">
                          {c.name}
                        </Link>
                        <span className="block text-xs text-text-2">
                          {pc ? [pc.name, reach].filter(Boolean).join(" · ") : "No contact"}
                          {c.type === "individual" && ` · ${CUSTOMER_TYPE_LABEL.individual}`}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {c.country === UNKNOWN_COUNTRY ? <StatusBadge meaning="warn">Country not set</StatusBadge> : countryName(c.country)}
                      </Td>
                      <Td className="text-right tabular">{c.openDeals ? c.openDeals : <span className="text-muted">0</span>}</Td>
                      <Td className="text-right tabular">{c.openOrders ? c.openOrders : <span className="text-muted">0</span>}</Td>
                      <Td className="text-right">
                        <RowMenu items={rowMenu(c)} label={`Actions for ${c.name}`} />
                      </Td>
                    </DataRow>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/customers" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>

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
