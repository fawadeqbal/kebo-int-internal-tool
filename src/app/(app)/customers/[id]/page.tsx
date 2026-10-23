import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { Mail, MapPin, Phone, Pencil, Plus } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { isUuid } from "@/lib/utils/ids";
import { customerFinancials, findCustomer } from "@/modules/customers/repository";
import { deleteCustomerAction } from "@/modules/customers/actions";
import { listQueriesForCustomer } from "@/modules/queries/repository";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { InvoiceStatusBadge, QueryStatusBadge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/ui/client";
import { formatDate } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { todayISO } from "@/lib/utils/dates";

export const metadata = { title: "Buyer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const customer = isUuid(id) ? await findCustomer(id) : null;
  if (!customer) notFound();
  const showMoney = can(user.role, "invoices.manage");
  const [queryRows, money, invoiceRows, settings] = await Promise.all([
    listQueriesForCustomer(user, id),
    customerFinancials(id),
    showMoney
      ? db
          .select({ id: invoices.id, invoiceNo: invoices.invoiceNo, status: invoices.status, total: invoices.total, dueDate: invoices.dueDate, issueDate: invoices.issueDate })
          .from(invoices)
          .where(and(eq(invoices.customerId, id)))
          .orderBy(desc(invoices.issueDate))
      : Promise.resolve([]),
    getSettings(),
  ]);
  const today = todayISO();
  const outstanding = toCents(money.invoiced) - toCents(money.paid);

  return (
    <>
      <PageHeader
        title={customerName(customer)}
        description={customer.companyName ? `Contact: ${customer.contactPerson}` : undefined}
        backHref="/customers"
        backLabel="Buyers"
        actions={
          <>
            {can(user.role, "customers.manage") && (
              <ButtonLink href={`/customers/${id}/edit`} variant="secondary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </ButtonLink>
            )}
            {can(user.role, "queries.create") && (
              <ButtonLink href={`/queries/new?customer=${id}`}>
                <Plus className="h-4 w-4" aria-hidden /> New inquiry
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <p>
                <span className="block text-xs font-medium uppercase tracking-wide text-muted">Full name</span>
                {customer.contactPerson}
              </p>
              <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-2 text-brand-700 hover:underline">
                <Phone className="h-4 w-4" aria-hidden /> {customer.phone}
              </a>
              {customer.email && (
                <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-2 break-all text-brand-700 hover:underline">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden /> {customer.email}
                </a>
              )}
              {customer.address && (
                <p className="inline-flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /> {customer.address}
                </p>
              )}
              {customer.taxNo && (
                <p>
                  <span className="block text-xs font-medium uppercase tracking-wide text-muted">Tax / registration no.</span>
                  {customer.taxNo}
                </p>
              )}
              {customer.notes && (
                <p className="whitespace-pre-wrap rounded-lg bg-canvas p-3 text-muted">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide">Notes</span>
                  {customer.notes}
                </p>
              )}
            </CardBody>
          </Card>
          {showMoney && (
            <Card>
              <CardHeader title="Account balance" />
              <CardBody>
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">Invoiced</dt>
                    <dd className="tabular-nums">{formatMoney(money.invoiced, settings.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Received</dt>
                    <dd className="tabular-nums">{formatMoney(money.paid, settings.currency)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-2 font-semibold">
                    <dt>Outstanding</dt>
                    <dd className={outstanding > 0 ? "tabular-nums text-amber-700" : "tabular-nums"}>{formatCents(outstanding, settings.currency)}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}
          {can(user.role, "customers.delete") && queryRows.length === 0 && (
            <form action={deleteCustomerAction.bind(null, id)}>
              <ConfirmSubmit variant="ghost" size="sm" className="text-red-700" message={`Remove ${customerName(customer)}?`}>
                Remove buyer
              </ConfirmSubmit>
            </form>
          )}
        </aside>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title={`Inquiries (${queryRows.length})`} />
            {queryRows.length === 0 ? (
              <EmptyState title="No inquiries from this buyer yet" action={can(user.role, "queries.create") && <ButtonLink href={`/queries/new?customer=${id}`}>New inquiry</ButtonLink>} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>RFQ no.</Th>
                    <Th>Title</Th>
                    <Th>Status</Th>
                    <Th>Handled by</Th>
                    <Th>Received</Th>
                  </tr>
                </thead>
                <tbody>
                  {queryRows.map((q) => (
                    <tr key={q.id}>
                      <Td className="font-mono text-xs">
                        <Link href={`/queries/${q.id}`} className="font-semibold text-brand-700 hover:underline">
                          {q.refNo}
                        </Link>
                      </Td>
                      <Td>{q.title}</Td>
                      <Td>
                        <QueryStatusBadge status={q.status} />
                      </Td>
                      <Td className="text-muted">{q.assigneeName ?? "—"}</Td>
                      <Td className="text-muted">{formatDate(q.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {showMoney && invoiceRows.length > 0 && (
            <Card>
              <CardHeader title={`Invoices (${invoiceRows.length})`} />
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Issued</Th>
                    <Th>Due</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceRows.map((inv) => (
                    <tr key={inv.id}>
                      <Td>
                        <Link href={`/invoices/${inv.id}`} className="font-medium text-brand-700 hover:underline">
                          {inv.invoiceNo}
                        </Link>
                      </Td>
                      <Td>
                        <InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(inv.total, settings.currency)}</Td>
                      <Td>{formatDate(inv.issueDate)}</Td>
                      <Td>{formatDate(inv.dueDate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
