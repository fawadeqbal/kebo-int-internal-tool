import Link from "next/link";
import { Mail, Printer } from "lucide-react";
import { can, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { ButtonLink, RefCode } from "@kebo/ui";
import { api } from "@/lib/api";
import { getPeople, getSettings } from "@/lib/loaders";
import { orderMoneyOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date, money } from "@/lib/format";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { ChangeFactoryPaymentWindow, FactoryOrderWindow, PayFactoryWindow } from "@/components/order-sections/factory-windows";
import { SendForm, type PurchaseOrderView } from "@/components/orders/purchase-order-card";
import { OrderLines, PhoneLines } from "@/components/orders/order-lines";
import { PanelButton } from "@/components/orders/step-view";
import { SupplierPlanWindow } from "@/components/money/plan-editor";
import { CustomerMoneyLine, howWePay, SupplierPlanTable, supplierPlanWords } from "@/components/order-sections/supplier-plan";
import { PaymentsList } from "@/components/order-sections/payments-list";
import { ROW_LINK } from "@/components/order-sections/section-window";
import { factoryPaymentAction, factoryPlanAction, removePaymentFileAction, voidFactoryPaymentAction } from "../../../money/actions";
import { sendPurchaseOrderAction } from "../../flow-actions";
import { fieldsAction } from "../../light-actions";
import { stageData } from "../stage-data";
import { orderTitle } from "@/lib/titles";

export const generateMetadata = orderTitle("Factory order");

const SMALL = "h-8 px-2.5 text-[13px]";

/**
 * Factory order (design "the order, final"): the purchase order to each factory, the lines we ordered at
 * the factory's prices, the plan for paying it and the payments made. Money to a factory is recorded
 * here and nowhere else on the order. Factory prices show only to people who may see them.
 */
export default async function OrderFactory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stageData(id, "factory");
  const { me, o, flow, now, defaults } = d;
  const seesMoney = can(me, "sourcing.manage");
  const [m, pos, people, settings] = await Promise.all([
    orderMoneyOf(id),
    optional(() => api.get<{ deposit: { asked: string; paid: string; verified: boolean }; items: PurchaseOrderView[] }>(`/orders/${id}/purchase-orders`)),
    optional(() => getPeople()),
    getSettings(),
  ]);
  const canEdit = can(me, "orders.update") && d.open;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  const canPay = !!m.factories?.canRecord && owing.length > 0 && o.status !== "cancelled";
  const orderedOn = flow?.factory.orderedOn ?? null;
  const orderNo = flow?.factory.orderNo ?? null;
  const basis = defaults.priceBasis ? `${defaults.priceBasis.basis}${defaults.priceBasis.place ? ` ${defaults.priceBasis.place}` : ""}` : null;
  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const priced = goodsLines.some((l) => l.factoryPrice) ? goodsLines : [];
  const payments = m.factories?.payments ?? [];
  const live = payments.filter((x) => !x.voided);
  const plans = m.factories?.plans ?? [];
  const byId = new Map(payments.map((x) => [x.id, x]));
  // What each payment paid: the parts of the plans it went to ("Advance 30%"), as a customer's payment says.
  const paidFor = new Map<string, string[]>();
  for (const plan of plans) for (const r of plan.rows) for (const x of r.payments) paidFor.set(x.id, [...(paidFor.get(x.id) ?? []), r.label]);
  const manyFactories = new Set(payments.map((x) => x.factory.id)).size > 1 || plans.length > 1;
  const madeFor = (x: (typeof payments)[number]) => {
    const parts = paidFor.get(x.id)?.join(", ") ?? null;
    if (!manyFactories) return parts;
    return (
      <>
        {parts ?? <span className="font-normal text-muted">—</span>}
        <span className="block text-xs font-normal text-muted">{x.factory.name}</span>
      </>
    );
  };
  /** The payments added up per currency: "CNY 19,170.00" (two currencies: both). */
  const totalOf = (xs: typeof payments) => {
    const by = new Map<string, number>();
    for (const x of xs) by.set(x.currency, (by.get(x.currency) ?? 0) + Number(x.amount));
    return by.size ? [...by].map(([cur, v]) => money(v.toFixed(2), cur)).join(" + ") : money(0, plans[0]?.currency ?? o.currency);
  };
  const sub = `${o.refNo} · ${(flow?.factory.factories ?? []).map((f) => f.name).join(", ") || "the factory"}`;
  const pay = (label: string, main: boolean, prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance"; reference?: string | null }) =>
    canPay ? (
      <PayFactoryWindow
        label={label}
        main={main}
        sub={sub}
        action={factoryPaymentAction.bind(null, o.id, null, null)}
        factories={owing}
        people={people ?? []}
        orderCurrency={o.currency}
        fx={fx}
        today={now}
        prefill={prefill}
      />
    ) : null;
  // Pay is on each plan's next part, as Record payment is on the customer's; Payments made offers "Pay the
  // factory" only for a factory owed money with no part left to pay it on (prices changed since the plan).
  const onAPart = (f: { factory: { id: string }; currency: string }) =>
    plans.some((p) => p.factory.id === f.factory.id && p.currency === f.currency && p.rows.some((r) => r.status !== "paid" && Number(r.open) > 0));
  const payAny = owing.some((f) => !onAPart(f)) ? pay("Pay the factory", true) : null;
  const editPlan = (plan: (typeof plans)[number], label: string) =>
    m.factories?.canPlan &&
    d.open && (
      <SupplierPlanWindow
        label={label}
        sub={`${o.refNo} · ${plan.factory.name} · ${money(plan.owed, plan.currency)}`}
        action={factoryPlanAction.bind(null, o.id)}
        plan={plan}
        orderedOn={orderedOn}
      />
    );
  const customerLine = m.factories && (
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
  );
  const depositText = pos
    ? Number(pos.deposit.paid) > 0
      ? `${money(pos.deposit.paid, o.currency)} of the deposit ${money(pos.deposit.asked, o.currency)} is recorded; the rest is not in yet.`
      : `The deposit ${money(pos.deposit.asked, o.currency)} is not recorded yet.`
    : "";

  return (
    <OrderPage id={id}>
      {(pos?.items ?? []).map((po, n) => (
        <Section
          key={po.id}
          title={(pos?.items.length ?? 0) > 1 ? `Purchase order · ${po.supplier.name}` : "Purchase order"}
          state={po.sentOn ? (po.sentEarlyReason ? `Sent ${date(po.sentOn)} · before the deposit` : `Sent ${date(po.sentOn)}`) : "Not sent"}
          tone={po.sentOn ? (po.sentEarlyReason ? "warn" : "ok") : "neutral"}
          cols={3}
          rows={[
            { label: "PO no.", value: <RefCode>{po.number}</RefCode> },
            {
              label: "Factory",
              value: (
                <Link href={`/factories/${po.supplier.id}`} className="text-primary hover:underline">
                  {po.supplier.name}
                </Link>
              ),
            },
            ...(seesMoney ? [{ label: "Total", value: po.total && po.currency ? money(po.total, po.currency) : null }] : []),
            ...(seesMoney ? [{ label: "Price basis", value: basis }] : []),
            { label: "Sent on", value: po.sentOn ? `${date(po.sentOn)}${po.sentBy ? ` · ${po.sentBy.name}` : ""}` : null },
            { label: "Their order no.", value: po.supplierRef ?? orderNo },
            ...(po.sentEarlyReason ? [{ label: "Why before the deposit", value: po.sentEarlyReason }] : []),
          ]}
          actions={
            <>
              <ButtonLink href={`/orders/${o.id}/papers/purchase-order?ref=${po.supplier.id}`} size="sm" variant="secondary" className={SMALL}>
                <Printer aria-hidden /> View / print
              </ButtonLink>
              {canEdit && n === 0 && <FactoryOrderWindow orderId={o.id} sub={`${po.number} · ${po.supplier.name}`} action={fieldsAction.bind(null, o.id, "factory")} today={now} orderNo={orderNo} orderedOn={orderedOn} canFiles={d.canFiles} />}
              {canEdit && !po.sentOn && (
                <PanelButton
                  variant="primary"
                  size="sm"
                  className={SMALL}
                  icon={<Mail aria-hidden />}
                  label="Send to the factory"
                  title={`Send ${po.number} to ${po.supplier.name}`}
                  description={[po.total && po.currency && seesMoney ? money(po.total, po.currency) : null, po.readyOn ? `ready by ${date(po.readyOn)}` : null].filter(Boolean).join(" · ") || undefined}
                  panelClassName="md:w-[760px]"
                  body={<SendForm action={sendPurchaseOrderAction.bind(null, o.id, po.id)} deposit={{ verified: pos!.deposit.verified, text: depositText }} today={now} supplierRef={po.supplierRef} />}
                />
              )}
            </>
          }
          files={n === 0 ? <SectionFiles orderId={o.id} section="purchase_order" canAdd={d.canFiles} /> : undefined}
        />
      ))}
      {pos && pos.items.length === 0 && <EmptySection title="Purchase order" text="No line of this order was quoted from a factory, so there is no purchase order." />}

      {plans.length > 0 && (
        <Section
          title="How we pay them"
          cols={4}
          rows={howWePay(plans)}
          actions={plans.length === 1 && editPlan(plans[0]!, "Change")}
        />
      )}

      {plans.map((plan, n) => {
        const owed = m.factories!.rows.find((r) => r.factory.id === plan.factory.id && r.currency === plan.currency);
        const toPay = Number(owed?.toPay ?? 0);
        const paidInOrder = live.filter((x) => x.factory.id === plan.factory.id && x.currency === plan.currency).reduce((t, x) => t + Number(x.inOrderCurrency), 0);
        const done = !!owed && toPay <= 0 && Number(owed.paid) > 0;
        return (
          <Section
            key={`${plan.factory.id}:${plan.currency}`}
            title={plans.length > 1 ? `Payment plan · ${plan.factory.name}` : "Payment plan"}
            titleMore={plans.length > 1 ? undefined : plan.factory.name}
            state={owed ? (done ? "Paid in full" : `${money(owed.toPay, plan.currency)} to pay`) : supplierPlanWords(plan)}
            tone={done ? "ok" : toPay > 0 ? "warn" : "neutral"}
            actions={editPlan(plan, "Edit plan")}
          >
            <div className="flex flex-col gap-3 pb-3.5">
              {plan.differs && (
                <p className="mx-[18px] rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
                  The parts do not add up to what we owe ({money(plan.differs, plan.currency)} {Number(plan.differs) > 0 ? "missing" : "too much"}): prices changed since. Open Edit plan and save it again.
                </p>
              )}
              <SupplierPlanTable
                plan={plan}
                payments={byId}
                pay={(r) => pay("Pay", true, { factoryId: plan.factory.id, amount: r.open, kind: r.dueRule === "on_order" ? "deposit" : "balance", reference: r.supplierRef })}
                orderCurrency={o.currency}
                paidInOrder={paidInOrder ? paidInOrder.toFixed(2) : null}
                overpaid={owed?.overpaid ?? null}
                after={n === 0 && customerLine}
              />
            </div>
          </Section>
        );
      })}

      {m.factories &&
        (payments.length === 0 ? (
          <EmptySection title="Payments made" text="No payment yet." action={payAny} />
        ) : (
          <Section
            title="Payments made"
            state={`${live.length} payment${live.length === 1 ? "" : "s"}`}
            actions={payAny}
            files={<SectionFiles orderId={o.id} section="factory_payments" canAdd={false} />}
          >
            <PaymentsList
              name="Payments made"
              account="From"
              total={{ label: "Paid", amount: totalOf(live) }}
              rows={payments.map((x) => ({
                id: x.id,
                paidOn: x.paidOn,
                for: madeFor(x),
                how: PAYMENT_METHOD_LABEL[x.method],
                account: x.account?.name ?? null,
                reference: x.reference,
                recordedBy: x.recordedBy?.name ?? null,
                recordedAt: x.recordedAt,
                amount: x.amount,
                currency: x.currency,
                voided: x.voided ? { reason: x.voided.reason } : null,
                actions: (
                  <>
                    <Link href={`/payments/supplier/${x.id}`} className={ROW_LINK}>
                      Receipt
                    </Link>
                    {m.factories!.canRecord && o.status !== "cancelled" && (
                      <ChangeFactoryPaymentWindow
                        sub={`${o.refNo} · ${x.factory.name} · ${date(x.paidOn)} · ${money(x.amount, x.currency)}`}
                        payment={x}
                        save={factoryPaymentAction.bind(null, o.id, x.id, x.updatedAt)}
                        remove={voidFactoryPaymentAction.bind(null, o.id, x.id)}
                        removeFile={removePaymentFileAction.bind(null, "out", x.id, o.id)}
                        factories={m.factories!.rows}
                        people={people ?? []}
                        orderCurrency={o.currency}
                        fx={fx}
                        today={now}
                      />
                    )}
                  </>
                ),
              }))}
            />
          </Section>
        ))}

      {priced.length > 0 && (
        <Section title="Lines to the factory" state={`${priced.length} line${priced.length === 1 ? "" : "s"}`}>
          <div className="px-[18px] pb-3.5">
            <div className="max-md:hidden">
              <OrderLines set="factory" orderId={o.id} lines={priced} canEdit={false} today={now} />
            </div>
            <div className="md:hidden">
              <PhoneLines set="factory" lines={priced} />
            </div>
          </div>
        </Section>
      )}
    </OrderPage>
  );
}
