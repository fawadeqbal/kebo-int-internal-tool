import { ArrowDownLeft } from "lucide-react";
import { BALANCE_TERMS_LABEL, can, PAYMENT_ROUTE_LABEL, type PaymentRoute } from "@kebo/shared";
import { CardBody } from "@kebo/ui";
import { orderMoneyOf, orderPaymentsOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { StepPage, StepViewDivider } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { DetailsCard, ViewCard, type DetailField } from "@/components/orders/step-view";
import { PaymentEdit } from "@/components/orders/view-panels";
import { expensePayTools } from "@/components/orders/costs-card";
import { PaymentPlan } from "@/components/money/forms";
import { LcChecks, PlanLines, UseCredit } from "@/components/money/money-v2";
import { RecordPaymentLink, ViewPaymentsLink } from "@/components/money/pay-links";
import { savePlanAction } from "../../../money/actions";
import { bankContractAction, routeAction } from "../../flow-actions";
import { fieldsAction, lightAction } from "../../light-actions";
import { useCreditAction } from "../../actions";
import { CustomerSummary, MoneySection } from "../money-sections";
import { stepData } from "../step-data";
import { termsOf } from "../shared";

export const metadata = { title: "Order · payment" };

/** The route the quote's balance terms point to, for a route not chosen yet. */
const SUGGEST: Record<string, PaymentRoute> = {
  letter_of_credit: "letter_of_credit",
  before_shipment: "informal",
  against_bl_copy: "informal",
  after_arrival: "informal",
};

/**
 * Step 1, Payment: the checklist (route, LC, deposit), then the view: how they
 * pay, the plan, the payments received, the papers and the costs.
 */
export default async function OrderPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "payment");
  const { me, o, flow, now, defaults } = d;
  const [p, m] = await Promise.all([orderPaymentsOf(id), orderMoneyOf(id)]);
  const c = o.currency;
  const canPay = can(me, "payments.record") && d.open;
  const canRoute = can(me, "orders.update") && d.open && !!flow;
  const route = flow?.payment.route ?? null;
  const lc = route === "letter_of_credit";
  const bankRoute = (route === "bank_contract" || lc) && !!flow?.modules.bankContracts;
  const contract = flow?.payment.bankContract ?? null;
  const terms = flow ? { balanceWhen: flow.payment.balanceWhen, lcTerms: flow.payment.lcTerms, lcDays: flow.payment.lcDays } : undefined;
  // Money in is recorded on Treasury › Payments (one form); here it is a link with the order filled in.
  const pay = (label: string, quiet = true) =>
    canPay ? <RecordPaymentLink kind="in" order={o.id} back={`/orders/${o.id}/payment`} label={label} quiet={quiet} /> : null;

  const tools: Record<string, AutoTool> = {};
  if (canRoute)
    tools.route = {
      kind: "route",
      label: "Choose",
      action: routeAction.bind(null, o.id),
      route,
      bankRoutes: !!flow?.modules.bankContracts,
      terms: route
        ? terms
        : { balanceWhen: o.balanceTerms === "against_bl_copy" ? "against_bl_copy" : "before_shipment", lcTerms: null, lcDays: null },
      suggest: SUGGEST[o.balanceTerms] ?? null,
    };
  if (canRoute && bankRoute) {
    const banks = defaults.banks;
    const balance = (Number(o.money.total) - Number(o.money.deposit)).toFixed(2);
    tools.contract = {
      kind: "light",
      label: contract ? (lc ? "Open the LC" : "Open the contract") : lc ? "Add the LC" : "Add the contract",
      action: lightAction.bind(null, o.id, "contract"),
      fields: [
        {
          name: "number",
          label: lc ? "LC no." : "Contract no.",
          value: contract?.number,
          required: true,
          placeholder: lc ? "e.g. LC/HBL/2026/118" : undefined,
        },
        {
          name: "amount",
          label: `Amount, ${contract?.currency ?? c}`,
          type: "number",
          value: contract?.amount !== null && contract?.amount !== undefined ? String(contract.amount) : balance,
          required: true,
        },
        { name: "expiresOn", label: lc ? "Expires" : "Expires (if it does)", type: "date", value: contract?.expiresOn, required: lc },
        {
          name: "customerBank",
          label: "Their bank",
          value: contract?.customerBank ?? banks?.customerBank,
          hint: !contract?.customerBank && banks?.customerBank ? `As on ${banks.refNo}` : undefined,
        },
        {
          name: "ourBank",
          label: "Our bank",
          value: contract?.ourBank ?? banks?.ourBank,
          hint: !contract?.ourBank && banks?.ourBank ? `As on ${banks.refNo}` : undefined,
        },
      ],
      chips: [
        { label: "Opened on", field: { name: "openedOn", label: "Opened on", type: "date", value: contract?.openedOn ?? now, max: now } },
        ...(lc
          ? [
              {
                label: "Ship by",
                field: { name: "latestShipOn", label: "Ship by (latest)", type: "date" as const, value: contract?.latestShipOn },
              },
            ]
          : []),
        { label: lc ? "LC copy" : "Contract copy", field: { name: "attachmentId", label: lc ? "LC copy" : "Contract copy", type: "file" } },
        { label: "Note", field: { name: "itemNote", label: "Note", type: "textarea" } },
      ],
      save: "Save and tick",
      hint: `Only the first ${lc ? "three" : "two"} are needed; it is checked against the order.`,
    };
  }
  const depositPay = pay("Record payment");
  if (depositPay) tools.deposit_in = { kind: "node", node: depositPay };

  // How they pay: the route and its terms, and on a bank route the LC or contract (+ Add each value).
  const fields: DetailField[] = [
    {
      label: "Route",
      // The order started on the route the quotation's terms implied: said so, and changeable.
      value: route ? PAYMENT_ROUTE_LABEL[route].replace(/ \(.*\)$/, "") : null,
      show: route ? (
        <span>
          {PAYMENT_ROUTE_LABEL[route].replace(/ \(.*\)$/, "")}
          {flow?.payment.fromQuotation && <span className="font-normal text-text-2"> · from the quotation</span>}
        </span>
      ) : null,
    },
    {
      label: "Deposit",
      // The deposit the plan asks for; the % accepted on the quotation beside it when the plan was changed.
      value:
        o.money.depositPercent > 0
          ? `${o.money.depositPercent}% · ${money(o.money.deposit, c)}${o.money.depositPercent !== o.depositPercent ? ` (plan; ${o.depositPercent}% as accepted)` : ""}`
          : "None",
    },
    { label: "Balance", value: flow?.payment.summary ?? BALANCE_TERMS_LABEL[o.balanceTerms] },
  ];
  if (bankRoute)
    fields.push(
      { name: "number", label: lc ? "LC no." : "Contract no.", value: contract?.number },
      {
        name: "amount",
        label: lc ? "LC amount" : "Amount",
        type: "number",
        value: contract?.amount !== null && contract?.amount !== undefined ? String(contract.amount) : null,
        show: contract?.amount !== null && contract?.amount !== undefined ? money(String(contract.amount), contract.currency ?? c) : null,
      },
      { name: "customerBank", label: "Their bank", value: contract?.customerBank },
      { name: "ourBank", label: "Our bank", value: contract?.ourBank },
      ...(lc ? [{ name: "latestShipOn", label: "Ship by", type: "date" as const, value: contract?.latestShipOn }] : []),
      { name: "expiresOn", label: "Expires", type: "date", value: contract?.expiresOn, uncounted: !lc },
    );
  const shown = fields.map((f) => (f.type === "date" && f.value ? { ...f, show: date(f.value) } : f));

  return (
    <StepPage
      steps={d.steps}
      step="payment"
      base={d.base}
      action={pay("Record a payment", false)}
      side={<StepSidePanel id={o.id} step="payment" changes={d.changes} historyHref={d.historyHref} />}
    >
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="payment"
        label="Payment"
        items={d.items}
        current={d.current}
        nowKey={d.nowKey}
        waits={d.waits}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        payNode={pay("Record payment")}
        listHref={d.listHref}
        me={me.name}
        today={now}
      />
      <StepViewDivider />
      <DetailsCard
        id="route"
        target="payment"
        title="How they pay"
        description={
          route
            ? undefined
            : canRoute
              ? "No route yet: choose it in the checklist above, or Edit."
              : "The route is chosen in the checklist above."
        }
        fields={shown}
        action={bankRoute ? fieldsAction.bind(null, o.id, "contract") : undefined}
        canEdit={canRoute}
        panelTitle="Edit how they pay"
        panelDescription="The route decides the plan, the papers and the bank steps. Change it and the plan is rebuilt (payments already recorded stay)."
        panelBody={
          flow ? (
            <PaymentEdit
              routeAction={routeAction.bind(null, o.id)}
              contractAction={bankContractAction.bind(null, o.id)}
              route={route}
              contract={contract}
              bankRoutes={flow.modules.bankContracts}
              currency={c}
              terms={
                route
                  ? terms
                  : {
                      balanceWhen: o.balanceTerms === "against_bl_copy" ? "against_bl_copy" : "before_shipment",
                      lcTerms: null,
                      lcDays: null,
                    }
              }
              fromQuotation={flow.payment.fromQuotation}
              suggest={SUGGEST[o.balanceTerms] ?? null}
            />
          ) : undefined
        }
        footer={
          lc && flow?.payment.lcChecks ? (
            <div className="flex flex-col gap-1 border-t border-line px-4 py-3">
              <p className="text-xs font-semibold text-text-2">The LC against the order</p>
              <LcChecks checks={flow.payment.lcChecks} />
            </div>
          ) : undefined
        }
      />
      <ViewCard
        id="plan"
        target="plan"
        title="The plan"
        description={
          m.route.summary ? `Built from the route: ${m.route.summary}.` : "Deposit and balance; choose the route to build the balance part."
        }
        canEdit={false}
        actions={
          <PaymentPlan plan={m.plan} currency={c} total={m.total} terms={m.terms} action={savePlanAction.bind(null, o.id)} buttonOnly />
        }
      >
        <CardBody className="flex flex-col gap-2">
          {!m.plan.matchesTotal && (
            <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
              The parts do not add up to the order total ({money(m.plan.difference, c)}{" "}
              {Number(m.plan.difference) > 0 ? "missing" : "too much"}). Change the plan.
            </p>
          )}
          <PlanLines plan={m.plan} currency={c} total={m.total} received={m.received} due={m.due} />
        </CardBody>
      </ViewCard>
      <MoneySection
        id="customer"
        target="payments.received"
        icon={<ArrowDownLeft aria-hidden />}
        title="Payments received"
        sub={`${o.customer.name} pays us · ${termsOf(o)}`}
        action={
          canPay && p.credit.canUse ? (
            <UseCredit action={useCreditAction.bind(null, o.id)} credit={p.credit.amount} due={p.due} currency={c} today={now} />
          ) : undefined
        }
      >
        <CustomerSummary o={o} />
        {m.charged.length > 0 && (
          <ul
            aria-label="Charged to the customer"
            className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface text-sm"
          >
            {m.charged.map((x) => (
              <li key={x.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span>
                  <span className="text-text-2">Charged to you:</span> {x.description}
                </span>
                <span className="font-medium tabular">{money(x.amount, c)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <ViewPaymentsLink order={o.id} />
          {pay("Record payment")}
        </div>
      </MoneySection>
    </StepPage>
  );
}
