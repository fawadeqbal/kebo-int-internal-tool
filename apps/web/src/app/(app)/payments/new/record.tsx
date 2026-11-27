import { AutoSelect } from "@kebo/ui/client";
import Form from "next/form";
import { redirect } from "next/navigation";
import { requestWords } from "@/lib/requests";
import type { PaymentList } from "@kebo/shared";
import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote } from "lucide-react";
import { buildHref, Card, CardBody, CardHeader, LinkTabs, Table, Td, Th, THead, Tr, Notice, buttonClass } from "@kebo/ui";
import { date, money, companyToday, numberOnSave } from "@/lib/format";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { UUID } from "@/lib/ids";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { getPeople, getSettings } from "@/lib/loaders";
import type { OrderRow } from "@/lib/types-orders";
import { ReceiptForm, ReceivedForm } from "@/components/money/money-v2";
import type { CustomerPayments } from "@/lib/types-money";
import { NewSupplierPayment } from "@/components/money/forms";
import { CostForm, type ExpenseChoices } from "@/components/money/cost-window";
import { MoveMoney, type AccountRow } from "@/components/money/cash-forms";
import { RecordBody } from "@/components/records/record-frame";
import { customerReceiptAction, paymentAction } from "../../orders/actions";
import { supplierPaymentAction } from "../../money/actions";
import { opensPayments } from "../shared";


type Kind = "in" | "out" | "expense" | "transfer";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "in", label: "Payment received" },
  { kind: "out", label: "Payment made" },
  { kind: "expense", label: "Expense" },
  { kind: "transfer", label: "Transfer" },
];

/**
 * Record payment: the one place to enter any payment. The first choice is what kind; money in
 * and out are always on an order, chosen next. Every "Record payment" button opens this page,
 * with the kind and the order filled in (?kind=in&order=…).
 */
export type Search = { kind?: string; order?: string; customer?: string; factory?: string; amount?: string; part?: string; back?: string };

/** Where "Back" goes: a record page of ours, never another site. */
const BACK = /^\/(orders|customers|factories|inquiries)\/[0-9a-f-]{36}(\/[a-z-]+)?$/i;

/** What the page and the window both show: the kind tabs, the form, and beside it (in the window: under it) the order's money. */
export async function RecordPayment({ sp, inWindow = false }: { sp: Search; inWindow?: boolean }) {
  const me = await requireUser();
  if (!opensPayments(me)) redirect("/forbidden");
  const { canRecord } = await api.get<PaymentList>("/treasury/payments", { pageSize: 1, from: companyToday(), to: companyToday() });
  const allowed = KINDS.filter((k) => canRecord[k.kind]);
  if (!allowed.length) redirect("/payments");
  const kind: Kind = allowed.find((k) => k.kind === sp.kind)?.kind ?? allowed[0]!.kind;
  const orderId = UUID.test(sp.order ?? "") ? sp.order : undefined;
  const customerId = kind === "in" && !orderId && UUID.test(sp.customer ?? "") ? sp.customer : undefined;
  const today = companyToday();
  const back = BACK.test(sp.back ?? "") ? sp.back : undefined;
  const href = (k: Kind) => buildHref("/payments/new", {}, { kind: k, order: k === "in" || k === "out" ? orderId : undefined, back });
  const prefill =
    kind === "out" && UUID.test(sp.factory ?? "") && /^\d+(\.\d{1,2})?$/.test(sp.amount ?? "")
      ? { supplierId: sp.factory!, amount: sp.amount!, kind: sp.part === "deposit" ? ("deposit" as const) : ("balance" as const) }
      : undefined;

  const ICON: Record<Kind, ReactNode> = {
    in: <ArrowDownToLine aria-hidden />,
    out: <ArrowUpFromLine aria-hidden />,
    expense: <Banknote aria-hidden />,
    transfer: <ArrowLeftRight aria-hidden />,
  };
  const side = await sideOf(kind, orderId);
  const form =
    kind === "in" || kind === "out" ? (
      customerId ? (
        <FromCustomer customerId={customerId} today={today} />
      ) : (
        <OnOrder kind={kind} orderId={orderId} today={today} prefill={prefill} back={back} inWindow={inWindow} />
      )
    ) : kind === "expense" ? (
      <Expense today={today} />
    ) : (
      <Transfer today={today} />
    );

  return (
    <>
      {allowed.length > 1 && (
        <LinkTabs
          label="What kind of payment"
          replace={inWindow}
          tabs={allowed.map((k) => ({ href: href(k.kind), label: <>{ICON[k.kind]} {k.label}</>, active: k.kind === kind }))}
        />
      )}
      {inWindow ? (
        <div className="flex min-w-0 flex-col gap-4">
          {form}
          {side}
        </div>
      ) : (
        <RecordBody panelLabel="Beside the payment" panel={side}>
          {form}
        </RecordBody>
      )}
    </>
  );
}

