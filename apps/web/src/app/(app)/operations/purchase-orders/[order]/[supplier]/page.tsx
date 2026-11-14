import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Printer, ShoppingCart } from "lucide-react";
import { PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, ButtonLink, PageHeader, RefCode, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { getPeople, getSettings } from "@/lib/loaders";
import { orderFilesOf, orderMoneyOf } from "@/lib/order-data";
import { requirePermission } from "@/lib/session";
import { optional } from "@/components/print/data";
import { date, dateTime, money, whole } from "@/lib/format";
import { PURCHASE_ORDER_STATUS, PURCHASE_ORDERS, type PurchaseOrderRow } from "@/lib/purchase-orders";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { PayFactoryWindow } from "@/components/order-sections/factory-windows";
import type { PurchaseOrderView } from "@/components/orders/purchase-order-card";
import { OrderLines, PhoneLines } from "@/components/orders/order-lines";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { SupplierParts, supplierPlanWords } from "@/components/money/supplier-plan";
import { FileToolsProvider } from "@/components/files/file-tools";
import { factoryPaymentAction } from "../../../../money/actions";
import { stageData } from "../../../../orders/[id]/stage-data";

export const metadata = { title: "Purchase order" };

/**
 * A purchase order's own page (board PDetail): what it says, shown. Its terms, the lines at the factory's
 * prices, the plan for paying the factory and the payments made, its files. A purchase order is made from
 * its sales order and changed there ("Open the order"); the one thing done here is paying the factory, in
 * the same window as on the order.
 */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ order: string; supplier: string }> }) {
  const { order, supplier } = await params;
  await requirePermission("sourcing.manage");
  const d = await stageData(order, "factory");
  const { o, flow, now, defaults } = d;
  const [m, pos, rows, people, settings, files] = await Promise.all([
    orderMoneyOf(order),
    optional(() => api.get<{ items: PurchaseOrderView[] }>(`/orders/${order}/purchase-orders`)),
    optional(() => api.get<PurchaseOrderRow[]>("/operations/purchase-orders", { all: "true", order })),
    optional(() => getPeople()),
    getSettings(),
    optional(() => orderFilesOf(order)),
  ]);
  const po = pos?.items.find((p) => p.supplier.id === supplier);
  if (!po) notFound();
  const row = rows?.find((r) => r.supplier.id === supplier) ?? null;
  const status = row ? PURCHASE_ORDER_STATUS[row.status] : null;
  const lines = o.lines.filter((l) => l.type === "goods" && l.factoryPrice && l.factory?.id === supplier);
  const plans = (m.factories?.plans ?? []).filter((p) => p.factory.id === supplier);
  const owed = (m.factories?.rows ?? []).filter((r) => r.factory.id === supplier);
  const owing = owed.filter((r) => Number(r.toPay) > 0);
  const payments = (m.factories?.payments ?? []).filter((x) => x.factory.id === supplier);
  const live = payments.filter((x) => !x.voided);
  const canPay = !!m.factories?.canRecord && owing.length > 0 && o.status !== "cancelled";
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const basis = defaults.priceBasis ? `${defaults.priceBasis.basis}${defaults.priceBasis.place ? ` ${defaults.priceBasis.place}` : ""}` : null;
  const taxes = [...new Set(lines.map((l) => `${l.factoryPrice!.taxIncluded ? "Tax included" : "Without tax"} · ${Number(l.factoryPrice!.taxRate)}%`))];
  const orderHref = `/orders/${o.id}/factory`;
  // The same window as on the order's Factory order tab, for this factory only.
  const pay = (label: string, main: boolean, prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance" }) =>
    canPay ? (
      <PayFactoryWindow
        label={label}
        main={main}
        sub={`${po.number} · ${po.supplier.name}`}
        action={factoryPaymentAction.bind(null, o.id, null)}
        factories={owing}
        people={people ?? []}
        orderCurrency={o.currency}
        fx={fx}
        today={now}
        prefill={prefill}
      />
    ) : null;
  const sent = po.sentOn ? (po.sentEarlyReason ? `Sent ${date(po.sentOn)} · before the deposit` : `Sent ${date(po.sentOn)}`) : "Not sent";
  const meta = [
    <span key="o">
      for{" "}
      <Link href={orderHref} className="font-medium text-primary hover:underline">
        {o.refNo}
      </Link>
    </span>,
    <Link key="c" href={`/customers/${o.customer.id}`} className="hover:underline">
      {o.customer.name}
    </Link>,
    po.total && po.currency ? <span key="t" className="tabular">{money(po.total, po.currency)}</span> : null,
    <span key="s">{po.sentOn ? `sent ${date(po.sentOn)}` : "not sent yet"}</span>,
  ].filter(Boolean);

  return (
    <FileToolsProvider orderId={o.id} files={files?.files ?? []} targets={files?.targets ?? []} share={{ refNo: o.refNo, greeting: `Dear ${o.customer.name}`, vessel: null, eta: null }}>
      <PageHeader
        crumbs={[{ label: "Purchasing" }, { label: "Purchase orders", href: PURCHASE_ORDERS }, { label: po.number }]}
        icon={ShoppingCart}
        title={`${po.number} · ${po.supplier.name}`}
        summary={
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            {status && <StatusBadge meaning={status.meaning}>{status.label}</StatusBadge>}
            {meta.map((x, i) => (
              <span key={i}>
                {(i > 0 || status) && (
                  <span aria-hidden className="pr-1.5 text-muted">
                    ·
                  </span>
                )}
                {x}
              </span>
            ))}
          </p>
        }
        actions={
          <>
            <ButtonLink href={`/orders/${o.id}/papers/purchase-order?ref=${po.supplier.id}`}>
              <Printer aria-hidden /> View / print
            </ButtonLink>
            <ButtonLink href={orderHref}>
              <ExternalLink aria-hidden /> Open the order
            </ButtonLink>
          </>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title="Terms"
            state={sent}
            tone={po.sentOn ? (po.sentEarlyReason ? "warn" : "ok") : "neutral"}
            cols={3}
            rows={[
              {
                label: "Factory",
                value: (
                  <Link href={`/factories/${po.supplier.id}`} className="text-primary hover:underline">
                    {po.supplier.name}
                  </Link>
                ),
              },
              {
                label: "Sales order",
                value: (
                  <>
                    <Link href={orderHref} className="text-primary hover:underline">
                      {o.refNo}
                    </Link>{" "}
                    · {o.customer.name}
                  </>
                ),
              },
              { label: "Their order no.", value: po.supplierRef ?? flow?.factory.orderNo ?? null },
              { label: "Price basis", value: basis },
              { label: "Currency", value: po.currency },
              { label: "Tax", value: taxes.length ? taxes.join(", ") : null },
              { label: "Lead time", value: defaults.leadTime?.text ?? null },
              { label: "Ready date", value: po.readyOn ? date(po.readyOn) : null },
              { label: "Sent on", value: po.sentOn ? `${date(po.sentOn)}${po.sentBy ? ` · ${po.sentBy.name}` : ""}` : null },
              { label: "Payment", value: plans.length ? plans.map((p) => supplierPlanWords(p)).join(" · ") : null },
              ...(po.sentEarlyReason ? [{ label: "Why before the deposit", value: po.sentEarlyReason }] : []),
            ]}
          />

          {lines.length > 0 ? (
            <Section title="Lines" state={`${lines.length} line${lines.length === 1 ? "" : "s"}`}>
              <div className="px-[18px] pb-3.5">
                <div className="max-md:hidden">
                  <OrderLines set="factory" orderId={o.id} lines={lines} canEdit={false} today={now} />
                </div>
                <div className="md:hidden">
                  <PhoneLines set="factory" lines={lines} />
                </div>
              </div>
            </Section>
          ) : (
            <EmptySection title="Lines" text="This factory's lines are on the order." />
          )}

          {plans.map((plan) => {
            const of = owed.find((r) => r.currency === plan.currency);
            const toPay = Number(of?.toPay ?? 0);
            const paidInOrder = live.filter((x) => x.currency === plan.currency).reduce((t, x) => t + Number(x.inOrderCurrency), 0);
            return (
              <Section
                key={plan.currency}
                title="Payment plan"
                state={of ? (toPay <= 0 && Number(of.paid) > 0 ? "Paid in full" : `${money(of.toPay, plan.currency)} to pay`) : supplierPlanWords(plan)}
                tone={of && toPay <= 0 && Number(of.paid) > 0 ? "ok" : Number(of?.paid ?? 0) > 0 ? "warn" : "neutral"}
              >
                <div className="px-[18px] pb-3.5">
                  <SupplierParts
                    orderId={o.id}
                    plan={plan}
                    pay={(r) => (Number(r.open) > 0 ? pay("Pay", false, { factoryId: plan.factory.id, amount: r.open, kind: r.dueRule === "on_order" ? "deposit" : "balance" }) : null)}
                    paidInOrder={paidInOrder ? paidInOrder.toFixed(2) : null}
                    orderCurrency={o.currency}
                    overpaid={of?.overpaid ?? null}
                    customer={{ route: m.route.route, ...m.factories!.customer, received: m.received, owed: (Number(m.received) + Number(m.due)).toFixed(2) }}
                  />
                </div>
              </Section>
            );
          })}

          {payments.length === 0 ? (
            <EmptySection title="Payments to the factory" text="No payment yet." action={pay("Pay the factory", true)} />
          ) : (
            <Section title="Payments to the factory" state={`${live.length} payment${live.length === 1 ? "" : "s"}`} actions={pay("Pay the factory", true)}>
              <Table>
                <THead>
                  <tr>
                    <Th>Date</Th>
                    <Th>How</Th>
                    <Th>From</Th>
                    <Th className="hidden md:table-cell">Reference</Th>
                    <Th className="hidden sm:table-cell">Recorded by</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </THead>
                <tbody>
                  {payments.map((x) => (
                    <Tr key={x.id} className={x.voided ? "text-muted line-through" : undefined}>
                      <Td className="whitespace-nowrap tabular">{date(x.paidOn)}</Td>
                      <Td>{PAYMENT_METHOD_LABEL[x.method]}</Td>
                      <Td>{x.account?.name ?? <span className="text-muted">—</span>}</Td>
                      <Td className="hidden md:table-cell">{x.reference ? <RefCode>{x.reference}</RefCode> : <span className="text-muted">—</span>}</Td>
                      <Td className="hidden text-[12.5px] text-text-2 sm:table-cell">
                        {x.recordedBy?.name ?? "—"}
                        <span className="block text-muted">{dateTime(x.recordedAt)}</span>
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">
                        {x.voided ? (
                          <>
                            {money(x.amount, x.currency)} <Badge tone="neutral">Removed</Badge>
                          </>
                        ) : (
                          <span className="font-semibold">{money(x.amount, x.currency)}</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}

          <Section title="Files" files={<SectionFiles orderId={o.id} section="purchase_order" canAdd={false} />} />
        </div>

        <aside aria-label="Beside the purchase order" className="flex min-w-0 flex-col gap-4">
          <SidePanelCard>
            <SideSection title="Key dates">
              {(
                [
                  ["Order made", date(o.orderedOn)],
                  ["Sent to the factory", po.sentOn ? date(po.sentOn) : "—"],
                  ["Goods ready", po.readyOn ? date(po.readyOn) : "—"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
                  <span className="text-text-2">{k}</span>
                  <span className="text-right font-semibold tabular">{v}</span>
                </li>
              ))}
            </SideSection>
            <SideSection title="Money">
              {owed.flatMap((r) =>
                (
                  [
                    ["Total", whole(r.owed, r.currency)],
                    ["Paid", whole(r.paid, r.currency)],
                    ["Still to pay", whole(r.toPay, r.currency)],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <li key={`${r.currency}:${k}`} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
                    <span className="text-text-2">{k}</span>
                    <span className="text-right font-semibold tabular">{v}</span>
                  </li>
                )),
              )}
            </SideSection>
            <SideSection title="People">
              {(
                [
                  ["Factory", po.supplier.name],
                  ["Customer", o.customer.name],
                  ["Handles it", o.inquiry.assignee?.name ?? "—"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
                  <span className="text-text-2">{k}</span>
                  <span className="text-right font-semibold">{v}</span>
                </li>
              ))}
            </SideSection>
            <SideSection title="Changed on the order">
              <li className="py-1 text-[13px]">
                <Link href={orderHref} className="font-semibold text-primary hover:underline">
                  Open {o.refNo} › Factory order
                </Link>
              </li>
            </SideSection>
          </SidePanelCard>
        </aside>
      </div>
    </FileToolsProvider>
  );
}
