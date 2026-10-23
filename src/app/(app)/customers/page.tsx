import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listCustomers } from "@/modules/customers/repository";
import { Button, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
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
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has sent us a query."
        actions={<ButtonLink href="/customers/new">Add customer</ButtonLink>}
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4" role="search">
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
            Search
            <Input id="search" name="q" defaultValue={q} placeholder="Name, company, phone or email" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Sort by
            <Select name="sort" defaultValue={sort} className="w-44">
              <option value="company">Name (A–Z)</option>
              <option value="recent">Most recent query</option>
            </Select>
          </label>
          <Button variant="secondary">Search</Button>
          {q && (
            <Link href="/customers" className="pb-2.5 text-sm text-muted hover:text-ink">
              Clear
            </Link>
          )}
        </form>
        {data.rows.length === 0 ? (
          <EmptyState
            title={q ? "No customers match your search" : "No customers yet"}
            description={q ? "Try a different name or number." : "Add your first customer, or create one directly while entering a query."}
            action={!q && <ButtonLink href="/customers/new">Add customer</ButtonLink>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Company</Th>
                <Th>Phone / WhatsApp</Th>
                <Th>Email</Th>
                <Th className="text-right">Queries</Th>
                <Th>Last query</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.contactPerson}
                    </Link>
                  </Td>
                  <Td className={c.companyName ? "" : "text-muted"}>{c.companyName ?? "—"}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{c.phone}</Td>
                  <Td className="text-muted">{c.email ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{c.queryCount}</Td>
                  <Td className="text-muted">{formatDate(c.lastQueryAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination base="/customers" params={{ q, sort: sort === "company" ? undefined : sort }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
