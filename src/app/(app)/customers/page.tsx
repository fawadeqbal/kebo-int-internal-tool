import Link from "next/link";
import { Building2, Plus, SearchX } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listCustomers } from "@/modules/customers/repository";
import { Avatar, ButtonLink, EmptyState, FilterBar, PageHeader, SearchField, Table, THead, Td, Th, Tr } from "@/components/ui";
import { AutoSelect } from "@/components/ui/client";
import { Pagination, toPage } from "@/components/ui/pagination";
import { formatDate } from "@/lib/utils/dates";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; sort?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const sort = sp.sort === "recent" ? "recent" : "company";
  const data = await listCustomers({ q, page: toPage(sp.page), sort });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        description="Everyone who has sent an RFQ, by website, WhatsApp, WeChat, email or phone."
        actions={
          <ButtonLink href="/customers/new" variant="primary" size="sm">
            <Plus aria-hidden /> Add customer
          </ButtonLink>
        }
      />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <form role="search">
          <FilterBar end={<span className="hidden text-xs text-muted tabular sm:inline">{data.total} customers</span>}>
            <SearchField defaultValue={q} placeholder="Name, company, phone or email" clearHref={sort === "recent" ? "/customers?sort=recent" : "/customers"} label="Search customers" />
            <AutoSelect name="sort" defaultValue={sort} className="w-48" aria-label="Sort by">
              <option value="company">Sort: Name (A–Z)</option>
              <option value="recent">Sort: Most recent inquiry</option>
            </AutoSelect>
          </FilterBar>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={q ? SearchX : Building2}
            title={q ? "No customers match your search" : "No customers yet"}
            description={q ? "Try a different name or number." : "Customers are added automatically from website RFQs, or when you enter an inquiry."}
            action={
              !q && (
                <ButtonLink href="/customers/new" variant="primary" size="sm">
                  Add customer
                </ButtonLink>
              )
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th className="hidden md:table-cell">Phone / WhatsApp</Th>
                <Th className="hidden lg:table-cell">Email</Th>
                <Th className="text-right">Inquiries</Th>
                <Th className="hidden sm:table-cell">Last inquiry</Th>
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
                  <Td className="hidden whitespace-nowrap text-text-2 tabular md:table-cell">{c.phone}</Td>
                  <Td className="hidden text-text-2 lg:table-cell">{c.email ?? <span className="text-muted">—</span>}</Td>
                  <Td className="text-right tabular">{c.queryCount}</Td>
                  <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{formatDate(c.lastQueryAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination base="/customers" params={{ q, sort: sort === "company" ? undefined : sort }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
