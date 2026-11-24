"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { PAYMENT_KIND_LABEL, PAYMENT_KINDS, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentKind, type PaymentMethod } from "@kebo/shared";
import { Button, Field, Input, RULES, Select, Textarea, Notice, linkClass } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { FormButtons } from "@/components/common/route-window";
import { ActionForm } from "@/components/common/action-form";
import { UrlWindow, WindowFooter } from "@/components/common/panel";
import { CurrencySelect } from "@/components/common/currency-select";
import { AccountSelect, RecordedBy } from "./accounts";
import { FilePicker, useSaveThenSend } from "./attachment";
import { MoneyInput } from "@/components/common/money-input";
import { convertText, rateOf, type Fx } from "@/lib/fx";
import type { ActionState } from "@/lib/actions";
import { money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { FactoryOwed, FactoryPaymentView } from "@/lib/types-money";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";


/* ---------------------------------------------------------------- shared bits */

/**
 * The same removal as a window, opened from the record's ⋯ ("Remove this payment", ?panel=remove): Why remove it?,
 * then Remove in red. Delete lives last in ⋯ (PageHeader), never as a button under the boxes.
 */
export function VoidWindow({ action, label }: { action: Action; label: string }) {
  return (
    <UrlWindow name="remove" title={`Remove ${label}`} description="It stays listed, crossed out, with the reason." className={RULES.window.part}>
      {(close) => (
        <ActionForm action={action} onDone={close} className="flex flex-col gap-4">
          {(s) => (
            <>
              <Field label="Why remove it?" htmlFor="void-reason" error={s.errors?.reason}>
                <Textarea id="void-reason" name="reason" rows={3} defaultValue={s.values?.reason} />
              </Field>
              <WindowFooter onCancel={close}>
                <SubmitButton variant="danger" pendingText="Removing…">
                  Remove {label}
                </SubmitButton>
              </WindowFooter>
            </>
          )}
        </ActionForm>
      )}
    </UrlWindow>
  );
}

/** Remove a payment or an expense recorded by mistake, with a reason (it stays listed, crossed out). */
export function VoidForm({ action, label, button = "Remove" }: { action: Action; label: string; /** The closed button's words ("Remove this payment"). */ button?: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="danger-ghost" className="w-fit" onClick={() => setOpen(true)}>
        {button}
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className={`${framed} mt-2 w-full`}>
      {(s) => (
        <>
          <Field label="Why remove it?" htmlFor={`void-${label}`} error={s.errors?.reason}>
            <Textarea
              id={`void-${label}`}
              name="reason"
              rows={2}
              className="min-h-0"
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

/** "Why it changes", asked with the fields of a recorded payment that is changed in a window (kept in the history). */
function WhyField({ id, error, value }: { id: string; error?: string[]; value?: string }) {
  return (
    <Field label="Why it changes" htmlFor={id} error={error}>
      <Textarea id={id} name="reason" rows={2} className="min-h-0" maxLength={500} defaultValue={value} />
    </Field>
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
  onClose,
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
    account?: { id: string; name: string } | null;
    /** What really arrived (money v2): its currency and the rate it was counted at. */
    receivedAmount?: string;
    receivedCurrency?: string;
    rate?: number;
    paidByName?: string | null;
  };
  currency: string;
  today: string;
  /** In a window that already has the title: open at once, no frame, and "Why" is asked with the fields. */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(!!onClose);
  const [method, setMethod] = useState<PaymentMethod>(payment.method);
  const received = payment.receivedCurrency ?? currency;
  const close = onClose ?? (() => setOpen(false));
  if (!open)
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Change
      </Button>
    );
  return (
    <ActionForm action={action} onDone={close} showSuccess={!onClose} className={onClose ? "flex flex-col gap-3" : `${framed} mt-2 w-full`}>
      {(s) => (
        <>
          <div className={RULES.form.fields}>
            <Field label="What for" htmlFor="ep-kind" >
              <Choice
                id="ep-kind"
                name="kind"
                options={PAYMENT_KINDS}
                labels={PAYMENT_KIND_LABEL}
                value={(s.values?.kind as PaymentKind) ?? payment.kind}
              />
            </Field>
            <Field
              label={received === currency ? "Amount received" : `Amount received (${received})`}
              htmlFor="ep-amount"
              hint={received === currency ? undefined : `Counted at ${payment.rate} ${received} per ${currency}; change the rate below`}
              error={s.errors?.receivedAmount ?? s.errors?.amount}
            >
              <MoneyInput id="ep-amount" name="receivedAmount" currency={received} defaultValue={s.values?.receivedAmount ?? payment.receivedAmount ?? payment.amount} />
            </Field>
            <input type="hidden" name="receivedCurrency" value={received} />
            {received !== currency && (
              <Field label={`Rate (${received} per 1 ${currency})`} htmlFor="ep-rate" error={s.errors?.rate}>
                <Input id="ep-rate" name="rate" inputMode="decimal" defaultValue={s.values?.rate ?? String(payment.rate ?? "")} />
              </Field>
            )}
            <Field label="Bank charges" htmlFor="ep-charges" optional error={s.errors?.bankCharges}>
              <MoneyInput id="ep-charges" name="bankCharges" currency={currency} defaultValue={s.values?.bankCharges ?? payment.bankCharges} />
            </Field>
            <Field label="Date" htmlFor="ep-paidOn" error={s.errors?.paidOn}>
              <Input id="ep-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? payment.paidOn} />
            </Field>
            <Field label="Method" htmlFor="ep-method">
              <Choice id="ep-method" name="method" options={PAYMENT_METHODS.filter((m) => m !== "credit")} labels={PAYMENT_METHOD_LABEL} value={method} onChange={setMethod} />
            </Field>
            <Field label="Reference" htmlFor="ep-reference" optional>
              <Input id="ep-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? payment.reference ?? ""} />
            </Field>
            <AccountSelect id="ep-account" label="Deposit to account" currency={received} defaultValue={s.values?.accountId ?? payment.account?.id} error={s.errors?.accountId} method={method} />
          </div>
          <input type="hidden" name="paidByName" value={payment.paidByName ?? ""} />
          <input type="hidden" name="note" value={payment.note ?? ""} />
          {onClose && <WhyField id="ep-reason" error={s.errors?.reason} value={s.values?.reason} />}
          <FormButtons onCancel={close}>
            <SubmitButton pendingText="Saving…">Save the change</SubmitButton>
          </FormButtons>
        </>
      )}
    </ActionForm>
  );
}

/**
 * The money form's amount and currency together. Changing the currency turns
 * the typed amount into it (CNY 3,550 → USD 500.00 at the Settings rate) and
 * replaces a rate already filled in with the Settings rate for the new
 * currency; without a rate the numbers stay. `inPer` is the amount in the
 * currency the rate is "per" (the order's, or the main one), for the "≈" line.
 */
function useMoneyFields(fx: Fx, per: string, initial: { currency: string; amount: string; rate: string }) {
  const [currency, setCurrencyRaw] = useState(initial.currency);
  const [amount, setAmount] = useState(initial.amount);
  const [rate, setRate] = useState(initial.rate);
  // The amount as typed, before any conversion: converting back and forth works from it, so nothing drifts by a cent.
  const [typed, setTyped] = useState<{ currency: string; amount: string; shown: string } | null>(null);
  const setCurrency = (to: string, convert = true) => {
    if (convert && amount.trim()) {
      const from = typed && typed.shown === amount ? typed : { currency, amount, shown: amount };
      const v = from.currency === to ? from.amount : convertText(from.amount, from.currency, to, fx);
      if (v !== null) {
        setAmount(v);
        setTyped(from.currency === to ? null : { currency: from.currency, amount: from.amount, shown: v });
      }
    }
    if (rate.trim()) {
      const r = rateOf(fx, to, per);
      setRate(r === null || to === per ? "" : String(Number(r.toFixed(6))));
    }
    setCurrencyRaw(to);
  };
  const settingsRate = currency === per ? 1 : rateOf(fx, currency, per);
  const used = currency === per ? 1 : Number(rate.replace(/,/g, "")) > 0 ? Number(rate.replace(/,/g, "")) : settingsRate;
  const n = Number(amount.replace(/,/g, "").trim());
  const inPer = amount.trim() && Number.isFinite(n) && used ? n / used : null;
  return { currency, setCurrency, amount, setAmount, rate, setRate, settingsRate, inPer };
}

const rateText = (r: number) => r.toFixed(4).replace(/\.?0+$/, "");

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
  onFileError,
  prefill,
  bare,
}: {
  /** In a window that already has the title: no frame, no heading. */
  bare?: boolean;
  action: Action;
  factories: FactoryOwed[];
  people: Person[];
  orderCurrency: string;
  /** Settings rates: the amount is converted when the currency changes. */
  fx: Fx;
  today: string;
  payment?: FactoryPaymentView;
  onClose: () => void;
  /** The payment was recorded but its file was not. */
  onFileError?: (message: string) => void;
  /** A part of the factory's payment plan to pay (its amount, what for, and their invoice for it). */
  prefill?: { factoryId: string; amount: string; kind: PaymentKind; reference?: string | null };
}) {
  const first = (prefill && factories.find((f) => f.factory.id === prefill.factoryId)) ?? factories.find((f) => Number(f.toPay) > 0) ?? factories[0];
  const [factoryKey, setFactoryKey] = useState(
    payment ? `${payment.factory.id}:${payment.currency}` : first ? `${first.factory.id}:${first.currency}` : "",
  );
  const chosen = factories.find((f) => `${f.factory.id}:${f.currency}` === factoryKey);
  const m = useMoneyFields(fx, orderCurrency, {
    currency: payment?.currency ?? chosen?.currency ?? orderCurrency,
    amount: payment?.amount ?? prefill?.amount ?? "",
    rate: payment ? String(payment.rate) : "",
  });
  // We owe each factory in its offer's currency, and only a payment in that currency counts against it.
  const owedIn = chosen && Number(chosen.owed) > 0 ? chosen.currency : null;
  const kept = !!payment && payment.factory.id === chosen?.factory.id && payment.currency === m.currency;
  const mismatch = !!owedIn && m.currency !== owedIn && !kept;
  const left = chosen && Number(chosen.toPay) > 0 && m.currency === chosen.currency ? chosen.toPay : null;
  const [file, setFile] = useState<File | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? "bank_transfer");
  // The slip goes with the save itself: the page re-draws once the payment is saved.
  const save = useSaveThenSend(
    action,
    file,
    (id) => `/files/factory-payments/${id}`,
    "The payment is recorded",
    onFileError,
    (d) => (d as { createdId?: string } | undefined)?.createdId ?? payment?.id,
  );
  const done = () => onClose();
  return (
    <ActionForm action={save} onDone={done} className={bare ? "flex flex-col gap-3" : framed}>
      {(s) => (
        <>
          {!bare && <p className="text-sm font-medium">{payment ? `Change the payment to ${payment.factory.name}` : "Payment to a supplier"}</p>}
          <input type="hidden" name="factoryId" value={chosen?.factory.id ?? payment?.factory.id ?? ""} />
          <div className={RULES.form.fields}>
            <Field
              label="Supplier"
              htmlFor="fp-factory"
              error={s.errors?.factoryId}
              hint={owedIn && chosen ? (Number(chosen.toPay) > 0 ? `Owed in ${owedIn}: ${money(chosen.toPay, owedIn)} left to pay` : `Owed in ${owedIn}: paid in full`) : undefined}
            >
              <Select
                id="fp-factory"
                value={factoryKey}
                onChange={(e) => {
                  setFactoryKey(e.target.value);
                  // The currency follows the factory: what we owe them is in their offer's currency.
                  const f = factories.find((x) => `${x.factory.id}:${x.currency}` === e.target.value);
                  if (f && f.currency !== m.currency) m.setCurrency(f.currency, false);
                }}
              >
                {factories.map((f) => (
                  <option key={`${f.factory.id}:${f.currency}`} value={`${f.factory.id}:${f.currency}`}>
                    {f.factory.name}
                    {factories.filter((x) => x.factory.id === f.factory.id).length > 1 ? ` (${f.currency})` : ""}
                    {Number(f.toPay) > 0 ? "" : " · paid"}
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
                value={(s.values?.kind as PaymentKind) ?? payment?.kind ?? prefill?.kind ?? (chosen && Number(chosen.paid) > 0 ? "balance" : "deposit")}
              />
            </Field>
            <Field label="Date" htmlFor="fp-paidOn" error={s.errors?.paidOn}>
              <Input id="fp-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? payment?.paidOn ?? today} />
            </Field>
            <Field label="Currency" htmlFor="fp-currency" error={s.errors?.currency}>
              <CurrencySelect id="fp-currency" name="currency" value={m.currency} onChange={(e) => m.setCurrency(e.target.value)} aria-invalid={mismatch} />
            </Field>
            <Field
              label="Amount"
              htmlFor="fp-amount"
              error={s.errors?.amount}
              hint={
                <>
                  {m.inPer !== null && m.currency !== orderCurrency && <span className="tabular">≈ {money(m.inPer, orderCurrency)} </span>}
                  {left && (
                    <button type="button" className={linkClass} onClick={() => m.setAmount(left)}>
                      Pay what is left ({money(left, m.currency)})
                    </button>
                  )}
                </>
              }
            >
              <MoneyInput id="fp-amount" name="amount" currency={m.currency} value={m.amount} onChange={(e) => m.setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field
              label={`Rate (${m.currency} per 1 ${orderCurrency})`}
              htmlFor="fp-rate"
              optional={!payment}
              hint={
                m.currency === orderCurrency
                  ? "Same currency as the order"
                  : payment
                    ? undefined
                    : m.settingsRate
                      ? `Empty: today's Settings rate (${rateText(m.settingsRate)})`
                      : `No rate for ${m.currency} in Settings: enter it`
              }
              error={s.errors?.rate}
            >
              <Input
                id="fp-rate"
                name="rate"
                inputMode="decimal"
                className="tabular"
                value={m.rate}
                onChange={(e) => m.setRate(e.target.value)}
                placeholder={m.settingsRate && m.currency !== orderCurrency ? rateText(m.settingsRate) : ""}
                disabled={m.currency === orderCurrency}
              />
            </Field>
          </div>
          {mismatch && (
            <Notice tone="todo">
              <p className="font-medium">
                We owe {chosen!.factory.name} in {owedIn}, so a payment in {m.currency} would not count against it.
              </p>
              <p className="mt-0.5 text-text-2">
                Record the payment in {owedIn}: if you sent {m.currency}, enter the {owedIn} amount the supplier received (on their receipt or the bank advice).
              </p>
              <Button type="button" size="xs" variant="secondary" className="mt-2" onClick={() => m.setCurrency(owedIn!)}>
                Pay in {owedIn}
              </Button>
            </Notice>
          )}
          <div className={RULES.form.fields}>
            <Field label="Method" htmlFor="fp-method">
              <Choice id="fp-method" name="method" options={PAYMENT_METHODS} labels={PAYMENT_METHOD_LABEL} value={method} onChange={setMethod} />
            </Field>
            <AccountSelect id="fp-account" label="Paid from account" currency={m.currency} defaultValue={s.values?.accountId ?? payment?.account?.id} error={s.errors?.accountId} method={method} />
            <Field label="Reference" htmlFor="fp-reference" optional>
              <Input id="fp-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? payment?.reference ?? prefill?.reference ?? ""} />
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
          </div>
          {!payment && (
            <FilePicker id="fp-file" label="Attachment" hint="Photo or PDF" file={file} onChange={setFile} />
          )}
          <Field label="Note" htmlFor="fp-note" optional>
            <Textarea id="fp-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note ?? payment?.note ?? ""} />
          </Field>
          {payment && bare && <WhyField id="fp-reason" error={s.errors?.reason} value={s.values?.reason} />}
          {!payment && <RecordedBy />}
          <FormButtons onCancel={onClose}>
            <SubmitButton pendingText={file ? "Saving, sending the file…" : "Saving…"} disabled={mismatch}>
              {payment ? "Save the change" : "Record the payment"}
            </SubmitButton>
          </FormButtons>
        </>
      )}
    </ActionForm>
  );
}

/** "Record a payment to a factory" button that opens the form. */
export function NewFactoryPayment({
  label = "Record a payment to a supplier",
  quiet,
  startOpen = false,
  ...props
}: Omit<Parameters<typeof FactoryPaymentForm>[0], "onClose" | "payment" | "onFileError"> & { label?: string; quiet?: boolean; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [fileError, setFileError] = useState<string | null>(null);
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {fileError && <Notice tone="bad">{fileError}</Notice>}
        <Button
          className="w-fit"
          size="sm"
          variant={quiet ? "secondary" : "primary"}
          onClick={() => {
            setFileError(null);
            setOpen(true);
          }}
          disabled={!props.factories.length}
        >
          {quiet && <Plus aria-hidden />} {label}
        </Button>
      </div>
    );
  return <FactoryPaymentForm {...props} onClose={() => setOpen(false)} onFileError={setFileError} />;
}

