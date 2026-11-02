import { ArrowDownLeft, ChartLine } from "lucide-react";
import { can, PAYMENT_ROUTE_LABEL } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { orderMoneyOf, orderPaymentsOf } from "@/lib/order-data";
import { money } from "@/lib/format";
import type { Person } from "@/lib/types";
import { RoutePanel } from "@/components/orders/flow-panels";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { KeyFacts, StepChanges, StepFiles, StepPage } from "@/components/orders/step-page";
import { NewExpense, PaymentPlan } from "@/components/money/forms";
import { expenseAction, savePlanAction } from "../../../money/actions";
import { bankContractAction, routeAction } from "../../flow-actions";
import { paymentAction } from "../../actions";
import { PaymentForm } from "../forms";
import { ProfitView } from "../money-cards";
import { CustomerSummary, MoneySection, PaymentsReceived } from "../money-sections";
import { stepData } from "../step-data";
import { termsOf } from "../shared";

export const metadata = { title: "Order · payment" };

/**
 * Step 1, Payment: how the customer pays (the route and the bank contract or
 * LC), the plan, the payments received, and — until the Costs page — the
 * order's costs and profit for managers.
 */
export default async function OrderPayment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "payment");
  const { me, o, flow, now } = d;
  const [p, m, people, settings] = await Promise.all([
    orderPaymentsOf(id),
    orderMoneyOf(id),
    api.get<Person[]>("/users/people"),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  const c = o.currency;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
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
              { label: "Still due", value: money(o.money.due, c) },
              { label: "Comes through", value: route ? PAYMENT_ROUTE_LABEL[route].replace(/ \(.*\)$/, "") : "Not chosen" },
              ...(contract?.number ? [{ label: lc ? "LC" : "Contract", value: contract.number }] : []),
              { label: "Terms", value: termsOf(o) },
            ]}
          />
          <StepFiles items={d.items} addHref={d.steps.canEdit ? `${d.base}/documents#files` : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <Checklist
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
        <PaymentsReceived o={o} p={p} me={me} now={now} />
      </MoneySection>
      {m.expenses && (
        <MoneySection
          id="costs"
          icon={<ChartLine aria-hidden />}
          title="Costs and profit"
          tag="Managers"
          sub="Freight, inspection, tickets and other costs, and what the order earns"
          action={
            !m.cancelled && (
              <NewExpense
                quiet
                label="Cost on this order"
                action={expenseAction.bind(null, m.orderId, null)}
                people={people}
                mainCurrency={settings.sales.currency}
                fx={fx}
                today={now}
              />
            )
          }
        >
          <ProfitView m={m} people={people} today={now} mainCurrency={settings.sales.currency} fx={fx} />
        </MoneySection>
      )}
    </StepPage>
  );
}
