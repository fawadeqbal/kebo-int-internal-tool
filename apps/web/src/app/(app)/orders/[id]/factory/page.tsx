import Link from "next/link";
import { Mail, Printer } from "lucide-react";
import { can, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, ButtonLink, RefCode, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { getPeople, getSettings } from "@/lib/loaders";
import { orderMoneyOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date, dateTime, money } from "@/lib/format";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { ChangeFactoryPaymentWindow, FactoryOrderWindow, PayFactoryWindow } from "@/components/order-sections/factory-windows";
import { SendForm, type PurchaseOrderView } from "@/components/orders/purchase-order-card";
import { OrderLines, PhoneLines } from "@/components/orders/order-lines";
import { PanelButton } from "@/components/orders/step-view";
import { FactoryPlanForm } from "@/components/money/money-v2";
import { SupplierParts, supplierPlanWords } from "@/components/money/supplier-plan";
import { factoryPaymentAction, factoryPlanAction, removePaymentFileAction, voidFactoryPaymentAction } from "../../../money/actions";
import { sendPurchaseOrderAction } from "../../flow-actions";
import { fieldsAction } from "../../light-actions";
import { stageData } from "../stage-data";

export const metadata = { title: "Order · factory order" };

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
  const sub = `${o.refNo} · ${(flow?.factory.factories ?? []).map((f) => f.name).join(", ") || "the factory"}`;
  const pay = (label: string, main: boolean, prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance" }) =>
    canPay ? (
      <PayFactoryWindow
        label={label}
        main={main}
        sub={sub}
        action={factoryPaymentAction.bind(null, o.id, null)}
        factories={owing}
        people={people ?? []}
        orderCurrency={o.currency}
        fx={fx}
        today={now}
        prefill={prefill}
      />
    ) : null;
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

      {m.factories?.plans.map((plan) => {
        const paidInOrder = live.filter((x) => x.factory.id === plan.factory.id && x.currency === plan.currency).reduce((t, x) => t + Number(x.inOrderCurrency), 0);
        const owed = m.factories!.rows.find((r) => r.factory.id === plan.factory.id && r.currency === plan.currency);
        const toPay = Number(owed?.toPay ?? 0);
        return (
          <Section
            key={`${plan.factory.id}:${plan.currency}`}
            title={m.factories!.plans.length > 1 ? `Paying ${plan.factory.name}` : "Paying the factory"}
            state={owed ? (toPay <= 0 && Number(owed.paid) > 0 ? "Paid in full" : `${money(owed.toPay, plan.currency)} to pay`) : supplierPlanWords(plan)}
            tone={owed && toPay <= 0 && Number(owed.paid) > 0 ? "ok" : Number(owed?.paid ?? 0) > 0 ? "warn" : "neutral"}
            actions={
              m.factories?.canPlan &&
              d.open && (
                <PanelButton
                  size="sm"
                  className={SMALL}
                  label="Edit plan"
                  title={`What we pay ${plan.factory.name}`}
                  description={`${o.refNo} · agreed once per factory on the order`}
                  panelClassName="md:w-[640px]"
                  body={<FactoryPlanForm plan={plan} action={factoryPlanAction.bind(null, o.id)} />}
                />
              )
            }
          >
            <div className="px-[18px] pb-3.5">
              <SupplierParts
                orderId={o.id}
                plan={plan}
                pay={(r) => (Number(r.open) > 0 ? pay("Pay", false, { factoryId: plan.factory.id, amount: r.open, kind: r.dueRule === "on_order" ? "deposit" : "balance" }) : null)}
                paidInOrder={paidInOrder ? paidInOrder.toFixed(2) : null}
                orderCurrency={o.currency}
                overpaid={owed?.overpaid ?? null}
                customer={{ route: m.route.route, ...m.factories!.customer, received: m.received, owed: (Number(m.received) + Number(m.due)).toFixed(2) }}
              />
            </div>
          </Section>
        );
      })}

      {m.factories &&
        (payments.length === 0 ? (
          <EmptySection title="Payments to the factory" text="No payment yet." action={pay("Pay the factory", true)} />
        ) : (
          <Section
            title="Payments to the factory"
            state={`${live.length} payment${live.length === 1 ? "" : "s"}`}
            actions={pay("Pay the factory", true)}
            files={<SectionFiles orderId={o.id} section="factory_payments" canAdd={false} />}
          >
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>Factory</Th>
                  <Th>How</Th>
                  <Th>From</Th>
                  <Th>Reference</Th>
                  <Th>Recorded by</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>
                    <span className="sr-only">Change</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {payments.map((x) => (
                  <Tr key={x.id} className={x.voided ? "text-muted line-through" : undefined}>
                    <Td className="whitespace-nowrap tabular">{date(x.paidOn)}</Td>
                    <Td>{x.factory.name}</Td>
                    <Td>{PAYMENT_METHOD_LABEL[x.method]}</Td>
                    <Td>{x.account?.name ?? <span className="text-muted">—</span>}</Td>
                    <Td>{x.reference ? <RefCode>{x.reference}</RefCode> : <span className="text-muted">—</span>}</Td>
                    <Td className="text-[12.5px] text-text-2">
                      {x.recordedBy?.name ?? "—"}
                      <span className="block text-muted">{dateTime(x.recordedAt)}</span>
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">{x.voided ? money(x.amount, x.currency) : <span className="font-semibold">{money(x.amount, x.currency)}</span>}</Td>
                    <Td className="text-right">
                      {x.voided ? (
                        <Badge tone="neutral">Removed</Badge>
                      ) : (
                        m.factories!.canRecord &&
                        o.status !== "cancelled" && (
                          <ChangeFactoryPaymentWindow
                            sub={`${o.refNo} · ${x.factory.name} · ${date(x.paidOn)} · ${money(x.amount, x.currency)}`}
                            payment={x}
                            save={factoryPaymentAction.bind(null, o.id, x.id)}
                            remove={voidFactoryPaymentAction.bind(null, o.id, x.id)}
                            removeFile={removePaymentFileAction.bind(null, "out", x.id, o.id)}
                            factories={m.factories!.rows}
                            people={people ?? []}
                            orderCurrency={o.currency}
                            fx={fx}
                            today={now}
                          />
                        )
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        ))}
    </OrderPage>
  );
}
