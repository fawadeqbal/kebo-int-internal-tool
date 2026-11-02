import { ArrowDownLeft } from "lucide-react";
import { can, PAYMENT_ROUTE_LABEL } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { orderMoneyOf, orderPaymentsOf } from "@/lib/order-data";
import { money } from "@/lib/format";
import { RoutePanel } from "@/components/orders/flow-panels";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { KeyFacts, StepChanges, StepFiles, StepPage } from "@/components/orders/step-page";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { PaymentPlan } from "@/components/money/forms";
import { savePlanAction } from "../../../money/actions";
import { bankContractAction, routeAction } from "../../flow-actions";
import { paymentAction } from "../../actions";
import { PaymentForm } from "../forms";
import { CustomerSummary, MoneySection, PaymentsReceived } from "../money-sections";
import { stepData } from "../step-data";
import { StepPapers } from "../papers";
import { termsOf } from "../shared";

export const metadata = { title: "Order · payment" };

/**
 * Step 1, Payment: how the customer pays (the route and the bank contract or
 * LC), the plan and the payments received. Costs and profit are on the Costs page.
 */
export default async function OrderPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "payment");
  const { me, o, flow, now } = d;
  const [p, m] = await Promise.all([orderPaymentsOf(id), orderMoneyOf(id)]);
  const c = o.currency;
  const canPay = can(me, "payments.record") && d.open;
  const canRoute = can(me, "orders.update") && d.open && !!flow;
  const route = flow?.payment.route ?? null;
  const lc = route === "letter_of_credit";
  const pay = (label: string, quiet = true) =>
    canPay ? (
      <PaymentForm
        quiet={quiet}
        label={label}
        action={paymentAction.bind(null, o.id, c)}
        currency={c}
        depositDue={p.depositDue}
        due={p.due}
        today={now}
      />
    ) : null;

  const tools: Record<string, AutoTool> = {};
  if (canRoute)
    tools.route = {
      kind: "route",
      label: "Choose",
      action: routeAction.bind(null, o.id),
      route,
      bankRoutes: !!flow?.modules.bankContracts,
    };
  if (canRoute && flow?.modules.bankContracts && (route === "bank_contract" || lc))
    tools.contract = {
      kind: "contract",
      label: lc ? "Add the LC" : "Add the contract",
      action: bankContractAction.bind(null, o.id),
      contract: flow.payment.bankContract,
      lc,
      currency: c,
    };
  const depositPay = pay("Record payment");
  if (depositPay) tools.deposit_in = { kind: "node", node: depositPay };

  const contract = flow?.payment.bankContract;
  return (
    <StepPage
      steps={d.steps}
      step="payment"
      base={d.base}
      action={pay("Record a payment", false)}
      side={
        <>
          <KeyFacts
            facts={[
              { label: "Order total", value: money(o.money.total, c) },
              {
                label: "Received",
                value: `${money(o.money.received, c)}${Number(o.money.total) > 0 ? ` · ${Math.round((Number(o.money.received) / Number(o.money.total)) * 100)}%` : ""}`,
              },
              { label: "Still due", value: money(m.due, c) },
              ...(m.charged.length ? [{ label: "Charged to them", value: money(m.chargedTotal, c) }] : []),
              { label: "Comes through", value: route ? PAYMENT_ROUTE_LABEL[route].replace(/ \(.*\)$/, "") : "Not chosen" },
              ...(contract?.number ? [{ label: lc ? "LC" : "Contract", value: contract.number }] : []),
              { label: "Terms", value: termsOf(o) },
            ]}
          />
          <StepCosts id={o.id} step="payment" />
          <StepPapers id={o.id} dealId={o.inquiry.id} step="payment" />
          <StepFiles items={d.items} addHref={d.steps.canEdit ? `${d.base}/documents#files` : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="payment"
        label="Payment"
        items={d.items}
        current={d.current}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        payNode={pay("Record payment")}
        listHref={d.listHref}
      />
      {flow && (
        <Card id="route">
          <CardHeader title="How the customer pays" description="It decides the papers and the bank steps after shipping." />
          <CardBody>
            <RoutePanel
              routeAction={routeAction.bind(null, o.id)}
              contractAction={bankContractAction.bind(null, o.id)}
              route={route}
              contract={flow.payment.bankContract}
              bankRoutes={flow.modules.bankContracts}
              currency={c}
              canEdit={canRoute}
            />
          </CardBody>
        </Card>
      )}
      <MoneySection
        id="customer"
        icon={<ArrowDownLeft aria-hidden />}
        title="The plan and payments received"
        sub={`${o.customer.name} pays us · ${termsOf(o)}`}
      >
        <CustomerSummary o={o} />
        <PaymentPlan plan={m.plan} currency={c} total={m.total} terms={m.terms} action={savePlanAction.bind(null, o.id)} />
        {m.charged.length > 0 && (
          <ul aria-label="Charged to the customer" className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface text-sm">
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
        <PaymentsReceived o={o} p={p} me={me} now={now} />
      </MoneySection>
    </StepPage>
  );
}
