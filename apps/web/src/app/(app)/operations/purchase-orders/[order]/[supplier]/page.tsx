import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Printer } from "lucide-react";
import { PAYMENT_METHOD_LABEL, RECORD_KIND, RECORD_TITLE } from "@kebo/shared";
import { ButtonLink, StatusBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { getPeople, getSettings } from "@/lib/loaders";
import { orderFilesOf, orderMoneyOf, orderOf } from "@/lib/order-data";
import type { OrderView } from "@/lib/types-orders";
import { requirePermission } from "@/lib/session";
import { optional } from "@/components/print/data";
import { date, money, whole } from "@/lib/format";
import { PURCHASE_ORDER_STATUS, PURCHASE_ORDERS, type PurchaseOrderRow } from "@/lib/purchase-orders";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { PayFactoryWindow } from "@/components/order-sections/factory-windows";
import type { PurchaseOrderView } from "@/components/orders/purchase-order-card";
import { OrderLinesView } from "@/components/orders/order-lines";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { CustomerMoneyLine, SupplierPlanTable, supplierPlanWords } from "@/components/order-sections/supplier-plan";
import { PaymentsList } from "@/components/order-sections/payments-list";
import { ROW_LINK } from "@/components/order-sections/section-window";
import { FileToolsProvider } from "@/components/files/file-tools";
import { factoryPaymentAction } from "../../../../money/actions";
import { stageData } from "../../../../orders/[id]/stage-data";
import { cache } from "react";
import { RecordShell } from "@/components/records/record-frame";
import { RecordTop } from "@/components/records/record-page";
import { BoxNote } from "@/components/common/record-box";

/** The order's purchase orders, read once per request (the page and its tab title). */
const purchaseOrdersOf = cache((order: string) => optional(() => api.get<{ items: PurchaseOrderView[] }>(`/orders/${order}/purchase-orders`)));

export async function generateMetadata({ params }: { params: Promise<{ order: string; supplier: string }> }) {
  const { order, supplier } = await params;
  const po = (await purchaseOrdersOf(order))?.items.find((p) => p.supplier.id === supplier);
  if (!po) return { title: "Purchase order" };
  return { title: RECORD_TITLE.purchaseOrder({ items: linesOf(await orderOf(order), supplier), supplier: po.supplier.name }) };
}

/** The supplier's items on the order, at its prices: what this purchase order buys. */
const linesOf = (o: OrderView, supplier: string) => o.lines.filter((l) => l.type === "goods" && l.factoryPrice && l.factory?.id === supplier);

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
    purchaseOrdersOf(order),
    optional(() => api.get<PurchaseOrderRow[]>("/operations/purchase-orders", { all: "true", order })),
    optional(() => getPeople()),
    getSettings(),
    optional(() => orderFilesOf(order)),
  ]);
  const po = pos?.items.find((p) => p.supplier.id === supplier);
  if (!po) notFound();
  const row = rows?.find((r) => r.supplier.id === supplier) ?? null;
  const status = row ? PURCHASE_ORDER_STATUS[row.status] : null;
  const lines = linesOf(o, supplier);
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
  const byId = new Map(payments.map((x) => [x.id, x]));
  // What each payment paid: the parts of the plan it went to, as on the order's Factory order tab.
  const paidFor = new Map<string, string[]>();
  for (const plan of plans) for (const r of plan.rows) for (const x of r.payments) paidFor.set(x.id, [...(paidFor.get(x.id) ?? []), r.label]);
  const totalOf = (xs: typeof payments) => {
    const by = new Map<string, number>();
    for (const x of xs) by.set(x.currency, (by.get(x.currency) ?? 0) + Number(x.amount));
    return by.size ? [...by].map(([cur, v]) => money(v.toFixed(2), cur)).join(" + ") : money(0, plans[0]?.currency ?? po.currency ?? o.currency);
  };
  // The same window as on the order's Factory order tab, for this factory only.
  const pay = (label: string, main: boolean, prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance"; reference?: string | null }) =>
    canPay ? (
      <PayFactoryWindow
        label={label}
        main={main}
        sub={`${po.number} · ${po.supplier.name}`}
        action={factoryPaymentAction.bind(null, o.id, null, null)}
        factories={owing}
        people={people ?? []}
        orderCurrency={o.currency}
        fx={fx}
        today={now}
        prefill={prefill}
      />
    ) : null;
  // Pay is on the plan's next part; "Pay the factory" only when money is owed with no part left to pay it on.
  const payAny = owing.some((f) => !plans.some((p) => p.currency === f.currency && p.rows.some((r) => r.status !== "paid" && Number(r.open) > 0))) ? pay("Pay the supplier", true) : null;
  const sent = po.sentOn ? (po.sentEarlyReason ? `Sent ${date(po.sentOn)} · before the deposit` : `Sent ${date(po.sentOn)}`) : "Not sent";
  const meta = [
    <Link key="f" href={`/suppliers/${po.supplier.id}`} className="hover:underline">
      {po.supplier.name}
    </Link>,
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
      <RecordShell
        top={
          <RecordTop
            header={{
              crumbs: [{ label: "Purchasing" }, { label: "Purchase orders", href: PURCHASE_ORDERS }, { label: po.number }],
              title: RECORD_TITLE.purchaseOrder({ items: lines, supplier: po.supplier.name }),
              record: { kind: RECORD_KIND.purchaseOrder, number: po.number },
              badge: status ? <StatusBadge meaning={status.meaning}>{status.label}</StatusBadge> : undefined,
              summary: (
                <p className="min-w-0">
            {meta.map((x, i) => (
              <span key={i}>
                {i > 0 && (
                  <span aria-hidden className="px-1.5 text-muted">
                    ·
                  </span>
                )}
                {x}
              </span>
            ))}
          </p>
              ),
              actions: (
                <>
            <ButtonLink href={`/orders/${o.id}/papers/purchase-order?ref=${po.supplier.id}`}>
              <Printer aria-hidden /> View / print
            </ButtonLink>
            <ButtonLink href={orderHref}>
              <ExternalLink aria-hidden /> Open the order
            </ButtonLink>
          </>
              ),
            }}
          />
        }
        panelLabel="Beside the purchase order"
        panel={
          <>
          <SidePanelCard>
            <SideSection title="Key dates">
              {(
                [
                  ["Order made", date(o.orderedOn)],
                  ["Sent to the supplier", po.sentOn ? date(po.sentOn) : "—"],
                  ["Goods ready", po.readyOn ? date(po.readyOn) : "—"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 py-1 text-md">
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
                  <li key={`${r.currency}:${k}`} className="flex items-baseline justify-between gap-3 py-1 text-md">
                    <span className="text-text-2">{k}</span>
                    <span className="text-right font-semibold tabular">{v}</span>
                  </li>
                )),
              )}
            </SideSection>
            <SideSection title="People">
              {(
                [
                  ["Supplier", po.supplier.name],
                  ["Customer", o.customer.name],
                  ["Responsible person", o.inquiry.assignee?.name ?? "—"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 py-1 text-md">
                  <span className="text-text-2">{k}</span>
                  <span className="text-right font-semibold">{v}</span>
                </li>
              ))}
            </SideSection>
            <SideSection title="Changed on the order">
              <li className="py-1 text-md">
                <Link href={orderHref} className="font-semibold text-primary hover:underline">
                  Open {o.refNo} › Purchase order
                </Link>
              </li>
            </SideSection>
          </SidePanelCard>
        </>
        }
      >
          <Section
            title="Terms"
            state={sent}
            tone={po.sentOn ? (po.sentEarlyReason ? "warn" : "ok") : "neutral"}
            cols={3}
            rows={[
              {
                label: "Supplier",
                value: (
                  <Link href={`/suppliers/${po.supplier.id}`} className="text-primary hover:underline">
                    {po.supplier.name}
                  </Link>
                ),
              },
              {
                label: "Sales order",
                value: (
                  <>
                    {/* Underlined: in a line of text a link must not be told apart by its colour alone (WCAG 1.4.1). */}
                    <Link href={orderHref} className="text-primary underline underline-offset-2 hover:opacity-80">
                      {o.refNo}
                    </Link>{" "}
                    · {o.customer.name}
                  </>
                ),
              },
              { label: "Their order no.", value: po.supplierRef ?? flow?.factory.orderNo ?? null },
              { label: "Incoterm", value: basis },
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
            <Section title="Items" state={`${lines.length} item${lines.length === 1 ? "" : "s"}`}>
              <OrderLinesView set="factory" lines={lines} label={`${o.refNo} · items to the supplier`} />
            </Section>
          ) : (
            <EmptySection title="Items" text="This supplier's items are on the order." />
          )}

          {plans.map((plan) => {
            const of = owed.find((r) => r.currency === plan.currency);
            const toPay = Number(of?.toPay ?? 0);
            const paidInOrder = live.filter((x) => x.currency === plan.currency).reduce((t, x) => t + Number(x.inOrderCurrency), 0);
            const done = !!of && toPay <= 0 && Number(of.paid) > 0;
            return (
              <Section
                key={plan.currency}
                title="Payment plan"
                state={of ? (done ? "Paid in full" : `${money(of.toPay, plan.currency)} to pay`) : supplierPlanWords(plan)}
                tone={done ? "ok" : toPay > 0 ? "warn" : "neutral"}
              >
                <div className="flex flex-col gap-3 pb-3.5">
                  {plan.differs && (
                    <BoxNote tone="warn">
                      The parts do not add up to what we owe ({money(plan.differs, plan.currency)} {Number(plan.differs) > 0 ? "missing" : "too much"}): prices changed since. Open the order&apos;s Purchase order and save the plan again.
                    </BoxNote>
                  )}
                  <SupplierPlanTable
                    plan={plan}
                    payments={byId}
                    pay={(r) => pay("Pay", true, { factoryId: plan.factory.id, amount: r.open, kind: r.dueRule === "on_order" ? "deposit" : "balance", reference: r.supplierRef })}
                    orderCurrency={o.currency}
                    paidInOrder={paidInOrder ? paidInOrder.toFixed(2) : null}
                    overpaid={of?.overpaid ?? null}
                    after={
                      m.factories && (
                        <CustomerMoneyLine
                          orderId={o.id}
                          state={m.factories.customer.state}
                          warn={m.factories.customer.warn}
                          route={m.route.route}
                          deposit={o.money.depositPercent > 0}
                          received={m.received}
                          owed={(Number(m.received) + Number(m.due)).toFixed(2)}
                          currency={o.currency}
                        />
                      )
                    }
                  />
                </div>
              </Section>
            );
          })}

          {payments.length === 0 ? (
            <EmptySection title="Payments made" text="No payment yet." action={payAny} />
          ) : (
            <Section title="Payments made" state={`${live.length} payment${live.length === 1 ? "" : "s"}`} actions={payAny}>
              <PaymentsList
                name="Payments made"
                account="From"
                total={{ label: "Paid", amount: totalOf(live) }}
                rows={payments.map((x) => ({
                  id: x.id,
                  paidOn: x.paidOn,
                  for: paidFor.get(x.id)?.join(", ") ?? null,
                  how: PAYMENT_METHOD_LABEL[x.method],
                  account: x.account?.name ?? null,
                  reference: x.reference,
                  recordedBy: x.recordedBy?.name ?? null,
                  recordedAt: x.recordedAt,
                  amount: x.amount,
                  currency: x.currency,
                  voided: x.voided ? { reason: x.voided.reason } : null,
                  actions: (
                    <Link href={`/payments/supplier/${x.id}`} className={ROW_LINK}>
                      Receipt
                    </Link>
                  ),
                }))}
              />
            </Section>
          )}

          <Section title="Files" files={<SectionFiles orderId={o.id} section="purchase_order" canAdd={false} />} />
      </RecordShell>
    </FileToolsProvider>
  );
}