/** "Its RC number is given when you save": the number a payment of this kind gets. */
export function numberHint(kindParam: string | undefined) {
  const kind: Kind = KINDS.find((k) => k.kind === kindParam)?.kind ?? "in";
  const PREFIX: Record<Kind, string> = { in: "RC", out: "FP", expense: "EX", transfer: "TR" };
  return numberOnSave(PREFIX[kind]);
}

/** Beside the form (board PaymentIn): the order's payment plan, and what happens after saving. */
async function sideOf(kind: Kind, orderId: string | undefined) {
  const next: Record<Kind, ReactNode> = {
    in: (
      <>
        After saving, a payment recorded by someone who cannot verify waits in the <b>verification queue</b> until a manager checks it against the bank.
      </>
    ),
    out: <>The payment is posted to the supplier&rsquo;s account and the order&rsquo;s supplier money at once.</>,
    expense: <>The expense counts on its order or inquiry; one paid from someone&rsquo;s own money is owed back to them.</>,
    transfer: <>Both accounts change at once; a transfer between currencies keeps the rate you enter.</>,
  };
  const plan = orderId && (kind === "in" || kind === "out") ? await orderMoneyOf(orderId).catch(() => null) : null;
  return (
    <>
      {plan && kind === "in" && plan.plan.items.length > 0 && (
        <Card>
          <CardHeader
            title={`${plan.refNo ?? "The order"} · payment requests`}
            description={(() => {
              // Money pays the earliest request first: say which one this payment answers.
              const first = plan.plan.items.find((x) => x.request.state !== "paid");
              return first ? `Money pays the earliest first: this goes to ${first.number} (${first.label}).` : "Every request is paid.";
            })()}
          />
          <Table>
            <THead>
              <tr>
                <Th>Request</Th>
                <Th>Due</Th>
                <Th className="text-right">Still due</Th>
              </tr>
            </THead>
            <tbody>
              {plan.plan.items.map((x) => (
                <Tr key={x.id}>
                  <Td>
                    {x.label}
                    <span className="block text-xs text-muted">
                      {x.number} · {requestWords(x.request)}
                    </span>
                  </Td>
                  {/* In the narrow side panel a rule wraps and the amount never does (review 24 Nov, M-39: Still due was cut). */}
                  <Td className="text-sm">{x.dueOn ? <span className="whitespace-nowrap">{date(x.dueOn)}</span> : (x.when ?? x.rule ?? "—")}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{Number(x.open).toLocaleString("en-US", { minimumFractionDigits: 2 })}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {plan && kind === "out" && plan.factories && plan.factories.rows.length > 0 && (
        <Card>
          <CardHeader title={`${plan.refNo ?? "The order"} · we owe`} />
          <Table>
            <THead>
              <tr>
                <Th>Supplier</Th>
                <Th className="text-right">Left to pay</Th>
              </tr>
            </THead>
            <tbody>
              {plan.factories.rows.map((r) => (
                <Tr key={r.factory.id}>
                  <Td>{r.factory.name}</Td>
                  <Td className="text-right tabular">{money(r.toPay, r.currency)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Card>
        <CardHeader title="Next" />
        <CardBody className="text-sm text-text-2">{next[kind]}</CardBody>
      </Card>
    </>
  );
}

/**
 * The order or customer picker's form. On the full page, choosing loads the page again (a plain form): the app's
 * navigation would open the same form as a window over it (review 24 Nov, M-23). In the window it stays there.
 */
function ChooseForm({ inWindow, children }: { inWindow?: boolean; children: ReactNode }) {
  return inWindow ? (
    <Form action="/payments/new" replace data-no-change className="flex flex-wrap items-end gap-2">
      {children}
    </Form>
  ) : (
    <form action="/payments/new" method="get" data-no-change className="flex flex-wrap items-end gap-2">
      {children}
    </form>
  );
}

/** Money in from the customer, or out to a supplier: choose the order, then the same form the order uses. */
async function OnOrder({
  kind,
  orderId,
  today,
  prefill,
  back,
  inWindow,
}: {
  kind: "in" | "out";
  orderId?: string;
  today: string;
  prefill?: { supplierId: string; amount: string; kind: "deposit" | "balance" };
  back?: string;
  inWindow?: boolean;
}) {
  const open = await api.get<OrderRow[]>("/orders", { status: "open" });
  const picker = (
    <Card>
      <CardHeader
        title="Which order"
        description={kind === "in" ? "The order the customer paid for." : "The order the supplier is paid for."}
      />
      <CardBody>
        <ChooseForm inWindow={inWindow}>
          <input type="hidden" name="kind" value={kind} />
          {back && <input type="hidden" name="back" value={back} />}
          <AutoSelect name="order" defaultValue={orderId ?? ""} aria-label="Order" className="w-full">
            <option value="" disabled>
              Choose an order
            </option>
            {open.map((o) => (
              <option key={o.id} value={o.id}>
                {o.refNo} · {o.customer.name}
              </option>
            ))}
          </AutoSelect>
          <noscript>
            <button className={buttonClass("secondary", "sm")}>Continue</button>
          </noscript>
        </ChooseForm>
      </CardBody>
    </Card>
  );
  const several =
    kind === "in" ? (
      <Card>
        <CardHeader
          title="One transfer for several orders"
          description="The oldest due is filled in first; the rest is kept as the customer's credit."
        />
        <CardBody>
          <ChooseForm inWindow={inWindow}>
            <input type="hidden" name="kind" value="in" />
            {back && <input type="hidden" name="back" value={back} />}
            <AutoSelect name="customer" defaultValue="" aria-label="Customer" className="w-full">
              <option value="" disabled>
                Choose a customer
              </option>
              {[...new Map(open.map((o) => [o.customer.id, o.customer])).values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </AutoSelect>
            <noscript>
              <button className={buttonClass("secondary", "sm")}>Continue</button>
            </noscript>
          </ChooseForm>
        </CardBody>
      </Card>
    ) : null;
  if (!orderId || !open.some((o) => o.id === orderId))
    // Two ways to start: side by side when the page has room (review 26 Nov: a big screen showed two wide, nearly
    // empty boxes, one under the other).
    return several ? (
      <div className="@container">
        <div className="grid items-start gap-4 @min-[44rem]:grid-cols-2">
          {picker}
          {several}
        </div>
      </div>
    ) : (
      picker
    );

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
        <NewSupplierPayment
          startOpen
          prefill={prefill}
          action={supplierPaymentAction.bind(null, m.orderId, null, null)}
          factories={owing}
          people={people}
          orderCurrency={o.currency}
          fx={fx}
          today={today}
        />
      ) : (
        <Notice tone="info">Nothing is owed to a supplier on this order.</Notice>
      )}
    </>
  );
}

async function Expense({ today }: { today: string }) {
  const [people, choices, settings] = await Promise.all([getPeople(), api.get<ExpenseChoices>("/expenses/targets"), getSettings()]);
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  return (
    <CostForm setup={{ mainCurrency: fx.main, fx, today, people, choices, for: null }} mode={{ kind: "new" }} />
  );
}

async function Transfer({ today }: { today: string }) {
  const accounts = await api.get<AccountRow[]>("/money/accounts");
  return accounts.filter((a) => !a.archived).length < 2 ? (
    <Notice tone="info">A transfer needs two accounts. Add them in Finance › Cash & bank.</Notice>
  ) : (
    <MoveMoney startOpen accounts={accounts} today={today} />
  );
}

/** Money in from a customer as one transfer: it pays their open orders, the oldest due first; the rest is their credit. */
async function FromCustomer({ customerId, today }: { customerId: string; today: string }) {
  const [pay, customers, settings] = await Promise.all([
    api.get<CustomerPayments>("/payments", { customerId }),
    api.get<{ id: string; name: string }[]>("/customers/names"),
    getSettings(),
  ]);
  const name = customers.find((c) => c.id === customerId)?.name ?? "the customer";
  const open = pay.orders.filter((o) => o.status !== "cancelled" && Number(o.due) > 0);
  if (!pay.credit.canRecord) return <Notice tone="info">You cannot record money received.</Notice>;
  return (
    <ReceiptForm
      startOpen
      action={customerReceiptAction.bind(null, customerId)}
      customer={name}
      orders={open.map((o) => ({ id: o.id, refNo: o.refNo, currency: o.currency, orderedOn: o.orderedOn, due: o.due, next: o.next }))}
      fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
      today={today}
    />
  );
}
