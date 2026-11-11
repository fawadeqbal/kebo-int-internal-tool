import { redirect } from "next/navigation";
import type { PaymentList } from "@kebo/shared";
import { Alert, buildHref, Card, CardBody, CardHeader, PageHeader, Segmented, Select } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { TZ } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { UUID } from "@/lib/ids";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { getPeople, getSettings } from "@/lib/loaders";
import type { OrderRow } from "@/lib/types-orders";
import { ReceivedForm } from "@/components/money/money-v2";
import { NewExpense, NewFactoryPayment, type ExpenseChoices } from "@/components/money/forms";
import { MoveMoney, type AccountRow } from "@/components/money/cash-forms";
import { paymentAction } from "../../orders/actions";
import { expenseAction, factoryPaymentAction } from "../../money/actions";
import { opensPayments } from "../shared";

export const metadata = { title: "Record payment" };

type Kind = "in" | "out" | "expense" | "transfer";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "in", label: "Money in" },
  { kind: "out", label: "Money out" },
  { kind: "expense", label: "Expense" },
  { kind: "transfer", label: "Transfer" },
];

/**
 * Record payment: the one place to enter any payment. The first choice is what kind; money in
 * and out are always on an order, chosen next. Every "Record payment" button opens this page,
 * with the kind and the order filled in (?kind=in&order=…).
 */
export default async function RecordPaymentPage({ searchParams }: { searchParams: Promise<{ kind?: string; order?: string }> }) {
  const me = await requireUser();
  if (!opensPayments(me)) redirect("/forbidden");
  const sp = await searchParams;
  const { canRecord } = await api.get<PaymentList>("/treasury/payments", { pageSize: 1, from: todayIn(TZ), to: todayIn(TZ) });
  const allowed = KINDS.filter((k) => canRecord[k.kind]);
  if (!allowed.length) redirect("/payments");
  const kind: Kind = allowed.find((k) => k.kind === sp.kind)?.kind ?? allowed[0]!.kind;
  const orderId = UUID.test(sp.order ?? "") ? sp.order : undefined;
  const today = todayIn(TZ);
  const href = (k: Kind) => buildHref("/payments/new", {}, { kind: k, order: k === "in" || k === "out" ? orderId : undefined });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader
        crumbs={[...crumbsFor("/payments").slice(0, 1), { label: "Payments", href: "/payments" }, { label: "Record payment" }]}
        title="Record payment"
      />
      {allowed.length > 1 && (
        <Segmented
          label="What kind of payment"
          options={allowed.map((k) => ({ href: href(k.kind), label: k.label, active: k.kind === kind }))}
        />
      )}
      {kind === "in" || kind === "out" ? (
        <OnOrder kind={kind} orderId={orderId} today={today} />
      ) : kind === "expense" ? (
        <Expense today={today} />
      ) : (
        <Transfer today={today} />
      )}
    </div>
  );
}

/** Money in from the customer, or out to a supplier: choose the order, then the same form the order uses. */
async function OnOrder({ kind, orderId, today }: { kind: "in" | "out"; orderId?: string; today: string }) {
  const open = await api.get<OrderRow[]>("/orders", { status: "open" });
  const picker = (
    <Card>
      <CardHeader
        title="Which order"
        description={kind === "in" ? "The order the customer paid for." : "The order the supplier is paid for."}
      />
      <CardBody>
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value={kind} />
          <Select name="order" defaultValue={orderId ?? ""} aria-label="Order" className="sm:w-96">
            <option value="" disabled>
              Choose an order
            </option>
            {open.map((o) => (
              <option key={o.id} value={o.id}>
                {o.refNo} · {o.customer.name}
              </option>
            ))}
          </Select>
          <button className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 text-sm font-medium hover:bg-surface-2">
            Continue
          </button>
        </form>
      </CardBody>
    </Card>
  );
  if (!orderId || !open.some((o) => o.id === orderId)) return picker;

  const [o, settings] = await Promise.all([orderOf(orderId), getSettings()]);
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  if (kind === "in") {
    const [p, m] = await Promise.all([orderPaymentsOf(orderId), orderMoneyOf(orderId)]);
    return (
      <>
        {picker}
        <ReceivedForm
          startOpen
          action={paymentAction.bind(null, o.id, o.currency)}
          currency={o.currency}
          customer={o.customer.name}
          refNo={o.refNo}
          depositDue={p.depositDue}
          due={p.due}
          forWhat={m.plan.next?.label ?? null}
          fx={fx}
          today={today}
        />
      </>
    );
  }
  const [m, people] = await Promise.all([orderMoneyOf(orderId), getPeople()]);
  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  return (
    <>
      {picker}
      {owing.length ? (
        <NewFactoryPayment
          startOpen
          action={factoryPaymentAction.bind(null, m.orderId, null)}
          factories={owing}
          people={people}
          orderCurrency={o.currency}
          fx={fx}
          today={today}
        />
      ) : (
        <Alert tone="info">Nothing is owed to a supplier on this order.</Alert>
      )}
    </>
  );
}

async function Expense({ today }: { today: string }) {
  const [people, choices, settings] = await Promise.all([getPeople(), api.get<ExpenseChoices>("/expenses/targets"), getSettings()]);
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  return (
    <NewExpense
      startOpen
      action={expenseAction.bind(null, null, null)}
      people={people}
      mainCurrency={fx.main}
      fx={fx}
      today={today}
      choices={choices}
    />
  );
}

async function Transfer({ today }: { today: string }) {
  const accounts = await api.get<AccountRow[]>("/money/accounts");
  return accounts.filter((a) => !a.archived).length < 2 ? (
    <Alert tone="info">A transfer needs two accounts. Add them in Treasury › Multi-currency vault.</Alert>
  ) : (
    <MoveMoney startOpen accounts={accounts} today={today} />
  );
}
