import Link from "next/link";
import { Building2, ChevronRight, Plus, SearchX } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listCustomers } from "@/modules/customers/repository";
import { CUSTOMER_SHOW, CUSTOMER_SORTS, parseCustomerParams } from "@/lib/list-filters";
import { ActiveFilters, Avatar, ButtonLink, EmptyState, PageHeader, SearchField, Table, THead, Td, Th, Tr } from "@/components/ui";
import { FilterSelect, FilterToolbar } from "@/components/ui/filters";
import { ExportMenu } from "@/components/ui/export-menu";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { formatDate } from "@/lib/utils/dates";

export const metadata = { title: "Customers" };

const SHOW = CUSTOMER_SHOW;
const SORTS = CUSTOMER_SORTS;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { filters, params, active } = parseCustomerParams(sp);
  const { q, sort, has } = filters;
  const data = await listCustomers(user, { ...filters, page: toPage(sp.page) });
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/customers", params, { page: undefined, ...patch });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        description="Everyone who has sent an RFQ, by website, WhatsApp, WeChat, email or phone."
        actions={
          <>
            {can(user.role, "customers.export") && <ExportMenu pdfHref={buildHref("/api/export/customers/pdf", params, {})} />}
            <ButtonLink href="/customers/new" variant="primary" size="sm">
              <Plus aria-hidden /> Add customer
            </ButtonLink>
          </>
        }
      />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <FilterToolbar
          activeCount={active.length}
          search={<SearchField defaultValue={q} placeholder="Name, company, phone or email" clearHref={hrefFor({ q: undefined })} label="Search customers" />}
          end={
            <>
              {active.length > 0 && (
                <Link href={buildHref("/customers", { q }, {})} className="font-medium text-muted hover:text-text">
                  Reset
                </Link>
              )}
              <span>{data.total} customers</span>
            </>
          }
        >
          <FilterSelect name="has" label="Show" value={has} options={SHOW} allLabel="Everyone" />
          <FilterSelect name="sort" label="Sort" value={sort} options={SORTS} keepDefault="company" />
        </FilterToolbar>
        <ActiveFilters clearHref={buildHref("/customers", { q }, {})} items={active.map((a) => ({ ...a, removeHref: hrefFor(Object.fromEntries(a.clear.map((k) => [k, undefined]))) }))} />

        {data.rows.length === 0 ? (
          <EmptyState
            icon={q || has ? SearchX : Building2}
            title={q || has ? "No customers match" : "No customers yet"}
            description={q || has ? "Try a different name or number, or remove the filter." : "Customers are added automatically from website RFQs, or when you enter an inquiry."}
            action={
              !q &&
              !has && (
                <ButtonLink href="/customers/new" variant="primary" size="sm">
                  Add customer
                </ButtonLink>
              )
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Phone / WhatsApp</Th>
                    <Th className="hidden lg:table-cell">Email</Th>
                    <Th className="text-right">Inquiries</Th>
                    <Th>Last inquiry</Th>
                  </tr>
                </THead>
                <tbody>
                  {data.rows.map((c) => (
                    <Tr key={c.id} className="group relative hover:bg-surface-2/70">
                      <Td className="py-2">
                        <Link href={`/customers/${c.id}`} className="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0 after:content-['']">
                          <Avatar name={c.contactPerson} size={30} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-text group-hover:text-primary">{c.contactPerson}</span>
                            <span className="block truncate text-xs text-muted">{c.companyName ?? "No company"}</span>
                          </span>
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-text-2 tabular">{c.phone}</Td>
                      <Td className="hidden text-text-2 lg:table-cell">{c.email ?? <span className="text-muted">—</span>}</Td>
                      <Td className="text-right tabular">{c.queryCount}</Td>
                      <Td className="whitespace-nowrap text-muted">{formatDate(c.lastQueryAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {data.rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <Avatar name={c.contactPerson} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{c.contactPerson}</span>
                      <span className="block truncate text-xs text-muted">{c.companyName ?? "No company"}</span>
                      <span className="mt-0.5 block truncate text-xs text-text-2 tabular">{c.phone}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted">
                      <span className="block font-medium text-text tabular">{c.queryCount}</span>
                      {c.queryCount === 1 ? "inquiry" : "inquiries"}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination base="/customers" params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
