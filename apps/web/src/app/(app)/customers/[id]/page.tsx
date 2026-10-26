import Link from "next/link";
import { Mail, MessageCircle, Phone, Star } from "lucide-react";
import { can, CUSTOMER_TYPE_LABEL, UNKNOWN_COUNTRY, type OrderStatus } from "@kebo/shared";
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DetailList,
  EmptyState,
  PageHeader,
  StageBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import { countryName } from "@/lib/countries";
import type { CustomerDetail } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { removeCustomerAction } from "../actions";

export const metadata = { title: "Customer" };

const ORDER_STATUS: Record<OrderStatus, { label: string; tone: "info" | "ok" | "neutral" }> = {
  open: { label: "Open", tone: "info" },
  closed: { label: "Closed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const c = await load(() => api.get<CustomerDetail>(`/customers/${id}`));
  const canEdit = can(me.role, "customers.manage");
  const openOrders = c.orders.filter((o) => o.status === "open").length;
  const openDeals = c.inquiries.filter((d) => ["new", "sourcing", "quoted"].includes(d.stage)).length;

  return (
    <div>
      <PageHeader
        backHref="/customers"
        backLabel="Customers"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            {c.type === "individual" && <Badge tone="outline">{CUSTOMER_TYPE_LABEL.individual}</Badge>}
          </span>
        }
        description={
          <>
            {c.country === UNKNOWN_COUNTRY ? <span className="text-warn">Country not set</span> : countryName(c.country)} · {openDeals} open
            deal{openDeals === 1 ? "" : "s"} · {openOrders} open order{openOrders === 1 ? "" : "s"}
          </>
        }
        actions={
          canEdit && (
            <ButtonLink href={`/customers/${c.id}/edit`} size="sm">
              Edit customer
            </ButtonLink>
          )
        }
      />
      {c.country === UNKNOWN_COUNTRY && (
        <p className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm">
          This customer&apos;s country is not set yet.{" "}
          {canEdit ? (
            <Link href={`/customers/${c.id}/edit`} className="font-medium underline">
              Add it
            </Link>
          ) : (
            "Ask someone to add it"
          )}{" "}
          — it decides shipping.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader
              title="Deals"
              description={
                can(me.role, "inquiries.viewAll")
                  ? "Every inquiry from this customer, newest first"
                  : "Their inquiries that you handle or created"
              }
            />
            {c.inquiries.length === 0 ? (
              <EmptyState title="No deals yet" description="Inquiries from this customer will show here." className="py-8" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Deal</Th>
                    <Th>Stage</Th>
                    <Th>Handled by</Th>
                    <Th className="text-right">Received</Th>
                  </tr>
                </THead>
                <tbody>
                  {c.inquiries.map((d) => (
                    <Tr key={d.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Link href={`/deals/${d.id}`} className="font-medium hover:text-primary">
                          {d.refNo}
                        </Link>
                        <span className="block max-w-80 truncate text-xs text-muted">{d.title}</span>
                      </Td>
                      <Td>
                        <StageBadge stage={d.stage} onHold={d.onHold} />
                      </Td>
                      <Td className="text-sm">{d.assignee?.name ?? <span className="text-xs text-warn">Nobody yet</span>}</Td>
                      <Td className="text-right text-xs whitespace-nowrap text-muted">{date(d.createdAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Orders" description="Confirmed orders, newest first" />
            {c.orders.length === 0 ? (
              <EmptyState title="No orders yet" description="An order appears when this customer accepts a quotation." className="py-8" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Ordered</Th>
                  </tr>
                </THead>
                <tbody>
                  {c.orders.map((o) => (
                    <Tr key={o.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Link href={`/orders/${o.id}`} className="font-medium hover:text-primary">
                          {o.refNo}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={ORDER_STATUS[o.status].tone} dot>
                          {ORDER_STATUS[o.status].label}
                        </Badge>
                      </Td>
                      <Td className="text-right tabular">{money(o.total, o.currency)}</Td>
                      <Td className="text-right text-xs whitespace-nowrap text-muted">{date(o.orderedOn)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Contacts" description={`${c.contacts.length} ${c.contacts.length === 1 ? "person" : "people"}`} />
            <CardBody className="p-0">
              {c.contacts.length === 0 ? (
                <p className="p-4 text-sm text-muted">No contacts.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {c.contacts.map((p) => (
                    <li key={p.id} className="px-4 py-3">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {p.name}
                        {p.isPrimary && (
                          <Badge tone="primary">
                            <Star className="fill-current" aria-hidden /> Primary
                          </Badge>
                        )}
                      </p>
                      {p.position && <p className="text-xs text-muted">{p.position}</p>}
                      <ul className="mt-1.5 flex flex-col gap-1 text-sm">
                        {p.email && (
                          <li className="flex items-center gap-2 break-all">
                            <Mail className="size-3.5 shrink-0 text-muted" aria-hidden />
                            <a href={`mailto:${p.email}`} className="hover:text-primary hover:underline">
                              {p.email}
                            </a>
                          </li>
                        )}
                        {p.phone && (
                          <li className="flex items-center gap-2">
                            <Phone className="size-3.5 shrink-0 text-muted" aria-hidden />
                            <a href={`tel:${p.phone}`} className="hover:text-primary hover:underline">
                              {p.phone}
                            </a>
                          </li>
                        )}
                        {p.whatsapp && (
                          <li className="flex items-center gap-2">
                            <MessageCircle className="size-3.5 shrink-0 text-muted" aria-hidden />
                            <a href={waLink(p.whatsapp)} className="hover:text-primary hover:underline" target="_blank" rel="noreferrer">
                              WhatsApp {p.whatsapp !== p.phone ? p.whatsapp : ""}
                            </a>
                          </li>
                        )}
                        {p.wechat && (
                          <li className="flex items-center gap-2 text-text-2">
                            <MessageCircle className="size-3.5 shrink-0 text-muted" aria-hidden />
                            WeChat {p.wechat}
                          </li>
                        )}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  {
                    label: "Country",
                    value:
                      c.country === UNKNOWN_COUNTRY ? (
                        <span className="text-warn">Not known yet</span>
                      ) : (
                        `${countryName(c.country)} (${c.country})`
                      ),
                  },
                  { label: "Address", value: c.address && <span className="whitespace-pre-line">{c.address}</span>, hidden: !c.address },
                  { label: "Currency they pay in", value: c.defaultCurrency },
                  { label: "Business license number", value: c.taxNo, hidden: !c.taxNo },
                  { label: "Reg. number", value: c.regNo, hidden: !c.regNo },
                  { label: "Notes", value: c.notes && <span className="whitespace-pre-line">{c.notes}</span>, hidden: !c.notes },
                  { label: "Added", value: date(c.createdAt) },
                ]}
              />
            </CardBody>
          </Card>

          {can(me.role, "customers.delete") && (
            <Card>
              <CardHeader
                title="Remove customer"
                description="Hides them from lists and pickers. Past deals and orders keep their name. Not possible while an order is open."
              />
              <CardBody>
                <ConfirmAction
                  action={removeCustomerAction.bind(null, c.id)}
                  confirm={`Remove ${c.name}? They will no longer appear in lists.`}
                  label="Remove this customer"
                  pendingText="Removing…"
                  variant="danger-ghost"
                />
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
