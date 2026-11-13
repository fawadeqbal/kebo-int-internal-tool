import { BALANCE_TERMS_LABEL, can, PAYMENT_METHOD_LABEL, ROUTE_NAME, type PaymentRoute } from "@kebo/shared";
import { Badge, RefCode, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { getSettings } from "@/lib/loaders";
import { orderMoneyOf, orderPaymentsOf } from "@/lib/order-data";
import { date, dateTime, money } from "@/lib/format";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { ChangePaymentWindow, ContractWindow, PlanWindow, RecordPaymentWindow, RouteWindow } from "@/components/order-sections/payment-windows";
import { PaymentPlanTable } from "@/components/order-sections/payment-plan";
import { ROW_LINK } from "@/components/order-sections/section-window";
import { LcChecks, UseCredit } from "@/components/money/money-v2";
import { editPaymentAction, removePaymentFileAction, savePlanAction, sendRequestAction } from "../../../money/actions";
import { voidPaymentAction } from "../../../payments/actions";
import { bankContractAction, routeAction } from "../../flow-actions";
import { paymentAction, useCreditAction } from "../../actions";
import { stageData } from "../stage-data";

export const metadata = { title: "Order · payment" };

/** The route the quote's balance terms point to, for a route not chosen yet. */
const SUGGEST: Record<string, PaymentRoute> = {
  letter_of_credit: "letter_of_credit",
  before_shipment: "informal",
  against_bl_copy: "informal",
  after_arrival: "informal",
};
const CONTRACT_WORD: Record<string, string> = { draft: "Draft", opened: "Open", amended: "Amended", documents_presented: "Documents presented", paid: "Paid", closed: "Closed" };

/**
 * Payment (design "the order, final"): how the customer pays, the bank's paper for the routes that have
 * one, the plan and the payments received. The route decides which sections show. Money from the
 * customer is recorded here and nowhere else on the order.
 */
export default async function OrderPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stageData(id, "payment");
  const { me, o, flow, now } = d;
  const [p, m, settings] = await Promise.all([orderPaymentsOf(id), orderMoneyOf(id), getSettings()]);
  const c = o.currency;
  const canPay = can(me, "payments.record") && o.status !== "cancelled";
  const canRoute = can(me, "orders.update") && d.open && !!flow;
  const route = flow?.payment.route ?? null;
  const lc = route === "letter_of_credit";
  const bankRoute = (route === "bank_contract" || lc) && !!flow?.modules.bankContracts;
  const contract = flow?.payment.bankContract ?? null;
  const terms = flow && route ? { balanceWhen: flow.payment.balanceWhen, lcTerms: flow.payment.lcTerms, lcDays: flow.payment.lcDays } : { balanceWhen: o.balanceTerms === "against_bl_copy" ? ("against_bl_copy" as const) : ("before_shipment" as const), lcTerms: null, lcDays: null };
  const sub = `${o.refNo} · ${o.customer.name} · ${money(m.total, c)}`;
  const live = p.payments.filter((x) => !x.voided);
  const paid = Number(p.due) <= 0;
  const balance = (Number(o.money.total) - Number(o.money.deposit)).toFixed(2);
  // Money pays the plan's parts in order: the first open one offers "Record payment". Without one (no plan, or only charges left) the list below does.
  const openPart = m.plan.items.some((i) => i.request.state !== "paid");
  const pay = canPay && !paid ? { action: paymentAction.bind(null, o.id, c), customer: o.customer.name, refNo: o.refNo, due: p.due, depositDue: p.depositDue, fx: { main: settings.sales.currency, rates: settings.sales.exchangeRates }, today: now } : null;
  const record = pay && !openPart && <RecordPaymentWindow main {...pay} currency={c} forWhat={m.plan.next?.label ?? null} />;
  /** The parts of the plan a payment paid ("Deposit 30%"), and its receipt. */
  const paidFor = new Map<string, string[]>();
  for (const i of m.plan.items) for (const r of i.request.receipts) paidFor.set(r.id, [...(paidFor.get(r.id) ?? []), i.label]);
  const canRemove = can(me, "orders.manage");
  const here = `/orders/${o.id}/payment`;

  return (
    <OrderPage id={id}>
      <Section
        title="How they pay"
        cols={4}
        rows={[
          { label: "Route", value: route ? ROUTE_NAME[route] : null },
          { label: "Terms", value: flow?.payment.summary ?? BALANCE_TERMS_LABEL[o.balanceTerms] },
          { label: "Deposit", value: o.money.depositPercent > 0 ? `${o.money.depositPercent}% · ${money(o.money.deposit, c)}` : "None" },
          { label: "Balance", value: o.money.depositPercent < 100 ? `${100 - o.money.depositPercent}% · ${money(balance, c)}` : "None" },
        ]}
        actions={
          canRoute && (
            <RouteWindow
              sub={sub}
              action={routeAction.bind(null, o.id)}
              route={route}
              bankRoutes={!!flow?.modules.bankContracts}
              terms={terms}
              fromQuotation={flow?.payment.fromQuotation}
              suggest={SUGGEST[o.balanceTerms] ?? null}
            />
          )
        }
      />

      {bankRoute &&
        (contract ? (
          <Section
            title={lc ? "The letter of credit" : "The bank contract"}
            state={`${CONTRACT_WORD[contract.status] ?? contract.status}${contract.openedOn ? ` since ${date(contract.openedOn)}` : ""}`}
            tone={contract.status === "paid" || contract.status === "opened" ? "ok" : contract.status === "amended" ? "warn" : "neutral"}
            cols={4}
            rows={[
              { label: lc ? "LC no." : "Contract no.", value: contract.number },
              { label: "Their bank", value: contract.customerBank },
              { label: "Our bank", value: contract.ourBank },
              { label: "Amount", value: contract.amount !== null ? money(String(contract.amount), contract.currency ?? c) : null },
              { label: "Opened on", value: contract.openedOn ? date(contract.openedOn) : null },
              { label: lc ? "Latest shipment" : "Ship by (latest)", value: contract.latestShipOn ? date(contract.latestShipOn) : null },
              { label: "Expires", value: contract.expiresOn ? date(contract.expiresOn) : null },
              { label: lc ? "Terms" : "Note", value: lc ? (flow?.payment.lcTerms === "deferred" ? `Deferred ${flow.payment.lcDays ?? 0} days` : "At sight") : contract.note },
            ]}
            actions={
              canRoute && (
                <ContractWindow sub={sub} action={bankContractAction.bind(null, o.id)} contract={contract} lc={lc} currency={c} orderId={o.id} canFiles={d.canFiles} />
              )
            }
            files={<SectionFiles orderId={o.id} section={lc ? "lc" : "bank_contract"} canAdd={d.canFiles} />}
          >
            {lc && flow?.payment.lcChecks && (
              <div className="border-t border-line px-[18px] py-3">
                <LcChecks checks={flow.payment.lcChecks} />
              </div>
            )}
          </Section>
        ) : (
          <EmptySection
            title={lc ? "The letter of credit" : "The bank contract"}
            text={lc ? "No LC recorded yet." : "No contract recorded yet."}
            action={
              canRoute && <ContractWindow sub={sub} action={bankContractAction.bind(null, o.id)} contract={null} lc={lc} currency={c} orderId={o.id} canFiles={d.canFiles} />
            }
          />
        ))}

      <Section
        title="Payment plan"
        state={paid ? "Paid in full" : `${money(p.due, c)} to come`}
        tone={paid ? "ok" : "warn"}
        actions={m.plan.canEdit && d.open && <PlanWindow sub={sub} action={savePlanAction.bind(null, o.id)} plan={m.plan} currency={c} total={m.total} terms={m.terms} />}
      >
        <div className="flex flex-col gap-3 pb-3.5">
          {!m.plan.matchesTotal && (
            <p className="mx-[18px] rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
              The parts do not add up to the order total ({money(m.plan.difference, c)} {Number(m.plan.difference) > 0 ? "missing" : "too much"}).
            </p>
          )}
          <PaymentPlanTable orderId={o.id} plan={m.plan} currency={c} total={m.total} received={m.received} due={m.due} send={sendRequestAction.bind(null, o.id)} pay={pay} />
          {m.charged.length > 0 && (
            <ul aria-label="Charged to the customer" className="mx-[18px] flex flex-col divide-y divide-line rounded-lg border border-line text-sm">
              {m.charged.map((x) => (
                <li key={x.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="text-text-2">Charged to the customer:</span> {x.description}
                  </span>
                  <span className="font-medium tabular">{money(x.amount, c)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {live.length === 0 && p.payments.length === 0 ? (
        <EmptySection title="Payments received" text={paid ? "Paid in full." : "No payment yet."} action={record} />
      ) : (
        <Section
          title="Payments received"
          state={`${live.length} payment${live.length === 1 ? "" : "s"}`}
          actions={
            <>
              {canPay && p.credit.canUse && <UseCredit action={useCreditAction.bind(null, o.id)} credit={p.credit.amount} due={p.due} currency={c} today={now} />}
              {record}
            </>
          }
          files={<SectionFiles orderId={o.id} section="payments" canAdd={false} />}
        >
          <Table>
            <THead>
              <tr>
                <Th>Date</Th>
                <Th>For</Th>
                <Th>How</Th>
                <Th>Into</Th>
                <Th>Reference</Th>
                <Th>Recorded by</Th>
                <Th className="text-right">Amount</Th>
                <Th>
                  <span className="sr-only">Receipt and change</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {p.payments.map((x) => (
                <Tr key={x.id} className={x.voided ? "text-muted" : undefined}>
                  <Td className={`whitespace-nowrap tabular ${x.voided ? "line-through" : ""}`}>{date(x.paidOn)}</Td>
                  <Td className="font-medium">{x.voided ? <span className="font-normal">{x.voided.reason ?? ""}</span> : (paidFor.get(x.id)?.join(", ") ?? <span className="font-normal text-muted">—</span>)}</Td>
                  <Td>{PAYMENT_METHOD_LABEL[x.method]}</Td>
                  <Td>{x.account?.name ?? <span className="text-muted">—</span>}</Td>
                  <Td>{x.reference ? <RefCode>{x.reference}</RefCode> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-[12.5px] text-text-2">
                    {x.recordedBy?.name ?? "—"}
                    <span className="block text-muted">{dateTime(x.recordedAt)}</span>
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {x.voided ? (
                      <span className="line-through">{money(x.receivedAmount, x.receivedCurrency)}</span>
                    ) : (
                      <>
                        <span className="font-semibold">{money(x.receivedAmount, x.receivedCurrency)}</span>
                        {(x.receivedCurrency !== c || Number(x.bankCharges) > 0) && <span className="block text-xs text-muted">counts for {money(x.counts, c)}</span>}
                      </>
                    )}
                  </Td>
                  <Td className="text-right">
                    {x.voided ? (
                      <Badge tone="neutral">Removed</Badge>
                    ) : (
                      <span className="flex items-center justify-end gap-3">
                        <a href={`/print/orders/${o.id}/payment-receipt?${new URLSearchParams({ ref: x.id, back: here })}`} className={ROW_LINK}>
                          Receipt
                        </a>
                        {(canPay || canRemove) && (
                          <ChangePaymentWindow
                            sub={`${o.refNo} · ${date(x.paidOn)} · ${money(x.receivedAmount, x.receivedCurrency)}`}
                            payment={x}
                            currency={c}
                            today={now}
                            save={canPay ? editPaymentAction.bind(null, o.id, x.id, c) : null}
                            remove={canRemove ? voidPaymentAction.bind(null, `/payments/${x.id}/void`) : null}
                            removeFile={removePaymentFileAction.bind(null, "in", x.id, o.id)}
                            customerId={o.customer.id}
                          />
                        )}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-bold">
                <td className="px-3.5 py-3" colSpan={6}>
                  Received
                </td>
                <td className="px-3.5 py-3 text-right tabular">{money(p.received, c)}</td>
                <td />
              </tr>
            </tfoot>
          </Table>
        </Section>
      )}
    </OrderPage>
  );
}
