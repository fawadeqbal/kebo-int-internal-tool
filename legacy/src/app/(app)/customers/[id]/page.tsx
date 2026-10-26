import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { ClipboardList, Mail, MessageCircle, Phone, Pencil, Plus, Trash2 } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { isUuid } from "@/lib/utils/ids";
import { ACTIVE_MONTHS, customerFinancials, findCustomerFor } from "@/modules/customers/repository";
import { deleteCustomerAction } from "@/modules/customers/actions";
import { listQueriesForCustomer } from "@/modules/queries/repository";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { Avatar, buttonClass, ButtonLink, Card, CardBody, CardHeader, DetailList, EmptyState, PageHeader, Table, Td, Th, THead, Tr } from "@/components/ui";
import { Badge, InvoiceStatusBadge, QueryStatusBadge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/ui/client";
import { formatDate } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { todayISO } from "@/lib/utils/dates";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const customer = isUuid(id) ? await findCustomerFor(user, id) : null;
  if (!customer) notFound();
  const showMoney = can(user.role, "invoices.manage");
  const [queryRows, money, invoiceRows, settings] = await Promise.all([
    listQueriesForCustomer(user, id),
    customerFinancials(id),
    showMoney
      ? db
          .select({ id: invoices.id, invoiceNo: invoices.invoiceNo, currency: invoices.currency, status: invoices.status, total: invoices.total, dueDate: invoices.dueDate, issueDate: invoices.issueDate })
          .from(invoices)
          .where(and(eq(invoices.customerId, id)))
          .orderBy(desc(invoices.issueDate))
      : Promise.resolve([]),
    getSettings(),
  ]);
  const today = todayISO();
  const outstanding = toCents(money.invoiced) - toCents(money.paid);

  return (
    <div className="space-y-5">
      <PageHeader
        title={customerName(customer)}
        description={customer.companyName ? `Contact: ${customer.contactPerson}` : undefined}
        backHref="/customers"
        backLabel="Customers"
        actions={
          <>
            {can(user.role, "customers.manage") && (
              <ButtonLink href={`/customers/${id}/edit`} variant="secondary" size="sm">
                <Pencil aria-hidden /> Edit
              </ButtonLink>
            )}
            {can(user.role, "queries.create") && (
              <ButtonLink href={`/queries/new?customer=${id}`} variant="primary" size="sm">
                <Plus aria-hidden /> New inquiry
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar name={customer.contactPerson} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{customer.contactPerson}</p>
                  <p className="truncate text-xs text-muted">{customer.companyName ?? "No company"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <a href={`tel:${customer.phone}`} className={buttonClass("secondary", "xs")}>
                  <Phone aria-hidden /> Call
                </a>
                <a href={`https://wa.me/${customer.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "xs")}>
                  <MessageCircle aria-hidden /> WhatsApp
                </a>
                {customer.email && (
                  <a href={`mailto:${customer.email}`} className={buttonClass("secondary", "xs")}>
                    <Mail aria-hidden /> Email
                  </a>
                )}
              </div>
              <DetailList
                columns={1}
                items={[
                  {
                    label: "Status",
                    value: customer.active ? (
                      <Badge tone="ok" dot>
                        Active
                      </Badge>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral" dot>
                          Not active
                        </Badge>
                        <span className="text-xs text-muted">No inquiry in {ACTIVE_MONTHS} months and nothing open or unpaid</span>
                      </span>
                    ),
                  },
                  { label: "Phone / WhatsApp", value: <span className="tabular">{customer.phone}</span> },
                  { label: "Email", value: customer.email, hidden: !customer.email },
                  { label: "Address / country", value: customer.address, hidden: !customer.address },
                  { label: "Registration / tax no.", value: customer.taxNo, hidden: !customer.taxNo },
                  { label: "VAT", value: "Exempt: their documents carry no VAT", hidden: !customer.vatExempt },
                  { label: "Notes", value: <span className="whitespace-pre-wrap">{customer.notes}</span>, hidden: !customer.notes },
                ]}
              />
            </CardBody>
          </Card>
          {showMoney && (
            <Card>
              <CardHeader title="Account balance" />
              <CardBody>
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">Invoiced</dt>
                    <dd className="text-text tabular">{formatMoney(money.invoiced, settings.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Received</dt>
                    <dd className="text-text tabular">{formatMoney(money.paid, settings.currency)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-2 font-medium text-text">
                    <dt>Outstanding</dt>
                    <dd className={outstanding > 0 ? "tabular text-warn" : "tabular"}>{formatCents(outstanding, settings.currency)}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}
          {can(user.role, "customers.delete") && queryRows.length === 0 && (
            <form action={deleteCustomerAction.bind(null, id)}>
              <ConfirmSubmit variant="danger-ghost" size="sm" message={`Remove ${customerName(customer)}?`}>
                <Trash2 aria-hidden /> Remove customer
              </ConfirmSubmit>
            </form>
          )}
        </aside>
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="overflow-hidden">
            <CardHeader title="Inquiries" description={`${queryRows.length} from this customer`} />
            {queryRows.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No inquiries from this customer yet" action={can(user.role, "queries.create") && <ButtonLink href={`/queries/new?customer=${id}`} variant="primary" size="sm">New inquiry</ButtonLink>} />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>RFQ no.</Th>
                    <Th>Title</Th>
                    <Th>Status</Th>
                    <Th className="hidden md:table-cell">Handled by</Th>
                    <Th className="hidden sm:table-cell">Received</Th>
                  </tr>
                </THead>
                <tbody>
                  {queryRows.map((q) => (
                    <Tr key={q.id} className="hover:bg-surface-2/70">
                      <Td className="whitespace-nowrap">
                        <Link href={`/queries/${q.id}`} className="font-mono text-[13px] font-medium text-text hover:text-primary hover:underline">
                          {q.refNo}
                        </Link>
                      </Td>
                      <Td className="max-w-[10rem] truncate sm:max-w-72">{q.title}</Td>
                      <Td>
                        <QueryStatusBadge status={q.status} />
                      </Td>
                      <Td className="hidden text-muted md:table-cell">{q.assigneeName ?? "—"}</Td>
                      <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{formatDate(q.createdAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {showMoney && invoiceRows.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Invoices" description={`${invoiceRows.length} issued`} />
              <Table>
                <THead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="hidden sm:table-cell">Issued</Th>
                    <Th>Due</Th>
                  </tr>
                </THead>
                <tbody>
                  {invoiceRows.map((inv) => (
                    <Tr key={inv.id} className="hover:bg-surface-2/70">
                      <Td>
                        <Link href={`/invoices/${inv.id}`} className="font-mono text-[13px] font-medium text-text hover:text-primary hover:underline">
                          {inv.invoiceNo}
                        </Link>
                      </Td>
                      <Td>
                        <InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">{formatMoney(inv.total, inv.currency)}</Td>
                      <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{formatDate(inv.issueDate)}</Td>
                      <Td className="whitespace-nowrap text-text-2">{formatDate(inv.dueDate)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
