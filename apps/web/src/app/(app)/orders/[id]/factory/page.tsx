import type { ReactNode } from "react";
import Link from "next/link";
import { Mail, Printer } from "lucide-react";
import { can, PAYMENT_METHOD_LABEL, WARRANTY_FROM_LABEL } from "@kebo/shared";
import { ButtonLink, RefCode, RULES, linkClass, cn, Dash } from "@kebo/ui";
import { api } from "@/lib/api";
import { getPeople, getSettings } from "@/lib/loaders";
import { orderMoneyOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date, dayMonth, money, plural } from "@/lib/format";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import {
  ChangeFactoryPaymentWindow,
  FactoryAgreedWindow,
  FactoryOrderWindow,
  PayFactoryWindow,
} from "@/components/order-sections/factory-windows";
import { BoxFacts } from "@/components/common/record-box";
import { SendForm, type PurchaseOrderView } from "@/components/orders/purchase-order-card";
import { OrderLinesView } from "@/components/orders/order-lines";
import { PanelButton } from "@/components/orders/step-view";
import { SupplierPlanWindow } from "@/components/money/plan-editor";
import { CustomerMoneyLine, SupplierPlanTable, supplierPlanWords, theirInvoices } from "@/components/order-sections/supplier-plan";
import { PaymentsList } from "@/components/order-sections/payments-list";
import { ROW_LINK } from "@/components/order-sections/section-window";
import { factoryPaymentAction, factoryPlanAction, removePaymentFileAction, voidFactoryPaymentAction } from "../../../money/actions";
import { sendPurchaseOrderAction } from "../../flow-actions";
import { factoryTermsAction } from "../../actions";
import { fieldsAction } from "../../light-actions";
import { stageData } from "../stage-data";
import { orderTitle } from "@/lib/titles";
import { BoxNote } from "@/components/common/record-box";

