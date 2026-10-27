"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { toMinor, formatMinor } from "@kebo/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  INSTALMENT_STATUS_LABEL,
  PAYMENT_KIND_LABEL,
  PAYMENT_KINDS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type InstalmentStatus,
  type PaymentKind,
  type PaymentMethod,
} from "@kebo/shared";
import { Badge, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { convertText, rateOf, type Fx } from "@/lib/fx";
import type { ActionState } from "@/lib/actions";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { ExpenseView, FactoryOwed, FactoryPaymentView, OrderMoney } from "@/lib/types-money";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";

const STATUS_TONE: Record<InstalmentStatus, "ok" | "info" | "warn" | "bad" | "neutral"> = {
  paid: "ok",
  part_paid: "info",
  due_soon: "warn",
  late: "bad",
  open: "neutral",
};

/* ---------------------------------------------------------------- the plan */

type Row = { key: string; id: string | null; label: string; amount: string; dueOn: string };

/**
 * The customer's instalments, ticked off as money comes in (the earliest is
 * paid first). Editing: add, split or move instalments; they must add up to the
 * order total.
 */
export function PaymentPlan({
  plan,
  currency,
  total,
  terms,
  action,
}: {
  plan: OrderMoney["plan"];
  currency: string;
  total: string;
  terms: string;
  action: Action;
}) {
  const [editing, setEditing] = useState(false);
  const start = (): Row[] => plan.items.map((i) => ({ key: i.id, id: i.id, label: i.label, amount: i.amount, dueOn: i.dueOn ?? "" }));
  const [rows, setRows] = useState<Row[]>(start);
  const set = (key: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const sum = rows.reduce(
    (t, r) => t + (Number.isFinite(Number(r.amount)) && r.amount.trim() ? toMinor(r.amount.replace(",", ".")) : 0),
    0,
  );
  const diff = toMinor(total) - sum;

  if (!editing)
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Payment plan</h3>
          <span className="text-xs text-muted">{terms}</span>
        </div>
        {!plan.matchesTotal && (
          <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
            The instalments do not add up to the order total ({money(plan.difference, currency)}{" "}
            {Number(plan.difference) > 0 ? "missing" : "too much"}). Edit the plan.
          </p>
        )}
        <ol className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {plan.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{i.label}</span>
                <span className="block text-xs text-muted">
                  {i.dueOn ? `Due ${date(i.dueOn)}` : "Date set when the ship date is known"}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-right tabular">
                  {money(i.amount, currency)}
                  {i.status !== "paid" && Number(i.paid) > 0 && (
                    <span className="block text-xs text-muted">{money(i.paid, currency)} paid</span>
                  )}
                </span>
                <Badge tone={STATUS_TONE[i.status]} dot>
                  {INSTALMENT_STATUS_LABEL[i.status]}
                </Badge>
              </span>
            </li>
          ))}
        </ol>
        {plan.canEdit && (
          <div>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setRows(start());
                setEditing(true);
              }}
            >
              <Pencil aria-hidden /> Change the plan
            </Button>
          </div>
        )}
      </div>
    );

  const body = {
    items: rows.map((r) => ({ id: r.id, label: r.label.trim(), amount: r.amount.replace(",", "."), dueOn: r.dueOn || null })),
  };
  return (
    <ActionForm action={action} onDone={() => setEditing(false)} className={framed}>
      {(s) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(body)} />
          <p className="text-sm font-medium">Payment plan — must add up to {money(total, currency)}</p>
          <ol className="flex flex-col gap-2">
            {rows.map((r, n) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={`Instalment ${n + 1} name`}
                  value={r.label}
                  onChange={(e) => set(r.key, { label: e.target.value })}
                  maxLength={80}
                  placeholder="e.g. Second instalment"
                  className="min-w-0 flex-1 basis-40"
                />
                <Input
                  aria-label={`Instalment ${n + 1} amount`}
                  inputMode="decimal"
                  value={r.amount}
                  onChange={(e) => set(r.key, { amount: e.target.value })}
                  className="w-32 tabular"
                />
                <Input
                  aria-label={`Instalment ${n + 1} due date`}
                  type="date"
                  value={r.dueOn}
                  onChange={(e) => set(r.key, { dueOn: e.target.value })}
                  className="w-40"
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                  disabled={rows.length === 1}
                  aria-label={`Remove instalment ${n + 1}`}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {s.errors && Object.keys(s.errors).some((k) => k.startsWith("items")) && (
            <p className="text-xs text-bad">Each instalment needs a name and an amount above 0.</p>
          )}
          <p className={cn("text-xs tabular", diff === 0 ? "text-ok" : "text-warn")}>
            {diff === 0
              ? "Adds up to the order total."
              : diff > 0
                ? `${formatMinor(diff, currency)} still to place`
                : `${formatMinor(-diff, currency)} more than the order total`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                setRows((x) => [
                  ...x,
                  {
                    key: Math.random().toString(36).slice(2),
                    id: null,
                    label: "",
                    amount: diff > 0 ? formatMinor(diff, currency).replace(/[^0-9.]/g, "") : "",
                    dueOn: "",
                  },
                ])
              }
              disabled={rows.length >= 12}
            >
              <Plus aria-hidden /> Add an instalment
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingText="Saving…" disabled={diff !== 0}>
              Save the plan
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- shared bits */

/** Remove a payment or an expense recorded by mistake, with a reason (it stays listed, crossed out). */
export function VoidForm({ action, label }: { action: Action; label: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="danger-ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className={`${framed} mt-2 w-full`}>
      {(s) => (
        <>
          <Field label="Why remove it?" htmlFor={`void-${label}`} error={s.errors?.reason} hint="It stays listed, crossed out">
            <Textarea
              id={`void-${label}`}
              name="reason"
              rows={2}
              className="min-h-0"
              placeholder="e.g. recorded twice"
              defaultValue={s.values?.reason}
            />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" variant="danger" pendingText="Removing…">
              Remove {label}
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function Choice<T extends string>({
  id,
  name,
  options,
  labels,
  value,
  onChange,
}: {
  id: string;
  name: string;
  options: readonly T[];
  labels: Record<T, string>;
  value?: T;
  onChange?: (v: T) => void;
}) {
  return (
    <Select id={id} name={name} {...(onChange ? { value, onChange: (e) => onChange(e.target.value as T) } : { defaultValue: value })}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o]}
        </option>
      ))}
    </Select>
  );
}

function PeopleSelect({ id, value, people, none }: { id: string; value: string; people: Person[]; none: string }) {
  return (
    <Select id={id} name="paidById" defaultValue={value}>
      <option value="">{none}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

/* ---------------------------------------------------------------- customer payments */

/** Change a customer payment typed wrong (asks why). */
export function EditCustomerPayment({
  action,
  payment,
  currency,
  today,
}: {
  action: Action;
  payment: {
    kind: PaymentKind;
    amount: string;
    bankCharges: string;
    paidOn: string;
    method: PaymentMethod;
    reference: string | null;
    note: string | null;
  };
  currency: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Change
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className={`${framed} mt-2 w-full`}>
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="What for" htmlFor="ep-kind">
              <Choice
                id="ep-kind"
                name="kind"
                options={PAYMENT_KINDS}
                labels={PAYMENT_KIND_LABEL}
                value={(s.values?.kind as PaymentKind) ?? payment.kind}
              />
            </Field>
            <Field label={`Amount (${currency})`} htmlFor="ep-amount" error={s.errors?.amount}>
              <Input
                id="ep-amount"
                name="amount"
                inputMode="decimal"
                className="tabular"
                defaultValue={s.values?.amount ?? payment.amount}
              />
            </Field>
            <Field label="Bank charges" htmlFor="ep-charges" optional error={s.errors?.bankCharges}>
              <Input
                id="ep-charges"
                name="bankCharges"
                inputMode="decimal"
                className="tabular"
                defaultValue={s.values?.bankCharges ?? payment.bankCharges}
              />
            </Field>
            <Field label="Paid on" htmlFor="ep-paidOn" error={s.errors?.paidOn}>
              <Input id="ep-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? payment.paidOn} />
            </Field>
            <Field label="Method" htmlFor="ep-method">
              <Choice
                id="ep-method"
                name="method"
                options={PAYMENT_METHODS}
                labels={PAYMENT_METHOD_LABEL}
                value={(s.values?.method as PaymentMethod) ?? payment.method}
              />
            </Field>
            <Field label="Bank reference" htmlFor="ep-reference" optional>
              <Input id="ep-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? payment.reference ?? ""} />
            </Field>
          </div>
          <input type="hidden" name="note" value={payment.note ?? ""} />
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save the change
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/**
 * The currency of a money form changed: the amount typed follows it (CNY 3,550 →
 * USD 500.00 at the Settings rate), and a rate already filled in is replaced by
 * the Settings rate for the new currency. Without a rate, the numbers stay.
 */
function switchCurrency(amount: HTMLInputElement | null, rate: HTMLInputElement | null, from: string, to: string, per: string, fx: Fx) {
  if (amount && amount.value.trim()) {
    const v = convertText(amount.value, from, to, fx);
    if (v !== null) amount.value = v;
  }
  if (rate && rate.value.trim()) {
    const r = rateOf(fx, to, per);
    rate.value = r === null || to === per ? "" : String(Number(r.toFixed(6)));
  }
}

/* ---------------------------------------------------------------- factory payments */

/**
 * Money sent to a factory for this order (new, or a change that asks why). The
 * rate turns it into the order's currency for profit; empty uses Settings.
 */
export function FactoryPaymentForm({
  action,
  factories,
  people,
  orderCurrency,
  fx,
  today,
  payment,
  onClose,
}: {
  action: Action;
  factories: FactoryOwed[];
  people: Person[];
  orderCurrency: string;
  /** Settings rates: the amount is converted when the currency changes. */
  fx: Fx;
  today: string;
  payment?: FactoryPaymentView;
  onClose: () => void;
}) {
  const amountRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const first = factories.find((f) => Number(f.toPay) > 0) ?? factories[0];
  const [factoryKey, setFactoryKey] = useState(
    payment ? `${payment.factory.id}:${payment.currency}` : first ? `${first.factory.id}:${first.currency}` : "",
  );
  const chosen = factories.find((f) => `${f.factory.id}:${f.currency}` === factoryKey);
  const [currency, setCurrency] = useState(payment?.currency ?? chosen?.currency ?? orderCurrency);
  return (
    <ActionForm action={action} onDone={onClose} className={framed}>
      {(s) => (
        <>
          <p className="text-sm font-medium">{payment ? `Change the payment to ${payment.factory.name}` : "Payment to a factory"}</p>
          <input type="hidden" name="factoryId" value={chosen?.factory.id ?? payment?.factory.id ?? ""} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Factory" htmlFor="fp-factory" error={s.errors?.factoryId}>
              <Select
                id="fp-factory"
                value={factoryKey}
                onChange={(e) => {
                  setFactoryKey(e.target.value);
                  const f = factories.find((x) => `${x.factory.id}:${x.currency}` === e.target.value);
                  if (f) setCurrency(f.currency);
                }}
              >
                {factories.map((f) => (
                  <option key={`${f.factory.id}:${f.currency}`} value={`${f.factory.id}:${f.currency}`}>
                    {f.factory.name} ({f.currency} {Number(f.toPay) > 0 ? `${money(f.toPay, f.currency)} to pay` : "paid"})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What for" htmlFor="fp-kind">
              <Choice
                id="fp-kind"
                name="kind"
                options={PAYMENT_KINDS}
                labels={PAYMENT_KIND_LABEL}
                value={(s.values?.kind as PaymentKind) ?? payment?.kind ?? (chosen && Number(chosen.paid) > 0 ? "balance" : "deposit")}
              />
            </Field>
            <Field label="Paid on" htmlFor="fp-paidOn" error={s.errors?.paidOn}>
              <Input id="fp-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? payment?.paidOn ?? today} />
            </Field>
            <Field label="Amount" htmlFor="fp-amount" error={s.errors?.amount}>
              <Input
                ref={amountRef}
                id="fp-amount"
                name="amount"
                inputMode="decimal"
                className="tabular"
                defaultValue={s.values?.amount ?? payment?.amount ?? ""}
                placeholder={chosen && Number(chosen.toPay) > 0 ? chosen.toPay : ""}
              />
            </Field>
            <Field label="Currency" htmlFor="fp-currency" error={s.errors?.currency} hint="Changing it converts the amount">
              <CurrencySelect
                id="fp-currency"
                name="currency"
                value={currency}
                onChange={(e) => {
                  const next = e.target.value;
                  switchCurrency(amountRef.current, rateRef.current, currency, next, orderCurrency, fx);
                  setCurrency(next);
                }}
              />
            </Field>
            <Field
              label={`Rate (${currency || "…"} per 1 ${orderCurrency})`}
              htmlFor="fp-rate"
              optional={!payment}
              hint={payment ? undefined : `Empty: today's rate from Settings${rateOf(fx, currency, orderCurrency) && currency !== orderCurrency ? ` (${rateOf(fx, currency, orderCurrency)!.toFixed(4).replace(/\.?0+$/, "")})` : ""}`}
              error={s.errors?.rate}
            >
              <Input
                ref={rateRef}
                id="fp-rate"
                name="rate"
                inputMode="decimal"
                className="tabular"
                defaultValue={s.values?.rate ?? (payment ? String(payment.rate) : "")}
                disabled={currency === orderCurrency}
              />
            </Field>
            <Field label="Method" htmlFor="fp-method">
              <Choice
                id="fp-method"
                name="method"
                options={PAYMENT_METHODS}
                labels={PAYMENT_METHOD_LABEL}
                value={(s.values?.method as PaymentMethod) ?? payment?.method ?? "bank_transfer"}
              />
            </Field>
            <Field
              label="Paid by"
              htmlFor="fp-paidBy"
              optional
              hint={chosen?.lookedAfterBy ? `Empty: ${chosen.lookedAfterBy.name}, who looks after it` : undefined}
            >
              <PeopleSelect
                id="fp-paidBy"
                value={s.values?.paidById ?? payment?.paidBy?.id ?? ""}
                people={people}
                none={chosen?.lookedAfterBy ? `${chosen.lookedAfterBy.name} (looks after it)` : "Not said"}
              />
            </Field>
            <Field label="Bank reference" htmlFor="fp-reference" optional>
              <Input id="fp-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? payment?.reference ?? ""} />
            </Field>
          </div>
          <Field label="Note" htmlFor="fp-note" optional>
            <Textarea id="fp-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note ?? payment?.note ?? ""} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              {payment ? "Save the change" : "Record the payment"}
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** "Record a payment to a factory" button that opens the form. */
export function NewFactoryPayment(props: Omit<Parameters<typeof FactoryPaymentForm>[0], "onClose" | "payment">) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div>
        <Button size="sm" variant="primary" onClick={() => setOpen(true)} disabled={!props.factories.length}>
          Record a payment to a factory
        </Button>
      </div>
    );
  return <FactoryPaymentForm {...props} onClose={() => setOpen(false)} />;
}

/** "Change" on one factory payment. */
export function EditFactoryPayment(props: Omit<Parameters<typeof FactoryPaymentForm>[0], "onClose">) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Change
      </Button>
    );
  return (
    <div className="mt-2 w-full">
      <FactoryPaymentForm {...props} onClose={() => setOpen(false)} />
    </div>
  );
}

/* ---------------------------------------------------------------- expenses */

/** An expense for an order or for the company (new, or a change that asks why). */
export function ExpenseForm({
  action,
  people,
  mainCurrency,
  fx,
  today,
  expense,
  orders,
  onClose,
}: {
  action: Action;
  people: Person[];
  mainCurrency: string;
  /** Settings rates: the amount is converted when the currency changes. */
  fx: Fx;
  today: string;
  expense?: ExpenseView;
  /** On the Money page: the orders an expense can belong to (empty = company). */
  orders?: { id: string; refNo: string; label: string }[];
  onClose: () => void;
}) {
  const [currency, setCurrency] = useState(expense?.currency ?? mainCurrency);
  const amountRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  return (
    <ActionForm action={action} onDone={onClose} className={framed}>
      {(s) => (
        <>
          <p className="text-sm font-medium">{expense ? "Change the expense" : "New expense"}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {orders && (
              <Field label="For" htmlFor="ex-order" className="sm:col-span-3">
                <Select id="ex-order" name="orderId" defaultValue={s.values?.orderId ?? expense?.orderId ?? ""}>
                  <option value="">The company (rent, salaries, office…)</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.refNo} — {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Kind" htmlFor="ex-category" error={s.errors?.category}>
              <Choice
                id="ex-category"
                name="category"
                options={EXPENSE_CATEGORIES}
                labels={EXPENSE_CATEGORY_LABEL}
                value={(s.values?.category as (typeof EXPENSE_CATEGORIES)[number]) ?? expense?.category ?? (orders ? "office" : "freight")}
              />
            </Field>
            <Field label="What for" htmlFor="ex-description" error={s.errors?.description} className="sm:col-span-2">
              <Input
                id="ex-description"
                name="description"
                maxLength={200}
                defaultValue={s.values?.description ?? expense?.description ?? ""}
                placeholder="e.g. Truck to Qingdao port"
              />
            </Field>
            <Field label="Amount" htmlFor="ex-amount" error={s.errors?.amount}>
              <Input
                ref={amountRef}
                id="ex-amount"
                name="amount"
                inputMode="decimal"
                className="tabular"
                defaultValue={s.values?.amount ?? expense?.amount ?? ""}
              />
            </Field>
            <Field label="Currency" htmlFor="ex-currency" error={s.errors?.currency} hint="Changing it converts the amount">
              <CurrencySelect
                id="ex-currency"
                name="currency"
                value={currency}
                onChange={(e) => {
                  const next = e.target.value;
                  switchCurrency(amountRef.current, rateRef.current, currency, next, mainCurrency, fx);
                  setCurrency(next);
                }}
              />
            </Field>
            <Field
              label={`Rate (${currency || "…"} per 1 ${mainCurrency})`}
              htmlFor="ex-rate"
              optional={!expense}
              hint={expense ? undefined : `Empty: today's rate from Settings${rateOf(fx, currency, mainCurrency) && currency !== mainCurrency ? ` (${rateOf(fx, currency, mainCurrency)!.toFixed(4).replace(/\.?0+$/, "")})` : ""}`}
              error={s.errors?.rate}
            >
              <Input
                ref={rateRef}
                id="ex-rate"
                name="rate"
                inputMode="decimal"
                className="tabular"
                defaultValue={s.values?.rate ?? (expense ? String(expense.rate) : "")}
                disabled={currency === mainCurrency}
              />
            </Field>
            <Field label="Spent on" htmlFor="ex-spentOn" error={s.errors?.spentOn}>
              <Input id="ex-spentOn" name="spentOn" type="date" max={today} defaultValue={s.values?.spentOn ?? expense?.spentOn ?? today} />
            </Field>
            <Field label="Paid by" htmlFor="ex-paidBy" optional>
              <PeopleSelect id="ex-paidBy" value={s.values?.paidById ?? expense?.paidBy?.id ?? ""} people={people} none="Not said" />
            </Field>
            <Field label="Receipt / reference" htmlFor="ex-reference" optional>
              <Input id="ex-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? expense?.reference ?? ""} />
            </Field>
          </div>
          <input type="hidden" name="note" value={expense?.note ?? ""} />
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              {expense ? "Save the change" : "Add the expense"}
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function NewExpense(props: Omit<Parameters<typeof ExpenseForm>[0], "onClose" | "expense"> & { label?: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> {props.label ?? "Add an expense"}
        </Button>
      </div>
    );
  return <ExpenseForm {...props} onClose={() => setOpen(false)} />;
}

export function EditExpense(props: Omit<Parameters<typeof ExpenseForm>[0], "onClose">) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Change
      </Button>
    );
  return (
    <div className="mt-2 w-full">
      <ExpenseForm {...props} onClose={() => setOpen(false)} />
    </div>
  );
}
