import { BALANCE_TERMS_LABEL, can, PAYMENT_METHOD_LABEL, PAYMENT_ROUTE_LABEL, type PaymentRoute } from "@kebo/shared";
import { getSettings } from "@/lib/loaders";
import { orderMoneyOf, orderPaymentsOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { ChangePaymentWindow, ContractWindow, RecordPaymentWindow, RouteWindow } from "@/components/order-sections/payment-windows";
import { CustomerPlanWindow } from "@/components/money/plan-editor";
import { PaymentPlanTable } from "@/components/order-sections/payment-plan";
import { PaymentsList } from "@/components/order-sections/payments-list";
import { ROW_LINK } from "@/components/order-sections/section-window";
import { LcChecks, UseCredit } from "@/components/money/money-v2";
import { editPaymentAction, removePaymentFileAction, savePlanAction, sendRequestAction } from "../../../money/actions";
import { voidPaymentAction } from "../../../payments/actions";
import { bankContractAction, routeAction } from "../../flow-actions";
import { paymentAction, submitPaymentAction, useCreditAction } from "../../actions";
import { WaitingToVerify } from "@/components/money/waiting-money";
import { stageData } from "../stage-data";
import { orderTitle } from "@/lib/titles";
import { BoxNote } from "@/components/common/record-box";
import { RULES, cn } from "@kebo/ui";

export const generateMetadata = orderTitle("Payment");

/** The route the quote's balance terms point to, for a route not chosen yet. */
const SUGGEST: Record<string, PaymentRoute> = {
  letter_of_credit: "letter_of_credit",
  before_shipment: "informal",
  against_bl_copy: "informal",
  after_arrival: "informal",
};
const CONTRACT_WORD: Record<string, string> = {
  draft: "Draft",
  opened: "Open",
  amended: "Amended",
  documents_presented: "Documents presented",
  paid: "Paid",
  closed: "Closed",
};

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
  // Staff add money that a manager verifies: the same window, kept waiting until then.
  const canSend = !can(me, "payments.record") && can(me, "money.submit") && o.status !== "cancelled";
  const canRoute = can(me, "orders.update") && d.open && !!flow;
  const route = flow?.payment.route ?? null;
  const lc = route === "letter_of_credit";
  const bankRoute = (route === "bank_contract" || lc) && !!flow?.modules.bankContracts;
  const contract = flow?.payment.bankContract ?? null;
  const terms =
    flow && route
      ? { balanceWhen: flow.payment.balanceWhen, lcTerms: flow.payment.lcTerms, lcDays: flow.payment.lcDays }
      : {
          balanceWhen: o.balanceTerms === "against_bl_copy" ? ("against_bl_copy" as const) : ("before_shipment" as const),
          lcTerms: null,
          lcDays: null,
        };
  const sub = `${o.refNo} · ${o.customer.name} · ${money(m.total, c)}`;
  const live = p.payments.filter((x) => !x.voided);
  const paid = Number(p.due) <= 0;
  const balance = (Number(o.money.total) - Number(o.money.deposit)).toFixed(2);
  // Money pays the plan's parts in order: the first open one offers "Record payment". Without one (no plan, or only charges left) the list below does.
  const openPart = m.plan.items.some((i) => i.request.state !== "paid");
  const pay =
    (canPay || canSend) && !paid
      ? {
          action: (canPay ? paymentAction : submitPaymentAction).bind(null, o.id, c),
          customer: o.customer.name,
          refNo: o.refNo,
          due: p.due,
          depositDue: p.depositDue,
          fx: { main: settings.sales.currency, rates: settings.sales.exchangeRates },
          today: now,
          verify: !canPay,
        }
      : null;
  const record = pay && !openPart && <RecordPaymentWindow main {...pay} currency={c} forWhat={m.plan.next?.label ?? null} />;
  /** The parts of the plan a payment paid ("Deposit 30%"), and its receipt. */
  const paidFor = new Map<string, string[]>();
  for (const i of m.plan.items) for (const r of i.request.receipts) paidFor.set(r.id, [...(paidFor.get(r.id) ?? []), i.label]);
  const canRemove = can(me, "orders.manage");
  const here = `/orders/${o.id}/payment`;

  return (
    <OrderPage id={id}>
      {/* How they pay beside the bank's paper (the routes that have one): two short boxes side by side. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section
          title="How they pay"
          cols={4}
          rows={[
            { label: "Route", value: route ? PAYMENT_ROUTE_LABEL[route] : null },
            { label: "Terms", value: flow?.payment.summary ?? BALANCE_TERMS_LABEL[o.balanceTerms] },
            // A deposit and one balance read as before; a plan of more parts names each (review 24 Nov: 30 / 40 / 30
            // still read "Balance 70%").
            ...(m.plan.items.length > 2
              ? [{ label: "Parts", value: m.plan.items.map((i) => `${i.label} · ${money(i.amount, c)}`).join(" · ") }]
              : [
                  { label: "Deposit", value: o.money.depositPercent > 0 ? `${o.money.depositPercent}% · ${money(o.money.deposit, c)}` : "None" },
                  { label: "Balance", value: o.money.depositPercent < 100 ? `${100 - o.money.depositPercent}% · ${money(balance, c)}` : "None" },
                ]),
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
              // A closed order's contract is not still "Open since…" (review 24 Nov, O-44); "since" only while it is open.
              state={
                o.status !== "open" && !["paid", "closed"].includes(contract.status)
                  ? `Order ${o.status}${contract.openedOn ? ` · opened ${date(contract.openedOn)}` : ""}`
                  : `${CONTRACT_WORD[contract.status] ?? contract.status}${contract.openedOn ? `${contract.status === "opened" ? " since" : " · opened"} ${date(contract.openedOn)}` : ""}`
              }
              tone={o.status !== "open" ? "neutral" : contract.status === "paid" || contract.status === "opened" ? "ok" : contract.status === "amended" ? "warn" : "neutral"}
              cols={4}
              rows={[
                { label: lc ? "LC no." : "Contract no.", value: contract.number },
                { label: "Bank reference", value: contract.reference },
                { label: "Their bank", value: [contract.customerBank, contract.customerBankAddress].filter(Boolean).join(", ") || null },
                { label: "Our bank", value: contract.ourBank },
                { label: "Amount", value: contract.amount !== null ? money(String(contract.amount), contract.currency ?? c) : null },
                { label: "Opened on", value: contract.openedOn ? date(contract.openedOn) : null },
                { label: lc ? "Latest shipment" : "Ship by (latest)", value: contract.latestShipOn ? date(contract.latestShipOn) : null },
                { label: "Expires", value: contract.expiresOn ? date(contract.expiresOn) : null },
                {
                  label: lc ? "Terms" : "Note",
                  value: lc
                    ? flow?.payment.lcTerms === "deferred"
                      ? `Deferred ${flow.payment.lcDays ?? 0} days`
                      : "At sight"
                    : contract.note,
                },
              ]}
              actions={
                canRoute && (
                  <ContractWindow
                    sub={sub}
                    action={bankContractAction.bind(null, o.id)}
                    contract={contract}
                    lc={lc}
                    currency={c}
                    orderId={o.id}
                    canFiles={d.canFiles}
                  />
                )
              }
              files={<SectionFiles orderId={o.id} section={lc ? "lc" : "bank_contract"} canAdd={d.canFiles} />}
            >
              {lc && flow?.payment.lcChecks && (
                <div className={cn(RULES.box.inset, "border-t border-line py-3")}>
                  <LcChecks checks={flow.payment.lcChecks} />
                </div>
              )}
            </Section>
          ) : (
            <EmptySection
              title={lc ? "The letter of credit" : "The bank contract"}
              text={lc ? "No LC recorded yet." : "No contract recorded yet."}
              action={
                canRoute && (
                  <ContractWindow
                    sub={sub}
                    action={bankContractAction.bind(null, o.id)}
                    contract={null}
                    lc={lc}
                    currency={c}
                    orderId={o.id}
                    canFiles={d.canFiles}
                  />
                )
              }
            />
          ))}
      </div>

      {/* Money sent for a manager to verify: its own box above the plan, never a box inside it. */}
      {(canPay || canSend) && <WaitingToVerify orderId={o.id} verifies={canPay} />}

      <Section
        title="Payment plan"
        state={paid ? "Paid in full" : `${money(p.due, c)} to come`}
        tone={paid ? "ok" : "warn"}
        actions={
          m.plan.canEdit &&
          d.open && (
            <CustomerPlanWindow
              sub={sub}
              action={savePlanAction.bind(null, o.id)}
              plan={m.plan}
              currency={c}
              total={m.total}
              customer={o.customer.name}
              today={now}
            />
          )
        }
      >
        <div className="flex flex-col gap-3 pb-3.5">
          {!m.plan.matchesTotal && (
            <BoxNote tone="warn">
              The parts do not add up to the order total ({money(m.plan.difference, c)}{" "}
              {Number(m.plan.difference) > 0 ? "missing" : "too much"}).
            </BoxNote>
          )}
          <PaymentPlanTable
            orderId={o.id}
            plan={m.plan}
            currency={c}
            total={m.total}
            received={m.received}
            due={m.due}
            send={sendRequestAction.bind(null, o.id)}
            pay={pay}
          />
          {m.charged.length > 0 && (
            <ul
              aria-label="Charged to the customer"
              className="flex flex-col divide-y divide-line border-y border-line text-sm"
            >
              {m.charged.map((x) => (
                <li key={x.id} className={cn(RULES.box.inset, "flex items-baseline justify-between gap-3 py-2")}>
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
              {canPay && p.credit.canUse && (
                <UseCredit action={useCreditAction.bind(null, o.id)} credit={p.credit.amount} due={p.due} currency={c} today={now} />
              )}
              {record}
            </>
          }
          files={<SectionFiles orderId={o.id} section="payments" canAdd={false} />}
        >
          <PaymentsList
            name="Payments received"
            account="Into"
            total={{ label: "Received", amount: money(p.received, c) }}
            rows={p.payments.map((x) => ({
              id: x.id,
              paidOn: x.paidOn,
              for: paidFor.get(x.id)?.join(", ") ?? null,
              how: PAYMENT_METHOD_LABEL[x.method],
              account: x.account?.name ?? null,
              reference: x.reference,
              recordedBy: x.recordedBy?.name ?? null,
              recordedAt: x.recordedAt,
              amount: x.receivedAmount,
              currency: x.receivedCurrency,
              note: x.receivedCurrency !== c || Number(x.bankCharges) > 0 ? `counts for ${money(x.counts, c)}` : null,
              voided: x.voided ? { reason: x.voided.reason ?? null } : null,
              actions: (
                <>
                  <a href={`/print/orders/${o.id}/payment-receipt?${new URLSearchParams({ ref: x.id, back: here })}`} className={ROW_LINK}>
                    Receipt
                  </a>
                  {(canPay || canRemove) && (
                    <ChangePaymentWindow
                      sub={`${o.refNo} · ${date(x.paidOn)} · ${money(x.receivedAmount, x.receivedCurrency)}`}
                      payment={x}
                      currency={c}
                      today={now}
                      save={canPay ? editPaymentAction.bind(null, o.id, x.id, c, x.updatedAt) : null}
                      remove={canRemove ? voidPaymentAction.bind(null, `/payments/${x.id}/void`) : null}
                      removeFile={removePaymentFileAction.bind(null, "in", x.id, o.id)}
                      customerId={o.customer.id}
                    />
                  )}
                </>
              ),
            }))}
          />
        </Section>
      )}
    </OrderPage>
  );
}