export const generateMetadata = orderTitle("Purchase order");


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
    optional(() =>
      api.get<{ deposit: { asked: string; paid: string; verified: boolean }; items: PurchaseOrderView[] }>(`/orders/${id}/purchase-orders`),
    ),
    optional(() => getPeople()),
    getSettings(),
  ]);
  const canEdit = can(me, "orders.update") && d.open;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  const canPay = !!m.factories?.canRecord && owing.length > 0 && o.status !== "cancelled";
  const orderedOn = flow?.factory.orderedOn ?? null;
  const orderNo = flow?.factory.orderNo ?? null;
  const basis = defaults.priceBasis
    ? `${defaults.priceBasis.basis}${defaults.priceBasis.place ? ` ${defaults.priceBasis.place}` : ""}`
    : null;
  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const priced = goodsLines.some((l) => l.factoryPrice) ? goodsLines : [];
  const payments = m.factories?.payments ?? [];
  const live = payments.filter((x) => !x.voided);
  const plans = m.factories?.plans ?? [];
  const byId = new Map(payments.map((x) => [x.id, x]));
  // What each payment paid: the parts of the plans it went to ("Advance 30%"), as a customer's payment says.
  const paidFor = new Map<string, string[]>();
  for (const plan of plans)
    for (const r of plan.rows) for (const x of r.payments) paidFor.set(x.id, [...(paidFor.get(x.id) ?? []), r.label]);
  const manyFactories = new Set(payments.map((x) => x.factory.id)).size > 1 || plans.length > 1;
  const madeFor = (x: (typeof payments)[number]) => {
    const parts = paidFor.get(x.id)?.join(", ") ?? null;
    if (!manyFactories) return parts;
    return (
      <>
        {parts ?? <Dash />}
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
  const sub = `${o.refNo} · ${(flow?.factory.factories ?? []).map((f) => f.name).join(", ") || "the supplier"}`;
  const pay = (
    label: string,
    main: boolean,
    prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance"; reference?: string | null },
    name?: string,
  ) =>
    canPay ? (
      <PayFactoryWindow
        name={name}
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
    plans.some(
      (p) => p.factory.id === f.factory.id && p.currency === f.currency && p.rows.some((r) => r.status !== "paid" && Number(r.open) > 0),
    );
  const payAny = owing.some((f) => !onAPart(f)) ? pay("Pay the supplier", true) : null;
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
  // Agreed with the factory (design "terms that travel", step 3b): the purchase order's own copy once sent, else
  // its offer's, in the four groups; the payment is its plan's.
  const agreedOf = (po: PurchaseOrderView, many: boolean) => {
    const a = po.agreed;
    if (!a) return null;
    const plan = plans.find((p) => p.factory.id === po.supplier.id);
    const r = a.readyBy;
    const readyNote = !r
      ? null
      : r.by === "drawings"
        ? "Type it on Production once the drawings are approved"
        : r.readyOn
          ? r.by === "advance"
            ? `Worked out: the deposit went ${dayMonth(r.on!)}`
            : `Worked out: ${a.leadDays} days after we ordered`
          : r.by === "advance"
            ? "Worked out once the deposit is paid"
            : "Worked out once we order";
    const invoices = plan ? theirInvoices(plan) : [];
    const from = po.offer ? (po.offer.reference ?? `of ${date(po.offer.receivedOn)}`) : null;
    return (
      <Section
        key={`agreed-${po.id}`}
        id={many ? undefined : "factory-agreed"}
        title={many ? `Agreed with the supplier · ${po.supplier.name}` : "Agreed with the supplier"}
        actions={
          <>
            {a.changes > 0 && (
              <Link
                href={`/orders/${o.id}/history?q=${encodeURIComponent(`${po.number}: what was agreed`)}`}
                className={cn(linkClass, "text-xs")}
              >
                Changed {a.changes}×
              </Link>
            )}
            {canEdit && (
              <FactoryAgreedWindow
                title={`What we agreed with ${po.supplier.name}`}
                sub={`${po.number}${from ? ` · from their offer ${from}` : ""}`}
                action={factoryTermsAction.bind(null, o.id, po.id)}
                sent={!!po.sentOn}
                values={{
                  basis: a.basis,
                  basisPlace: a.basisPlace,
                  leadDays: a.leadDays,
                  leadFrom: a.leadFrom,
                  warrantyMonths: a.warrantyMonths,
                  warrantyFrom: a.warrantyFrom,
                  warranty: a.warranty,
                  paymentNote: a.paymentNote,
                  moq: a.moq,
                  notes: a.notes,
                }}
                payment={
                  plan
                    ? plan.rows.map((x) => `${x.label}${x.status === "paid" ? ", paid" : ""}`).join(" · ")
                    : "The plan is under Payment plan below."
                }
              />
            )}
          </>
        }
      >
        <BoxFacts
          wide
          rows={[
            // Where it came from is a fact of the box, not words in its head (the head keeps only its buttons).
            ...(po.offer ? ([["From their offer", po.offer.reference ?? date(po.offer.receivedOn)]] as [string, ReactNode][]) : []),
            ["Incoterm", a.basis ? `${a.basis}${a.basisPlace ? ` ${a.basisPlace}` : ""}` : null],
            ["Lead time", a.leadTime],
            [
              "Ready by",
              (r && "readyOn" in r && r.readyOn) || readyNote ? (
                <span className="flex flex-col">
                  {r && "readyOn" in r && r.readyOn ? date(r.readyOn) : <Dash />}
                  {readyNote && <span className="text-xs font-normal text-text-2">{readyNote}</span>}
                </span>
              ) : null,
            ],
            [
              "Payment",
              plan ? (
                <span className="flex flex-col gap-0.5">
                  <span>{plural(plan.rows.length, "installment")}</span>
                  {plan.rows.map((x, i) => (
                    <span key={x.id ?? i} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 font-normal">
                      <span className="min-w-0 text-text-2">{x.label}</span>
                      <span className={x.status === "paid" ? "shrink-0 text-ok" : "shrink-0 tabular"}>
                        {x.status === "paid" ? "paid" : money(x.open, plan.currency)}
                      </span>
                    </span>
                  ))}
                </span>
              ) : (
                "Its plan, below"
              ),
            ],
            ...(plan ? ([["Their invoices", invoices.length ? invoices.join(", ") : "none yet"]] as [string, ReactNode][]) : []),
            ["Payment note", a.paymentNote ? <span className="line-clamp-3 whitespace-pre-line">{a.paymentNote}</span> : null],
            [
              "Warranty",
              a.warrantyMonths !== null ? (
                <span className="flex flex-col">
                  <span>{`${a.warrantyMonths} month${a.warrantyMonths === 1 ? "" : "s"}`}</span>
                  <span className="text-xs font-normal text-text-2">
                    from {WARRANTY_FROM_LABEL[a.warrantyFrom ?? "shipment"]}
                    {a.warranty ? ` · ${a.warranty}` : ""}
                  </span>
                </span>
              ) : (
                a.warranty
              ),
            ],
            ["Minimum order", a.moq],
            ["Notes", a.notes ? <span className="line-clamp-4 whitespace-pre-line">{a.notes}</span> : null],
          ]}
        />
      </Section>
    );
  };

  const depositText = pos
    ? Number(pos.deposit.paid) > 0
      ? `${money(pos.deposit.paid, o.currency)} of the deposit ${money(pos.deposit.asked, o.currency)} is recorded; the rest is not in yet.`
      : `The deposit ${money(pos.deposit.asked, o.currency)} is not recorded yet.`
    : "";

  return (
    <OrderPage id={id}>
      {(pos?.items ?? []).map((po, n) => (
        // The purchase order beside what was agreed with its supplier (the supplier offer's two boxes).
        <div key={po.id} className="grid items-start gap-4 lg:grid-cols-2">
          <Section
            title={(pos?.items.length ?? 0) > 1 ? `Purchase order · ${po.supplier.name}` : "Purchase order"}
            state={
              po.sentOn ? (po.sentEarlyReason ? `Sent ${date(po.sentOn)} · before the deposit` : `Sent ${date(po.sentOn)}`) : "Not sent"
            }
            tone={po.sentOn ? (po.sentEarlyReason ? "warn" : "ok") : "neutral"}
            cols={3}
            rows={[
              { label: "Purchase order no.", value: <RefCode>{po.number}</RefCode> },
              {
                label: "Supplier",
                value: (
                  <Link href={`/suppliers/${po.supplier.id}`} className={linkClass}>
                    {po.supplier.name}
                  </Link>
                ),
              },
              ...(seesMoney ? [{ label: "Total", value: po.total && po.currency ? money(po.total, po.currency) : null }] : []),
              ...(seesMoney
                ? [
                    {
                      label: "Incoterm",
                      value: po.offer?.basis ? `${po.offer.basis}${po.offer.basisPlace ? ` ${po.offer.basisPlace}` : ""}` : basis,
                    },
                  ]
                : []),
              { label: "Sent on", value: po.sentOn ? `${date(po.sentOn)}${po.sentBy ? ` · ${po.sentBy.name}` : ""}` : null },
              { label: "Their order no.", value: po.supplierRef ?? orderNo },
              ...(po.offer
                ? [
                    {
                      label: "Made from their offer",
                      value: seesMoney ? (
                        <>
                          <Link
                            href={`/inquiries/${o.inquiry.id}/sourcing?offer=${po.offer.id}#offer`}
                            className="text-primary underline underline-offset-2"
                          >
                            {po.offer.reference ?? "Their offer"}
                          </Link>
                          <span className="font-normal"> · {date(po.offer.receivedOn)}</span>
                        </>
                      ) : (
                        `${po.offer.reference ?? "Their offer"} · ${date(po.offer.receivedOn)}`
                      ),
                    },
                  ]
                : []),
              ...(po.sentEarlyReason ? [{ label: "Why before the deposit", value: po.sentEarlyReason }] : []),
            ]}
            actions={
              <>
                <ButtonLink
                  href={`/orders/${o.id}/papers/purchase-order?ref=${po.supplier.id}`}
                  size="sm"
                  variant="secondary"
                >
                  <Printer aria-hidden /> View / print
                </ButtonLink>
                {canEdit && n === 0 && (
                  <FactoryOrderWindow
                    orderId={o.id}
                    sub={`${po.number} · ${po.supplier.name}`}
                    action={fieldsAction.bind(null, o.id, "factory")}
                    today={now}
                    orderNo={orderNo}
                    orderedOn={orderedOn}
                    canFiles={d.canFiles}
                  />
                )}
                {canEdit && !po.sentOn && (
                  <PanelButton
                    name="send-po"
                    size="sm"
                    icon={<Mail aria-hidden />}
                    label="Send to the supplier"
                    title={`Send ${po.number} to ${po.supplier.name}`}
                    description={
                      [
                        po.total && po.currency && seesMoney ? money(po.total, po.currency) : null,
                        po.readyOn ? `ready by ${date(po.readyOn)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    panelClassName={RULES.window.wideRows}
                    body={
                      <SendForm
                        action={sendPurchaseOrderAction.bind(null, o.id, po.id)}
                        deposit={{ verified: pos!.deposit.verified, text: depositText }}
                        today={now}
                        supplierRef={po.supplierRef}
                        paper={{
                          viewHref: `/orders/${o.id}/papers/purchase-order?ref=${po.supplier.id}`,
                          pdfHref: `/pdf/purchase-order/${o.id}?ref=${po.supplier.id}`,
                          fileName: `${po.number}.pdf`,
                        }}
                      />
                    }
                  />
                )}
              </>
            }
            files={n === 0 ? <SectionFiles orderId={o.id} section="purchase_order" canAdd={d.canFiles} /> : undefined}
          />
          {agreedOf(po, (pos?.items.length ?? 0) > 1)}
        </div>
      ))}
      {pos && pos.items.length === 0 && (
        <EmptySection title="Purchase order" text="No item of this order was quoted from a supplier, so there is no purchase order." />
      )}

      {priced.length > 0 && (
        <Section title="Items to the supplier" state={`${priced.length} item${priced.length === 1 ? "" : "s"}`}>
          <OrderLinesView set="factory" lines={priced} label={`${o.refNo} · items to the supplier`} />
        </Section>
      )}

      {plans.map((plan, n) => {
        const owed = m.factories!.rows.find((r) => r.factory.id === plan.factory.id && r.currency === plan.currency);
        const toPay = Number(owed?.toPay ?? 0);
        const paidInOrder = live
          .filter((x) => x.factory.id === plan.factory.id && x.currency === plan.currency)
          .reduce((t, x) => t + Number(x.inOrderCurrency), 0);
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
                <BoxNote tone="warn">
                  The parts do not add up to what we owe ({money(plan.differs, plan.currency)}{" "}
                  {Number(plan.differs) > 0 ? "missing" : "too much"}): prices changed since. Open Edit plan and save it again.
                </BoxNote>
              )}
              <SupplierPlanTable
                plan={plan}
                payments={byId}
                pay={(r) =>
                  pay("Pay", true, {
                    factoryId: plan.factory.id,
                    amount: r.open,
                    kind: r.dueRule === "on_order" ? "deposit" : "balance",
                    reference: r.supplierRef,
                  }, n === 0 ? "pay-supplier" : undefined)
                }
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
    </OrderPage>
  );
}
