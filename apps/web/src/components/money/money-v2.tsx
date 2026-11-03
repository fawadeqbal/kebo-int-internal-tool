"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Info, Lock, Plus, Square } from "lucide-react";
import { divideMinor, formatMinor, fromMinor, toMinor, type Minor } from "@kebo/money";
import {
  allocateOldestFirst,
  CREDIT_KIND_LABEL,
  FACTORY_DUE_RULE_LABEL,
  FACTORY_PLAN_STATUS_LABEL,
  INSTALMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type FactoryDueRule,
  type FactoryPlanStatus,
  type InstalmentStatus,
  type LcCheck,
  type PaymentMethod,
} from "@kebo/shared";
import { Alert, Badge, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { MoneyInput } from "@/components/common/money-input";
import { LineTable, type LineColumn, type LineResult, type LineRow } from "@/components/lines/line-table";
import { rateOf, type Fx } from "@/lib/fx";
import type { ActionState } from "@/lib/actions";
import { dueText } from "@/lib/format";
import type { CustomerCreditView, FactoryPlanView, OrderMoney } from "@/lib/types-money";
import { useBankBand } from "@/components/orders/bank-tracker";
import { AccountSelect } from "./accounts";
import { FilePicker, useSaveThenSend } from "./attachment";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/*
 * Money v2 (order flow v3, phase 5) on the web: a payment in any currency with
 * what it counts as and where it goes, one transfer over several orders with the
 * rest as credit, the customer's credit, the plan built from the route, the LC
 * checks, the factory payment plan. The rules live in @kebo/shared; the API
 * works the same numbers out again and is the one that counts.
 */

const framed = "flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4";
const box = "flex flex-col gap-2 rounded-lg bg-surface-2 p-3";
const fmt = (minor: Minor, currency: string) => formatMinor(minor, currency);
const num = (v: string) => (v.trim() && Number.isFinite(Number(v.replace(/,/g, ""))) ? Number(v.replace(/,/g, "")) : 0);
const day = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const shortDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "";
const METHODS = PAYMENT_METHODS.filter((m) => m !== "credit");
/** "110,208.90" */
const grouped = (v: string | undefined) => (v ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const rateText = (r: number | null) => (r === null ? "" : String(Number(r.toFixed(6))));

/** The received amount, its currency and the rate, and what it counts as in the order's currency. */
function useArrival(fx: Fx, currency: string, initialAmount = "") {
  const [received, setReceivedRaw] = useState(currency);
  const [amount, setAmount] = useState(initialAmount);
  const [rate, setRate] = useState("");
  const settingsRate = received === currency ? 1 : rateOf(fx, received, currency);
  const setReceived = (c: string) => {
    setReceivedRaw(c);
    setRate(c === currency ? "" : rateText(rateOf(fx, c, currency)));
  };
  const same = received === currency;
  const used = same ? 1 : num(rate);
  const receivedMinor = toMinor(amount.replace(/,/g, ""));
  const countsMinor = same ? receivedMinor : used > 0 ? divideMinor(receivedMinor, used) : 0;
  return { received, setReceived, amount, setAmount, rate, setRate, settingsRate, same, used, receivedMinor, countsMinor };
}

/* ---------------------------------------------------------------- money received on an order */

/**
 * "Money received from {customer}" (MoneyV2Record): what was paid (any
 * currency), into an account of that currency, when, how, who paid, the rate
 * (from Settings, editable); "Counts as" and what it pays on this order; what
 * is left over becomes the customer's credit. ("Money reached us", the bank
 * step's own, is ReachedForm below.)
 */
export function ReceivedForm({
  action,
  currency,
  customer,
  refNo,
  due,
  depositDue,
  forWhat,
  fx,
  today,
  label = "Record a payment",
  quiet,
}: {
  action: Action;
  currency: string;
  customer: string;
  refNo: string;
  due: string;
  depositDue: string;
  /** The next unpaid part of the plan ("Deposit 30%"). */
  forWhat: string | null;
  fx: Fx;
  today: string;
  label?: string;
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  if (Number(due) <= 0) return <p className="text-sm text-muted">Paid in full: nothing more to record.</p>;
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {fileError && <Alert tone="error">{fileError}</Alert>}
        <Button
          className="w-fit"
          variant={quiet ? "secondary" : "primary"}
          size="sm"
          onClick={() => {
            setFileError(null);
            setOpen(true);
          }}
        >
          {quiet && <Plus aria-hidden />} {label}
        </Button>
      </div>
    );
  return (
    <ReceivedFields
      action={action}
      currency={currency}
      customer={customer}
      refNo={refNo}
      due={due}
      depositDue={depositDue}
      forWhat={forWhat}
      fx={fx}
      today={today}
      onClose={() => setOpen(false)}
      onFileError={setFileError}
    />
  );
}

function ReceivedFields({
  action,
  currency,
  customer,
  refNo,
  due,
  forWhat,
  fx,
  today,
  onClose,
  onFileError,
}: Omit<Parameters<typeof ReceivedForm>[0], "label" | "quiet"> & { onClose: () => void; onFileError: (m: string) => void }) {
  const dueMinor = toMinor(due);
  const a = useArrival(fx, currency);
  const [charges, setCharges] = useState("");
  const [part, setPart] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [file, setFile] = useState<File | null>(null);
  const chargesMinor = toMinor(charges);
  const auto = Math.max(Math.min(a.countsMinor, dueMinor - chargesMinor), 0);
  const partMinor = part === null ? auto : toMinor(part);
  const leftMinor = a.countsMinor - partMinor;
  const tooMuch = partMinor + chargesMinor > dueMinor;
  // The slip goes with the save itself: recording the deposit ticks the checklist row this form was opened from.
  const save = useSaveThenSend(action, file, (id) => `/files/payments/${id}`, "The payment is recorded", onFileError);
  const done = () => onClose();
  return (
    <ActionForm action={save} onDone={done} keepFields className={framed}>
      {(s) => (
        <>
          <div className="-mx-3 -mt-3 border-b border-line px-3 py-2.5 sm:-mx-4 sm:-mt-4 sm:px-4">
            <p className="font-semibold">Money received from {customer}</p>
            <p className="text-xs text-text-2">
              Record what really happened: the currency and account it arrived in, who paid, and the rate. The system works out what it covers on the order.
            </p>
          </div>
          <input type="hidden" name="receivedCurrency" value={a.received} />
          <input type="hidden" name="amount" value={fromMinor(Math.max(partMinor, 0))} />
          <input type="hidden" name="method" value={method} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
            <Field label="What was paid" htmlFor="r-amount" hint="the amount as it arrived" error={s.errors?.receivedAmount ?? s.errors?.amount}>
              <div className="flex flex-col gap-2">
                <CurrencySelect short aria-label="Currency it arrived in" value={a.received} onChange={(e) => a.setReceived(e.target.value)} className="w-28" />
                <MoneyInput id="r-amount" name="receivedAmount" currency={a.received} value={a.amount} onChange={(e) => a.setAmount(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
            <AccountSelect id="r-account" label="Into" currency={a.received} defaultValue={s.values?.accountId} error={s.errors?.accountId} />
            <Field label="Paid on" htmlFor="r-paidOn" error={s.errors?.paidOn}>
              <Input id="r-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? today} />
            </Field>
            <Field label="How" htmlFor="r-method" error={s.errors?.method}>
              <Select id="r-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid by" htmlFor="r-paidBy" optional hint="when someone pays for the customer" error={s.errors?.paidByName}>
              <Input id="r-paidBy" name="paidByName" maxLength={120} defaultValue={s.values?.paidByName ?? ""} placeholder={customer} />
            </Field>
            {!a.same && (
              <Field label="Rate" htmlFor="r-rate" hint={a.settingsRate ? "from Settings · change it to the rate you agreed" : "no rate in Settings: type the rate you agreed"} error={s.errors?.rate}>
                <div className="flex items-center gap-2 text-sm text-text-2">
                  <span className="shrink-0">1 {currency} =</span>
                  <Input id="r-rate" name="rate" inputMode="decimal" className="w-28 tabular" value={a.rate} onChange={(e) => a.setRate(e.target.value)} />
                  <span>{a.received}</span>
                </div>
              </Field>
            )}
            <Field label="Reference" htmlFor="r-reference" optional hint="T/T or SWIFT reference, receipt no." error={s.errors?.reference}>
              <Input id="r-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
            </Field>
            {method === "bank_transfer" && (
              <Field label="Bank charges" htmlFor="r-charges" optional hint="kept by the banks; counts as paid" error={s.errors?.bankCharges}>
                <MoneyInput id="r-charges" name="bankCharges" currency={currency} value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="0.00" />
              </Field>
            )}
          </div>

          <div className={box}>
            <p className="text-sm font-semibold">
              Counts as {fmt(a.countsMinor, currency)} · goes to
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-2">
                    <th scope="col" className="py-1.5 pr-2 font-medium">Order</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">What for</th>
                    <th scope="col" className="py-1.5 pr-2 text-right font-medium">Still due</th>
                    <th scope="col" className="py-1.5 text-right font-medium">This payment</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line">
                    <td className="py-2 pr-2 font-mono text-xs">{refNo}</td>
                    <td className="py-2 pr-2">{forWhat ?? "Balance"}</td>
                    <td className="py-2 pr-2 text-right tabular">{fmt(dueMinor, currency)}</td>
                    <td className="py-2 text-right">
                      <div className="ml-auto w-40">
                        <MoneyInput aria-label={`This payment on ${refNo}`} currency={currency} className="text-right" value={part ?? fromMinor(auto)} onChange={(e) => setPart(e.target.value)} />
                      </div>
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td colSpan={3} className="py-2 pr-2 text-right font-semibold">
                      Left over
                    </td>
                    <td className={cn("py-2 text-right font-semibold tabular", leftMinor < 0 && "text-bad")}>{fmt(leftMinor, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {tooMuch && <p className="text-xs text-bad">That is more than is still due on {refNo}.</p>}
            {leftMinor > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-info/30 bg-info-soft px-2.5 py-2 text-xs">
                <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                {fmt(leftMinor, currency)} more than is due: kept as {customer}&apos;s credit, to use on the next order or refund.
              </p>
            )}
            {a.receivedMinor > 0 && (
              <p className="text-xs text-text-2">
                {a.same
                  ? `Kept as ${fmt(a.receivedMinor, a.received)} in the account, ${fmt(partMinor, currency)} off the order.`
                  : `Kept as both: ${fmt(a.receivedMinor, a.received)} in the account, ${fmt(partMinor, currency)} off the order. The rate is kept with the payment, so later rate changes never move it.`}
              </p>
            )}
          </div>
          <Field label="Note" htmlFor="r-note" optional error={s.errors?.note}>
            <Textarea id="r-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
          </Field>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <FilePicker id="r-file" label="Receipt or bank slip" hint="Photo or PDF" file={file} onChange={setFile} className="min-w-0 flex-1 basis-56" />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingText={file ? "Recording, sending the file…" : "Recording…"} disabled={a.countsMinor <= 0 || tooMuch || leftMinor < 0}>
                Record the payment
              </SubmitButton>
            </div>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- money reached us (the bank step) */

/** A line of the money check: label and value side by side; three across under the fields when the band is mid-wide. */
const CHECK_ROW = "flex justify-between gap-3 @2xl:flex-col @2xl:gap-0.5 @5xl:flex-row @5xl:gap-3";

/**
 * "Money reached us" in the bank step's band (Documents › Through the banks):
 * credited to us (currency + amount), on, bank charges; into, reference, the
 * MT103 or bank slip; the money check on the right. Recording it records the
 * payment and ticks the bank step, as before. On a phone the band is the
 * whole screen and "Record and tick" stays at the bottom.
 */
export function ReachedForm({
  action,
  currency,
  customer,
  due,
  fx,
  today,
}: {
  action: Action;
  currency: string;
  customer: string;
  due: string;
  depositDue: string;
  fx: Fx;
  today: string;
}) {
  const band = useBankBand();
  const dueMinor = toMinor(due);
  const a = useArrival(fx, currency, Number(due) > 0 ? due : "");
  const [charges, setCharges] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const chargesMinor = toMinor(charges);
  const partMinor = Math.max(Math.min(a.countsMinor, dueMinor - chargesMinor), 0);
  const leftMinor = a.countsMinor - partMinor;
  const save = useSaveThenSend(action, file, (id) => `/files/payments/${id}`, "The payment is recorded", band.error);
  const leftDue = Math.max(dueMinor - a.countsMinor - chargesMinor, 0);
  return (
    <ActionForm action={save} onDone={band.close} keepFields className="@container flex min-h-0 flex-1 flex-col">
      {(s) => (
        <>
          <input type="hidden" name="receivedCurrency" value={a.received} />
          <input type="hidden" name="amount" value={fromMinor(Math.max(partMinor, 0))} />
          <input type="hidden" name="method" value="bank_transfer" />
          <input type="hidden" name="bankStep" value="bank_paid_us" />
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:flex-none sm:overflow-visible @5xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="grid content-start gap-x-3 gap-y-3.5 @lg:grid-cols-2 @2xl:grid-cols-3">
              <Field
                label="Credited to us"
                htmlFor="rb-amount"
                hint="what the bank put in our account"
                error={s.errors?.receivedAmount ?? s.errors?.amount}
              >
                <div className="flex gap-2">
                  <CurrencySelect
                    short
                    aria-label="Currency it arrived in"
                    value={a.received}
                    onChange={(e) => a.setReceived(e.target.value)}
                    className="w-24 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <MoneyInput
                      id="rb-amount"
                      name="receivedAmount"
                      currency={a.received}
                      value={a.amount}
                      onChange={(e) => a.setAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </Field>
              <Field label="On" htmlFor="rb-paidOn" error={s.errors?.paidOn}>
                <Input id="rb-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? today} />
              </Field>
              <Field
                label="Bank charges taken"
                htmlFor="rb-charges"
                optional
                hint="advising + negotiation · a cost of this order"
                error={s.errors?.bankCharges}
              >
                <MoneyInput
                  id="rb-charges"
                  name="bankCharges"
                  currency={currency}
                  value={charges}
                  onChange={(e) => setCharges(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <AccountSelect
                id="rb-account"
                label="Into"
                currency={a.received}
                defaultValue={s.values?.accountId}
                error={s.errors?.accountId}
              />
              <Field label="Reference" htmlFor="rb-reference" optional error={s.errors?.reference}>
                <Input
                  id="rb-reference"
                  name="reference"
                  maxLength={120}
                  defaultValue={s.values?.reference ?? ""}
                  placeholder="MT103 / credit advice no."
                />
              </Field>
              <FilePicker id="rb-file" label="Credit advice" hint="MT103 / bank slip · photo or PDF" file={file} onChange={setFile} />
              {!a.same && (
                <Field
                  label="Rate"
                  htmlFor="rb-rate"
                  hint={
                    a.settingsRate ? "from Settings · change it to the rate you agreed" : "no rate in Settings: type the rate you agreed"
                  }
                  error={s.errors?.rate}
                >
                  <div className="flex items-center gap-2 text-sm text-text-2">
                    <span className="shrink-0">1 {currency} =</span>
                    <Input
                      id="rb-rate"
                      name="rate"
                      inputMode="decimal"
                      className="w-28 tabular"
                      value={a.rate}
                      onChange={(e) => a.setRate(e.target.value)}
                    />
                    <span>{a.received}</span>
                  </div>
                </Field>
              )}
              <Field
                label="Note"
                htmlFor="rb-note"
                optional
                error={s.errors?.note}
                className={cn(a.same ? "@lg:col-span-2 @2xl:col-span-3" : "@2xl:col-span-2")}
              >
                <Input id="rb-note" name="note" maxLength={1000} defaultValue={s.values?.note ?? ""} />
              </Field>
            </div>
            <dl
              className="grid gap-2 self-start rounded-lg border border-line bg-surface-2 p-3.5 text-sm @2xl:grid-cols-3 @2xl:gap-4 @5xl:grid-cols-1 @5xl:gap-2"
              aria-label="The money check"
            >
              <div className={CHECK_ROW}>
                <dt className="text-text-2">Balance due</dt>
                <dd className="font-semibold tabular">{fmt(dueMinor, currency)}</dd>
              </div>
              <div className={CHECK_ROW}>
                <dt className="text-text-2">Credited + charges</dt>
                <dd className="font-semibold tabular">{fmt(a.countsMinor + chargesMinor, currency)}</dd>
              </div>
              <div
                className={cn(
                  CHECK_ROW,
                  "border-t border-line pt-2 @2xl:border-t-0 @2xl:border-l @2xl:pt-0 @2xl:pl-4 @5xl:border-t @5xl:border-l-0 @5xl:pt-2 @5xl:pl-0",
                )}
              >
                <dt className="font-semibold">Left due</dt>
                <dd className={cn("font-bold tabular", leftDue === 0 ? "text-ok" : "text-text")}>{fmt(leftDue, currency)}</dd>
              </div>
              {leftMinor > 0 && (
                <dd className="text-xs text-text-2 @2xl:col-span-3 @5xl:col-span-1">
                  {fmt(leftMinor, currency)} more than is due: kept as {customer}&apos;s credit.
                </dd>
              )}
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface-2 px-4 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <SubmitButton
              size="sm"
              className="max-sm:h-11 max-sm:flex-1"
              pendingText={file ? "Recording, sending the file…" : "Recording…"}
              disabled={a.countsMinor <= 0 || chargesMinor > dueMinor}
            >
              Record and tick
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" className="max-sm:hidden" onClick={band.close}>
              Cancel
            </Button>
            <span className="text-xs text-muted max-sm:hidden">Records the payment and ticks the bank step together.</span>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- credit on an order */

/** "Use credit": pays (part of) the order from the customer's credit. */
export function UseCredit({ action, credit, due, currency, today }: { action: Action; credit: string; due: string; currency: string; today: string }) {
  const [open, setOpen] = useState(false);
  const most = Math.min(toMinor(credit), toMinor(due));
  if (most <= 0) return null;
  if (!open)
    return (
      <Button size="sm" variant="secondary" className="w-fit" onClick={() => setOpen(true)}>
        Use credit ({fmt(toMinor(credit), currency)})
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className={framed}>
      {(s) => (
        <>
          <p className="text-sm font-medium">Pay from the customer&apos;s credit</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="uc-amount" hint={`Up to ${fmt(most, currency)}`} error={s.errors?.amount}>
              <MoneyInput id="uc-amount" name="amount" currency={currency} defaultValue={s.values?.amount ?? fromMinor(most)} />
            </Field>
            <Field label="On" htmlFor="uc-on" error={s.errors?.on}>
              <Input id="uc-on" name="on" type="date" max={today} defaultValue={s.values?.on ?? today} />
            </Field>
          </div>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Use the credit
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

/* ---------------------------------------------------------------- one transfer, several orders */

export interface OpenOrderRow {
  id: string;
  refNo: string;
  currency: string;
  orderedOn: string;
  due: string;
  next: { label: string; dueOn: string | null; open: string } | null;
}

/**
 * "One transfer, two orders" (MoneyV2Split): what arrived, then the customer's
 * open orders in that currency, oldest due first, each taking what it owes;
 * change any line. The rest is kept as the customer's credit.
 */
export function ReceiptForm({ action, customer, orders, fx, today }: { action: Action; customer: string; orders: OpenOrderRow[]; fx: Fx; today: string }) {
  const [open, setOpen] = useState(false);
  const currencies = [...new Set(orders.map((o) => o.currency))];
  const [currency, setCurrency] = useState(currencies[0] ?? fx.main);
  if (!open)
    return (
      <Button size="sm" variant="primary" className="w-fit" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Record money received
      </Button>
    );
  return <ReceiptFields key={currency} action={action} customer={customer} orders={orders} currencies={currencies} currency={currency} setCurrency={setCurrency} fx={fx} today={today} onClose={() => setOpen(false)} />;
}

function ReceiptFields({
  action,
  customer,
  orders,
  currencies,
  currency,
  setCurrency,
  fx,
  today,
  onClose,
}: {
  action: Action;
  customer: string;
  orders: OpenOrderRow[];
  currencies: string[];
  currency: string;
  setCurrency: (c: string) => void;
  fx: Fx;
  today: string;
  onClose: () => void;
}) {
  const a = useArrival(fx, currency);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const mine = orders.filter((o) => o.currency === currency && Number(o.due) > 0);
  const auto = useMemo(
    () =>
      allocateOldestFirst(
        // Each order's next part (the deposit, the balance…): more can be typed on a line, up to what it owes.
        mine.map((o) => ({ id: o.id, dueOn: o.next?.dueOn ?? null, orderedOn: o.orderedOn, openMinor: toMinor(o.next?.open ?? o.due) })),
        a.countsMinor,
      ),
    [mine, a.countsMinor],
  );
  const order = auto.takes.map((t) => mine.find((o) => o.id === t.id)!);
  const takes = (id: string) => (typed[id] !== undefined ? toMinor(typed[id]) : (auto.takes.find((t) => t.id === id)?.takesMinor ?? 0));
  const used = order.reduce((t, o) => t + takes(o.id), 0);
  const leftMinor = a.countsMinor - used;
  const parts = order.filter((o) => takes(o.id) > 0).map((o) => ({ orderId: o.id, amount: fromMinor(takes(o.id)) }));
  const over = order.find((o) => takes(o.id) > toMinor(o.due));
  return (
    <ActionForm action={action} onDone={onClose} keepFields className={framed}>
      {(s) => (
        <>
          <div className="-mx-3 -mt-3 border-b border-line px-3 py-2.5 sm:-mx-4 sm:-mt-4 sm:px-4">
            <p className="font-semibold">One transfer, several orders</p>
            <p className="text-xs text-text-2">Oldest due first is filled in for you; change any line. The rest is kept as {customer}&apos;s credit.</p>
          </div>
          <input type="hidden" name="currency" value={currency} />
          <input type="hidden" name="receivedCurrency" value={a.received} />
          <input type="hidden" name="method" value={method} />
          <input type="hidden" name="parts" value={JSON.stringify(parts)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Received" htmlFor="rc-amount" hint="the amount as it arrived" error={s.errors?.receivedAmount}>
              <div className="flex flex-col gap-2">
                <CurrencySelect short aria-label="Currency it arrived in" value={a.received} onChange={(e) => a.setReceived(e.target.value)} className="w-28" />
                <MoneyInput id="rc-amount" name="receivedAmount" currency={a.received} value={a.amount} onChange={(e) => a.setAmount(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
            <AccountSelect id="rc-account" label="Into" currency={a.received} defaultValue={s.values?.accountId} error={s.errors?.accountId} />
            <Field label="Paid on" htmlFor="rc-on" error={s.errors?.paidOn}>
              <Input id="rc-on" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? today} />
            </Field>
            <Field label="How" htmlFor="rc-method">
              <Select id="rc-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="rc-ref" optional error={s.errors?.reference}>
              <Input id="rc-ref" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
            </Field>
            <Field label="Paid by" htmlFor="rc-by" optional hint="when someone pays for the customer">
              <Input id="rc-by" name="paidByName" maxLength={120} defaultValue={s.values?.paidByName ?? ""} />
            </Field>
            {currencies.length > 1 && (
              <Field label="Pays orders in" htmlFor="rc-cur">
                <Select id="rc-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            )}
            {!a.same && (
              <Field label="Rate" htmlFor="rc-rate" hint="from Settings · change it to the rate you agreed" error={s.errors?.rate}>
                <div className="flex items-center gap-2 text-sm text-text-2">
                  <span className="shrink-0">1 {currency} =</span>
                  <Input id="rc-rate" name="rate" inputMode="decimal" className="w-28 tabular" value={a.rate} onChange={(e) => a.setRate(e.target.value)} />
                  <span>{a.received}</span>
                </div>
              </Field>
            )}
          </div>
          <div className={box}>
            <p className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-text-2">Counts as</span>
              <span className="font-semibold tabular">{fmt(a.countsMinor, currency)}</span>
            </p>
            {order.length === 0 ? (
              <p className="text-sm text-muted">No open {currency} orders: it all becomes {customer}&apos;s credit.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[22rem] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-2">
                      <th scope="col" className="py-1.5 pr-2 font-medium">Order</th>
                      <th scope="col" className="py-1.5 pr-2 font-medium">What for</th>
                      <th scope="col" className="py-1.5 pr-2 text-right font-medium">Due</th>
                      <th scope="col" className="py-1.5 text-right font-medium">Takes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.map((o) => (
                      <tr key={o.id} className="border-t border-line">
                        <td className="py-2 pr-2 font-mono text-xs">{o.refNo}</td>
                        <td className="py-2 pr-2">
                          {o.next?.label ?? "Balance"}
                          {o.next?.dueOn && <span className="block text-xs text-muted">due {shortDay(o.next.dueOn)}</span>}
                        </td>
                        <td className="py-2 pr-2 text-right tabular">{grouped(o.due)}</td>
                        <td className="py-2 text-right">
                          <div className="ml-auto w-40">
                            <MoneyInput
                              aria-label={`${o.refNo} takes`}
                              currency={currency}
                              className="text-right"
                              value={typed[o.id] ?? fromMinor(takes(o.id))}
                              onChange={(e) => setTyped((t) => ({ ...t, [o.id]: e.target.value }))}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-line">
                      <td colSpan={3} className="py-2 pr-2 text-right font-semibold">
                        Customer credit
                      </td>
                      <td className={cn("py-2 text-right font-semibold tabular", leftMinor < 0 && "text-bad")}>{fromMinor(leftMinor)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {over && <p className="text-xs text-bad">{over.refNo} takes more than it owes.</p>}
            {leftMinor > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-info/30 bg-info-soft px-2.5 py-2 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                {fmt(leftMinor, currency)} more than is due: kept as {customer}&apos;s credit, to use on the next order or refund.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingText="Recording…" disabled={a.countsMinor <= 0 || leftMinor < 0 || !!over}>
              Record the payment
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- the customer's credit */

/**
 * "Customer credit" (MoneyV2Split, right): what we hold for the customer, its
 * ledger, and the two things to do with it: use it on an order, or refund it.
 */
export function CustomerCredit({
  customer,
  credit,
  orders,
  useActions,
  refundAction,
  voidActions,
  canManage,
  today,
}: {
  customer: string;
  credit: CustomerCreditView;
  /** Open orders the credit can pay (with what they still owe). */
  orders: { id: string; refNo: string; currency: string; due: string }[];
  useActions: Record<string, Action>;
  refundAction: Action;
  voidActions: Record<string, Action>;
  canManage: boolean;
  today: string;
}) {
  const [doing, setDoing] = useState<"use" | "refund" | null>(null);
  const [orderId, setOrderId] = useState("");
  const main = credit.balances[0] ?? null;
  const usable = orders.filter((o) => credit.balances.some((b) => b.currency === o.currency && Number(b.amount) > 0) && Number(o.due) > 0);
  const chosen = usable.find((o) => o.id === orderId) ?? usable[0];
  const sign = (k: string) => (k === "in" ? 1 : k === "fee" ? 0 : -1);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-xs text-text-2">{customer} has credit</p>
        <p className="text-2xl font-semibold tabular">
          {credit.balances.length ? credit.balances.map((b) => fmt(toMinor(b.amount), b.currency)).join(" + ") : "None"}
        </p>
        <p className="text-xs text-muted">Shown on Money › Customers owe us as a minus, and offered when their next order wants a deposit.</p>
      </div>
      {credit.entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-text-2">
                <th scope="col" className="py-1.5 pr-2 font-medium">When</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">What</th>
                <th scope="col" className="py-1.5 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {credit.entries.map((e) => (
                <tr key={e.id} className={cn("border-t border-line", e.voided && "text-muted line-through")}>
                  <td className="py-2 pr-2 whitespace-nowrap">{shortDay(e.on)}</td>
                  <td className="py-2 pr-2">
                    {e.kind === "in" && e.receipt ? `Left over from ${e.receipt.received.replace(/[\d.]+$/, (n) => grouped(n))}` : (e.note ?? CREDIT_KIND_LABEL[e.kind])}
                    {e.account && <span className="block text-xs text-muted">from {e.account.name}</span>}
                    {canManage && !e.voided && e.kind === "refund" && voidActions[e.id] && <RemoveEntry action={voidActions[e.id]!} />}
                  </td>
                  <td className="py-2 text-right tabular">
                    {sign(e.kind) === 0 ? <span className="text-muted">fee {grouped(e.amount)}</span> : `${sign(e.kind) > 0 ? "+" : "−"}${grouped(e.amount)}`}
                  </td>
                </tr>
              ))}
              {main && (
                <tr className="border-t border-line font-semibold">
                  <td />
                  <td className="py-2 pr-2">Balance</td>
                  <td className="py-2 text-right tabular">{credit.balances.map((b) => fmt(toMinor(b.amount), b.currency)).join(" + ")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {credit.canRecord && main && doing === null && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDoing("use")} disabled={!usable.length}>
            Use on an order
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDoing("refund")}>
            Refund it
          </Button>
        </div>
      )}
      {doing === "use" && chosen && (
        <ActionForm key={chosen.id} action={useActions[chosen.id]!} onDone={() => setDoing(null)} className={framed}>
          {(s) => (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Order" htmlFor="cu-order">
                  <Select id="cu-order" value={chosen.id} onChange={(e) => setOrderId(e.target.value)}>
                    {usable.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.refNo} · {fmt(toMinor(o.due), o.currency)} due
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount" htmlFor="cu-amount" error={s.errors?.amount}>
                  <MoneyInput
                    id="cu-amount"
                    name="amount"
                    currency={chosen.currency}
                    defaultValue={fromMinor(Math.min(toMinor(chosen.due), toMinor(credit.balances.find((b) => b.currency === chosen.currency)?.amount ?? "0")))}
                  />
                </Field>
                <Field label="On" htmlFor="cu-on">
                  <Input id="cu-on" name="on" type="date" max={today} defaultValue={today} />
                </Field>
              </div>
              <div className="flex gap-2">
                <SubmitButton size="sm" pendingText="Saving…">
                  Use the credit
                </SubmitButton>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDoing(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </ActionForm>
      )}
      {doing === "refund" && main && <RefundForm action={refundAction} balances={credit.balances} today={today} onClose={() => setDoing(null)} />}
    </div>
  );
}

function RefundForm({ action, balances, today, onClose }: { action: Action; balances: { currency: string; amount: string }[]; today: string; onClose: () => void }) {
  const [currency, setCurrency] = useState(balances[0]!.currency);
  const most = balances.find((b) => b.currency === currency)?.amount ?? "0";
  return (
    <ActionForm action={action} onDone={onClose} keepFields className={framed}>
      {(s) => (
        <>
          <p className="text-sm font-medium">Refund the credit</p>
          <input type="hidden" name="currency" value={currency} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount" htmlFor="cr-amount" hint={`Up to ${fmt(toMinor(most), currency)}`} error={s.errors?.amount}>
              <div className="flex gap-2">
                {balances.length > 1 && (
                  <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24 shrink-0">
                    {balances.map((b) => (
                      <option key={b.currency}>{b.currency}</option>
                    ))}
                  </Select>
                )}
                <MoneyInput key={currency} id="cr-amount" name="amount" currency={currency} defaultValue={fromMinor(toMinor(most))} />
              </div>
            </Field>
            <AccountSelect id="cr-account" label="Paid from" currency={currency} defaultValue={s.values?.accountId} error={s.errors?.accountId} />
            <Field label="On" htmlFor="cr-on" error={s.errors?.on}>
              <Input id="cr-on" name="on" type="date" max={today} defaultValue={s.values?.on ?? today} />
            </Field>
          </div>
          <Field label="Note" htmlFor="cr-note" optional>
            <Input id="cr-note" name="note" maxLength={500} defaultValue={s.values?.note ?? ""} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Record the refund
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

/** Remove a refund (or a transfer) recorded by mistake, with a reason. */
export function RemoveEntry({ action, label = "Remove" }: { action: Action; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="danger-ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className="mt-1 flex flex-wrap items-end gap-2">
      {(s) => (
        <>
          <Field label="Why?" htmlFor="re-reason" error={s.errors?.reason} className="min-w-0 flex-1">
            <Input id="re-reason" name="reason" placeholder="e.g. recorded twice" />
          </Field>
          <SubmitButton size="sm" variant="danger" pendingText="Removing…">
            Remove
          </SubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Keep
          </Button>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- the plan (LineTable) */

const STATUS_TONE: Record<InstalmentStatus, "ok" | "info" | "warn" | "bad" | "neutral"> = {
  paid: "ok",
  part_paid: "info",
  due_soon: "warn",
  late: "bad",
  open: "neutral",
};
const fixed = async (): Promise<LineResult> => ({ ok: false, message: "Change the plan with “Change the plan”." });
/** The line table's tools for adding, pasting and moving lines do not apply to a read-only money table. */
const readOnlyTable = "[&_tr[aria-label^='New_']]:hidden [&_[role=toolbar]]:hidden [&_button:has(>.lucide-clipboard-paste)]:hidden [&>div>div:has(>details)]:hidden";

/** The plan as the same line table as the order (No., Part, How, Due, Amount, Received, Status) with the totals under it. */
export function PlanLines({ plan, currency, total, received, due }: { plan: OrderMoney["plan"]; currency: string; total: string; received: string; due: string }) {
  const rows: LineRow[] = plan.items.map((i) => ({
    key: i.id,
    parentKey: null,
    values: { label: i.label, how: i.how, due: dueText(i), amount: fromMinor(toMinor(i.amount)), paid: fromMinor(toMinor(i.paid)), status: i.status, paidOn: "" },
  }));
  const columns: LineColumn[] = [
    // Fixed widths: the line table gives a flexible column 16rem at least, more than a step page's card has.
    { key: "label", label: "Part", width: "8rem" },
    { key: "how", label: "How", width: "7rem", phoneHidden: true },
    { key: "due", label: "Due", width: "7.5rem" },
    { key: "amount", label: `Amount ${currency}`, width: "6.5rem", align: "right", format: (v) => <span className="tabular">{grouped(v.amount)}</span> },
    { key: "paid", label: "Received", width: "6rem", align: "right", phoneHidden: true, format: (v) => <span className="tabular">{grouped(v.paid)}</span> },
    {
      key: "status",
      label: "Status",
      width: "6.5rem",
      format: (v) => (
        <Badge tone={STATUS_TONE[v.status as InstalmentStatus]} dot>
          {INSTALMENT_STATUS_LABEL[v.status as InstalmentStatus]}
        </Badge>
      ),
    },
  ];
  return (
    <div className={cn("flex flex-col gap-2", readOnlyTable)}>
      <LineTable
        rows={rows}
        columns={columns}
        noun="part"
        readOnly
        flat
        onAdd={fixed}
        onEdit={fixed}
        onRemove={fixed}
        onMove={fixed}
        empty="No plan yet."
        footer={
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
            <span className="text-muted">
              Order total <span className="font-semibold text-text tabular">{fmt(toMinor(total), currency)}</span>
            </span>
            <span className="text-muted">
              Received <span className="font-semibold text-text tabular">{fmt(toMinor(received), currency)}</span>
            </span>
            <span className="text-muted">
              Still due <span className="font-semibold text-text tabular">{fmt(toMinor(due), currency)}</span>
            </span>
          </div>
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------- LC checks */

/** "The LC against the order" (MoneyV2Route, right): each check ticked from the data, a failing one in red. */
export function LcChecks({ checks }: { checks: LcCheck[] }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="The LC against the order">
      {checks.map((c) => (
        <li
          key={c.key}
          className={cn("flex items-start gap-3 rounded-lg px-2.5 py-2", c.ok === false && "bg-bad-soft")}
          aria-label={`${c.label}: ${c.ok === true ? "matches" : c.ok === false ? "does not match" : "not known yet"}`}
        >
          {c.ok === true ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
          ) : c.ok === false ? (
            <Square className="mt-0.5 size-5 shrink-0 text-bad" aria-hidden />
          ) : (
            <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
          )}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
              {c.label}
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted">
                <Lock className="size-3" aria-hidden /> checked
              </span>
            </span>
            <span className={cn("block text-xs", c.ok === false ? "text-bad" : "text-text-2")}>{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- the factory payment plan */

const FACTORY_TONE: Record<FactoryPlanStatus, "ok" | "info" | "warn" | "bad" | "neutral"> = { paid: "ok", part: "info", due: "warn", late: "bad", later: "neutral" };

/**
 * "What we pay {factory}" (MoneyV2Factory): the advance when we order and the
 * balance when they say ready (its date follows the ready date), or on a fixed
 * day; each part with what is paid on it, and Pay for the next one.
 */
export function FactoryPlanCard({
  plan,
  action,
  canPlan,
  pay,
  paidInOrder,
  orderCurrency,
}: {
  plan: FactoryPlanView;
  action: Action;
  canPlan: boolean;
  /** "Pay" for the next part (the factory payment form filled in), when allowed. */
  pay: ReactNode;
  /** What was paid so far, in the order's currency at the rates used. */
  paidInOrder: string | null;
  orderCurrency: string;
}) {
  const advanceRow = plan.rows.find((r) => r.dueRule === "on_order");
  const balanceRow = plan.rows.find((r) => r.dueRule !== "on_order");
  const [advance, setAdvance] = useState(String(advanceRow?.percent ?? 0));
  const [rule, setRule] = useState<FactoryDueRule>((balanceRow?.dueRule as FactoryDueRule) ?? "on_ready");
  const [fixedOn, setFixedOn] = useState(balanceRow?.dueOn ?? "");
  const owedMinor = toMinor(plan.owed);
  const p = Math.min(Math.max(num(advance), 0), 100);
  const advanceMinor = Math.round((owedMinor * p) / 100);
  const changed = String(advanceRow?.percent ?? 0) !== advance || (balanceRow?.dueRule ?? "on_ready") !== rule || (rule === "fixed" && fixedOn !== (balanceRow?.dueOn ?? ""));
  const items = [
    ...(advanceMinor > 0 ? [{ label: `Advance ${p}%`, percent: p, amount: fromMinor(advanceMinor), dueRule: "on_order", dueOn: null }] : []),
    ...(owedMinor - advanceMinor > 0
      ? [{ label: advanceMinor > 0 ? `Balance ${Math.round((100 - p) * 100) / 100}%` : "Payment", percent: 100 - p, amount: fromMinor(owedMinor - advanceMinor), dueRule: rule, dueOn: rule === "fixed" ? fixedOn || null : null }]
      : []),
  ];
  const rows: LineRow[] = plan.rows.map((r, i) => ({
    key: `${i}`,
    parentKey: null,
    values: {
      label: r.label,
      due: `${r.due ? day(r.due) : "not known yet"} · ${FACTORY_DUE_RULE_LABEL[r.dueRule]}`,
      amount: fromMinor(toMinor(r.amount)),
      // The line table keeps only its columns' values: the days ride along with the status.
      status: `${r.status}|${r.inDays === null ? "" : r.inDays}`,
    },
  }));
  const columns: LineColumn[] = [
    { key: "label", label: "Part", width: "8rem" },
    { key: "due", label: "Due", width: "13rem" },
    { key: "amount", label: `Amount ${plan.currency}`, width: "8.5rem", align: "right", format: (v) => <span className="tabular">{grouped(v.amount)}</span> },
    {
      key: "status",
      label: "Paid",
      width: "9rem",
      format: (v) => {
        const [status, days] = (v.status ?? "").split("|");
        const st = status as FactoryPlanStatus;
        const d = days === "" || days === undefined ? null : Number(days);
        const text = st === "paid" ? "Paid" : st === "late" ? `Late ${d !== null ? `${-d} days` : ""}` : st === "due" ? (d === 0 ? "Due today" : `Due in ${d} days`) : d !== null && d > 0 ? `Due in ${d} days` : FACTORY_PLAN_STATUS_LABEL[st];
        return <Badge tone={FACTORY_TONE[st]}>{text}</Badge>;
      },
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {canPlan && (
        <ActionForm action={action} keepFields showSuccess={false} className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
          {(s) => (
            <>
              <input type="hidden" name="payload" value={JSON.stringify({ factoryId: plan.factory.id, items })} />
              <Field label="Advance" htmlFor={`fa-${plan.factory.id}`} error={s.errors?.items}>
                <div className="flex items-center gap-2 text-sm text-text-2">
                  <Input id={`fa-${plan.factory.id}`} inputMode="decimal" className="w-20 tabular" value={advance} onChange={(e) => setAdvance(e.target.value)} />% when we order
                </div>
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Balance" htmlFor={`fb-${plan.factory.id}`} className="min-w-0 flex-1 basis-56">
                  <Select id={`fb-${plan.factory.id}`} value={rule} onChange={(e) => setRule(e.target.value as FactoryDueRule)}>
                    <option value="on_ready">{Math.round((100 - p) * 100) / 100}% when they say ready (before shipping)</option>
                    <option value="fixed">{Math.round((100 - p) * 100) / 100}% on a fixed date</option>
                    <option value="on_order">{Math.round((100 - p) * 100) / 100}% when we order too</option>
                  </Select>
                </Field>
                {rule === "fixed" && <Input aria-label="Balance due on" type="date" className="w-40" value={fixedOn} onChange={(e) => setFixedOn(e.target.value)} />}
                {(changed || !plan.saved) && (
                  <SubmitButton size="sm" variant="secondary" pendingText="Saving…" disabled={rule === "fixed" && !fixedOn}>
                    {plan.saved ? "Save the plan" : "Keep this plan"}
                  </SubmitButton>
                )}
              </div>
            </>
          )}
        </ActionForm>
      )}
      {!plan.saved && <p className="text-xs text-muted">The company&apos;s usual plan; it is kept for this order when the factory is ordered or saved here.</p>}
      {plan.differs && (
        <p className="flex items-center gap-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
          <AlertTriangle className="size-3.5 text-warn" aria-hidden /> The parts do not add up to what we owe ({plan.currency} {plan.differs}). Save the plan again.
        </p>
      )}
      <div className={cn("flex flex-col gap-2", readOnlyTable)}>
        <LineTable
          rows={rows}
          columns={columns}
          noun="part"
          readOnly
          flat
          onAdd={fixed}
          onEdit={fixed}
          onRemove={fixed}
          onMove={fixed}
          footer={
            <div className="flex flex-wrap justify-end gap-x-6 text-sm">
              <span className="text-muted">
                We owe them <span className="font-semibold text-text tabular">{fmt(owedMinor, plan.currency)}</span>
              </span>
            </div>
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <dl className="flex flex-col gap-1.5 rounded-xl border border-line px-4 py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-text-2">Paid so far</dt>
            <dd className="font-semibold tabular">
              {fmt(toMinor(plan.paid), plan.currency)}
              {paidInOrder && plan.currency !== orderCurrency && Number(plan.paid) > 0 ? ` = ${fmt(toMinor(paidInOrder), orderCurrency)}` : ""}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-text-2">Still to pay</dt>
            <dd className="font-semibold tabular">{fmt(toMinor(plan.toPay), plan.currency)}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3 text-sm text-text-2">
          <p>
            The balance gets its date from the ready date: when the factory changes it, so does the due date. It shows on Home when due, on the Production step as
            &lsquo;Balance paid to the factory&rsquo;, and on Money › We owe factories.
          </p>
          {pay}
        </div>
      </div>
    </div>
  );
}
