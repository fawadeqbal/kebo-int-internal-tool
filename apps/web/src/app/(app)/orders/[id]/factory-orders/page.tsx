import Link from "next/link";
import { Printer } from "lucide-react";
import { can, FACTORY_ORDER_STATUS_LABEL, type FactoryOrderStatus } from "@kebo/shared";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, DetailList, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money, qty } from "@/lib/format";
import type { OrderView, Paged } from "@/lib/types";
import type { FactoryOrder, FactoryOrderDrafts } from "@/lib/types-orders";
import { FactoryOrderActions, FactoryOrderEditor } from "@/components/orders/factory-order-forms";
import { today } from "@/components/orders/today";
import {
  cancelFactoryOrderAction,
  confirmFactoryOrderAction,
  createFactoryOrderAction,
  sendFactoryOrderAction,
  updateFactoryOrderAction,
  vatInvoiceAction,
} from "./actions";

export const metadata = { title: "Factory orders" };

const TONE: Record<FactoryOrderStatus, "neutral" | "info" | "ok" | "bad"> = {
  draft: "neutral",
  sent: "info",
  confirmed: "ok",
  cancelled: "bad",
};

export default async function FactoryOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  const canManage = can(me.role, "factoryOrders.manage");
  const [o, fos, drafts] = await Promise.all([
    api.get<OrderView>(`/orders/${id}`),
    api.get<FactoryOrder[]>(`/orders/${id}/factory-orders`),
    api.get<FactoryOrderDrafts>(`/orders/${id}/factory-orders/drafts`),
  ]);
  // Every factory, to place an order with one that did not quote (people who manage sourcing only).
  const factories = can(me.role, "sourcing.manage")
    ? await api
        .get<Paged<{ id: string; name: string }>>("/factories", { pageSize: 200 })
        .then((r) => r.rows.map((f) => ({ id: f.id, name: f.name })))
        .catch((e) => {
          if (e instanceof ApiError) return [];
          throw e;
        })
    : [];
  const open = o.status === "open";
  const live = fos.filter((f) => f.status !== "cancelled");
  // Suggested orders: factories that quoted lines of this order and have no live factory order yet.
  const todo = drafts.groups.filter((g) => !live.some((f) => f.factory.id === g.factory.id));
  const withFactory = (f: { id: string; name: string }) => (factories.some((x) => x.id === f.id) ? factories : [f, ...factories]);
  const isNextConfirm = o.plan.next?.key === "factory_confirmed";
  const t = today();

  return (
    <div className="flex flex-col gap-5">
      {open && canManage && (todo.length > 0 || drafts.unsourced.length > 0 || fos.length === 0) && (
        <Card>
          <CardHeader
            title="Place the factory orders"
            description="One purchase order per factory, from the price each factory quoted. Edit quantities and prices before saving."
          />
          <CardBody className="flex flex-col gap-3">
            {todo.map((g, i) => (
              <div key={g.factory.id} className="flex flex-col gap-2">
                <p className="text-sm">
                  <span className="font-medium">{g.factory.name}</span> quoted {g.lines.length} line{g.lines.length === 1 ? "" : "s"} of
                  this order ({g.currency}).
                </p>
                <FactoryOrderEditor
                  action={createFactoryOrderAction.bind(null, o.id)}
                  start={{
                    factoryId: g.factory.id,
                    currency: g.currency,
                    pricesIncludeVat: g.pricesIncludeVat,
                    depositPercent: 30,
                    paymentTerms: null,
                    readyOn: null,
                    notes: null,
                    lines: g.lines,
                  }}
                  factories={withFactory(g.factory)}
                  trigger={`Order from ${g.factory.name}`}
                  title={`Purchase order to ${g.factory.name}`}
                  submitLabel="Save the factory order"
                  defaultOpen={sp.new === "1" && i === 0}
                  triggerVariant={i === 0 ? "primary" : "secondary"}
                />
              </div>
            ))}
            {drafts.unsourced.length > 0 && (
              <Alert tone="warning">
                No factory price was chosen for: {drafts.unsourced.map((u) => u.description.split("\n")[0]).join(", ")}. Add them to a
                factory order by hand.
              </Alert>
            )}
            {factories.length > 0 && (
              <div>
                <FactoryOrderEditor
                  action={createFactoryOrderAction.bind(null, o.id)}
                  start={{
                    factoryId: "",
                    currency: "CNY",
                    pricesIncludeVat: true,
                    depositPercent: 30,
                    paymentTerms: null,
                    readyOn: null,
                    notes: null,
                    lines: drafts.unsourced.length
                      ? drafts.unsourced.map((u) => ({
                          orderLineId: u.orderLineId,
                          factoryQuoteLineId: null,
                          description: u.description,
                          model: null,
                          quantity: 1,
                          unit: "pcs",
                          unitPrice: 0,
                          vatRate: 13,
                        }))
                      : [
                          {
                            orderLineId: null,
                            factoryQuoteLineId: null,
                            description: "",
                            model: null,
                            quantity: 1,
                            unit: "pcs",
                            unitPrice: 0,
                            vatRate: 13,
                          },
                        ],
                  }}
                  factories={factories}
                  trigger="Order from another factory"
                  title="Purchase order to a factory"
                  submitLabel="Save the factory order"
                  triggerVariant="ghost"
                  defaultOpen={sp.new === "1" && todo.length === 0}
                />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {fos.length === 0 ? (
        <Card>
          <EmptyState
            title="No factory orders yet"
            description="Place the order with each factory once the customer's order is confirmed. Sending it ticks “Factory order placed”."
          />
        </Card>
      ) : (
        fos.map((f) => {
          const editable = canManage && open && (f.status === "draft" || f.status === "sent");
          return (
            <Card key={f.id} className={f.status === "cancelled" ? "opacity-70" : undefined}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {f.refNo} · {f.factory.name}
                    <Badge tone={TONE[f.status]} dot>
                      {FACTORY_ORDER_STATUS_LABEL[f.status]}
                    </Badge>
                  </span>
                }
                description={
                  f.sentOn ? `Sent ${date(f.sentOn)}${f.confirmedOn ? ` · confirmed ${date(f.confirmedOn)}` : ""}` : "Not sent yet"
                }
                actions={
                  <Link href={`/print/factory-orders/${f.id}?back=/orders/${o.id}/factory-orders`} className={buttonClass("ghost", "sm")}>
                    <Printer aria-hidden /> Purchase order
                  </Link>
                }
              />
              <CardBody className="flex flex-col gap-4">
                <DetailList
                  columns={3}
                  items={[
                    { label: "Total", value: <span className="font-semibold tabular">{money(f.total, f.currency)}</span> },
                    { label: `Deposit (${f.depositPercent}%)`, value: <span className="tabular">{money(f.deposit, f.currency)}</span> },
                    {
                      label: "Paid / still owed",
                      value: (
                        <span className="tabular">
                          {money(f.paid, f.currency)} /{" "}
                          <span className={Number(f.outstanding) > 0 && f.status !== "cancelled" ? "font-medium" : ""}>
                            {money(f.outstanding, f.currency)}
                          </span>
                        </span>
                      ),
                    },
                    {
                      label: "Ready date",
                      value: f.readyOn ? `${date(f.readyOn)}${f.status === "confirmed" ? " (confirmed)" : " (asked)"}` : "Not confirmed",
                    },
                    {
                      label: "VAT invoice (fapiao)",
                      value: f.vatInvoiceNo ? `${f.vatInvoiceNo} · ${date(f.vatInvoiceOn)}` : "Not received",
                    },
                    { label: "Prices", value: `${f.currency}, ${f.pricesIncludeVat ? "VAT included" : "before VAT"}` },
                    { label: "Payment terms", value: f.paymentTerms, hidden: !f.paymentTerms },
                  ]}
                />
                <Table className="rounded-lg border border-line">
                  <THead>
                    <tr>
                      <Th>Description</Th>
                      <Th className="text-right">Quantity</Th>
                      <Th className="text-right">Unit price</Th>
                      <Th className="text-right">VAT</Th>
                      <Th className="text-right">Line total</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {f.lines.map((l) => (
                      <Tr key={l.id}>
                        <Td>
                          <span className="whitespace-pre-line">{l.description}</span>
                          {l.model && <span className="block text-xs text-muted">{l.model}</span>}
                        </Td>
                        <Td className="text-right whitespace-nowrap tabular">
                          {qty(l.quantity)} {l.unit}
                        </Td>
                        <Td className="text-right whitespace-nowrap tabular">{money(l.unitPrice, f.currency)}</Td>
                        <Td className="text-right tabular">{l.vatRate}%</Td>
                        <Td className="text-right font-medium whitespace-nowrap tabular">{money(l.lineTotal, f.currency)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                {f.notes && <p className="text-sm whitespace-pre-line text-text-2">{f.notes}</p>}
                {canManage && open && (
                  <div className="flex flex-wrap items-start gap-2">
                    {editable && (
                      <FactoryOrderEditor
                        action={updateFactoryOrderAction.bind(null, o.id, f.id)}
                        start={{
                          factoryId: f.factory.id,
                          currency: f.currency,
                          pricesIncludeVat: f.pricesIncludeVat,
                          depositPercent: f.depositPercent,
                          paymentTerms: f.paymentTerms,
                          readyOn: f.readyOn,
                          notes: f.notes,
                          lines: f.lines.map((l) => ({
                            orderLineId: l.orderLineId,
                            factoryQuoteLineId: l.factoryQuoteLineId,
                            description: l.description,
                            model: l.model,
                            quantity: Number(l.quantity),
                            unit: l.unit,
                            unitPrice: Number(l.unitPrice),
                            vatRate: l.vatRate,
                          })),
                        }}
                        factories={withFactory(f.factory)}
                        trigger="Edit"
                        triggerSize="xs"
                        title={`Edit ${f.refNo}`}
                        submitLabel="Save changes"
                        triggerVariant="secondary"
                      />
                    )}
                    <FactoryOrderActions
                      status={f.status}
                      readyOn={f.readyOn}
                      vatInvoiceNo={f.vatInvoiceNo}
                      today={t}
                      send={sendFactoryOrderAction.bind(null, o.id, f.id)}
                      confirm={confirmFactoryOrderAction.bind(null, o.id, f.id)}
                      vat={vatInvoiceAction.bind(null, o.id, f.id)}
                      cancel={can(me.role, "orders.manage") ? cancelFactoryOrderAction.bind(null, o.id, f.id) : null}
                      confirmOpen={isNextConfirm && f.status === "sent"}
                    />
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
