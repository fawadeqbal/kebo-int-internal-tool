import Link from "next/link";
import { Building2 } from "lucide-react";
import { can, CUSTOMER_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { buildHref, ButtonLink, Card, EmptyState, FilterBar, FilterChip, PageHeader, Pagination, SearchField, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { AutoSelect } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { PartyExcel } from "@/components/sheets/party-excel";
import { importCustomersAction } from "./actions";
import { requireUser } from "@/lib/session";
import { COUNTRIES, countryName } from "@/lib/countries";
import type { Paged } from "@/lib/types";
import type { CustomerRow } from "@/lib/types-people";

export const metadata = { title: "Customers" };

type Params = Record<string, string | undefined>;

/** Customers with their main contact and how much is open with them. Staff see the customers of their own deals. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const country = sp.country?.toUpperCase();
  const data = await api.get<Paged<CustomerRow>>("/customers", { q: sp.q, country, page: toPage(sp.page) });
  const keep = { q: sp.q, country };
  const canAdd = can(me, "customers.manage");
  const filtered = !!(sp.q || country);
  return (
    <div>
      <PageHeader
        title="Customers"
        description={can(me, "inquiries.viewAll") ? "Every buyer, their contacts and what is open with them." : "The customers of the inquiries you handle or created."}
        actions={
          <>
            <PartyExcel kind="customers" importAction={canAdd ? importCustomersAction : undefined} exportHref={buildHref("/sheets/export/customers", {}, keep)} />
            {canAdd && (
              <ButtonLink href="/customers/new" variant="primary">
                New customer
              </ButtonLink>
            )}
          </>
        }
      />
      <Card className="overflow-hidden p-0">
        <FilterBar>
          <form className="flex flex-1 flex-wrap items-center gap-2">
            <SearchField defaultValue={sp.q} placeholder="Search name, contact, email, phone…" clearHref={buildHref("/customers", keep, { q: undefined })} className="min-w-56 flex-1 sm:max-w-80" />
            <AutoSelect name="country" defaultValue={country ?? ""} aria-label="Country" className="w-full sm:w-56">
              <option value="">All countries</option>
              <option value={UNKNOWN_COUNTRY}>Country not set</option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </AutoSelect>
            <button className="sr-only">Search</button>
          </form>
          <FilterChip href={buildHref("/customers", keep, { country: country === UNKNOWN_COUNTRY ? undefined : UNKNOWN_COUNTRY, page: undefined })} active={country === UNKNOWN_COUNTRY}>
            Country not set
          </FilterChip>
        </FilterBar>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={filtered ? "No customers match" : "No customers yet"}
            description={filtered ? "Try another name or country, or clear the filters." : "Customers are added with their first inquiry, or here."}
            action={filtered ? <ButtonLink href="/customers">Clear filters</ButtonLink> : canAdd ? <ButtonLink href="/customers/new">New customer</ButtonLink> : undefined}
          />
        ) : (
          <>
          {/* Phones: one line per customer instead of a wide table. */}
          <ul className="divide-y divide-line sm:hidden">
            {data.rows.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex items-start justify-between gap-3 px-4 py-3 active:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {c.country === UNKNOWN_COUNTRY ? <span className="font-medium text-warn">Country not set</span> : countryName(c.country)}
                      {c.primaryContact && ` · ${c.primaryContact.name}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted tabular">
                    {c.openDeals} {c.openDeals === 1 ? "inquiry" : "inquiries"}
                    <span className="block">
                      {c.openOrders} order{c.openOrders === 1 ? "" : "s"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:table">
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th>Country</Th>
                <Th>Primary contact</Th>
                <Th className="text-right">Open inquiries</Th>
                <Th className="text-right">Open orders</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((c) => {
                const pc = c.primaryContact;
                const reach = pc ? (pc.email ?? pc.whatsapp ?? pc.phone ?? pc.wechat) : null;
                return (
                  <Tr key={c.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/customers/${c.id}`} className="font-medium hover:text-primary">
                        {c.name}
                      </Link>
                      {c.type === "individual" && <span className="block text-xs text-muted">{CUSTOMER_TYPE_LABEL.individual}</span>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {c.country === UNKNOWN_COUNTRY ? (
                        <Link href={`/customers/${c.id}/edit`} className="text-xs font-medium text-warn hover:underline">
                          Country not set
                        </Link>
                      ) : (
                        <span className="text-sm">
                          {countryName(c.country)} <span className="text-xs text-muted">{c.country}</span>
                        </span>
                      )}
                    </Td>
                    <Td>
                      {pc ? (
                        <>
                          <span className="block text-sm">{pc.name}</span>
                          {reach && <span className="block max-w-64 truncate text-xs text-muted">{reach}</span>}
                        </>
                      ) : (
                        <span className="text-xs text-muted">No contact</span>
                      )}
                    </Td>
                    <Td className="text-right tabular">
                      {c.openDeals ? (
                        <Link href={`/inquiries?customer=${c.id}`} className="hover:text-primary">
                          {c.openDeals}
                        </Link>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </Td>
                    <Td className="text-right tabular">{c.openOrders ? c.openOrders : <span className="text-muted">0</span>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          </>
        )}
        {data.total > data.pageSize && <Pagination base="/customers" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />}
      </Card>
    </div>
  );
}
