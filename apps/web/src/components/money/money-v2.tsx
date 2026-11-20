"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Circle, Info, Lock, Plus, Square } from "lucide-react";
import { divideMinor, formatMinor, fromMinor, toMinor, type Minor } from "@kebo/money";
import { allocateOldestFirst, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type LcCheck, type PaymentMethod } from "@kebo/shared";
import { Button, cn, Field, Input, RULES, Select, Textarea, Notice, EmptyLine, RefCode } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { FormButtons } from "@/components/common/route-window";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { MoneyInput } from "@/components/common/money-input";
import { rateOf, type Fx } from "@/lib/fx";
import type { ActionState } from "@/lib/actions";

import { AccountSelect, RecordedBy } from "./accounts";
import { FilePicker, useSaveThenSend } from "./attachment";
import { useTime } from "@/lib/time-client";

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
  startOpen = false,
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
  /** Open at once (the Record payment page), not behind its button. */
  startOpen?: boolean;
  /** What arrived, filled in (a part of the plan: what is still to come on it). */
  amount?: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [fileError, setFileError] = useState<string | null>(null);
  if (Number(due) <= 0) return <p className="text-sm text-muted">Paid in full: nothing more to record.</p>;
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {fileError && <Notice tone="bad">{fileError}</Notice>}
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

export function ReceivedFields({
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
  bare,
  amount,
  verify,
}: Omit<Parameters<typeof ReceivedForm>[0], "label" | "quiet"> & {
  onClose: () => void;
  onFileError: (m: string) => void;
  /** In a window that already has the title: no frame, no heading. */
  bare?: boolean;
  /** The person only sends money for a manager to verify: it is kept waiting, with its slip, and counts once verified. */
  verify?: boolean;
}) {
  const dueMinor = toMinor(due);
  const a = useArrival(fx, currency, amount);
  const [charges, setCharges] = useState("");
  const [part, setPart] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [file, setFile] = useState<File | null>(null);
  const chargesMinor = toMinor(charges);
  const auto = Math.max(Math.min(a.countsMinor, dueMinor - chargesMinor), 0);
  const partMinor = part === null ? auto : toMinor(part);
  const leftMinor = a.countsMinor - partMinor;
  const tooMuch = partMinor + chargesMinor > dueMinor;
  // The slip goes with the save itself: the page re-draws once the payment is saved.
  const save = useSaveThenSend(action, file, (id) => (verify ? `/files/submissions/${id}` : `/files/payments/${id}`), verify ? "The payment is sent to verify" : "The payment is recorded", onFileError);
  const done = () => onClose();
  return (
    <ActionForm action={save} onDone={done} keepFields className={bare ? "flex flex-col gap-3" : framed}>
      {(s) => (
        <>
          {!bare && (
            <div className="-mx-3 -mt-3 border-b border-line px-3 py-2.5 sm:-mx-4 sm:-mt-4 sm:px-4">
              <p className="font-semibold">Money received from {customer}</p>
              <p className="text-xs text-text-2">
                Record what really happened: the currency and account it arrived in, who paid, and the rate. The system works out what it covers on the order.
              </p>
            </div>
          )}
          <input type="hidden" name="receivedCurrency" value={a.received} />
          <input type="hidden" name="amount" value={fromMinor(Math.max(partMinor, 0))} />
          <input type="hidden" name="method" value={method} />
          <div className={RULES.form.fields}>
            <Field label="Amount" htmlFor="r-amount" error={s.errors?.receivedAmount ?? s.errors?.amount}>
              <div className="flex flex-col gap-2">
                <CurrencySelect short aria-label="Currency it arrived in" value={a.received} onChange={(e) => a.setReceived(e.target.value)} className="w-28" />
                <MoneyInput id="r-amount" name="receivedAmount" currency={a.received} value={a.amount} onChange={(e) => a.setAmount(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
            <AccountSelect id="r-account" label="Into account" currency={a.received} defaultValue={s.values?.accountId} error={s.errors?.accountId} />
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
            <Field label="Paid by" htmlFor="r-paidBy" optional error={s.errors?.paidByName}>
              <Input id="r-paidBy" name="paidByName" maxLength={120} defaultValue={s.values?.paidByName ?? ""} placeholder={customer} />
            </Field>
            {!a.same && (
              <Field label="Rate" htmlFor="r-rate" hint={a.settingsRate ? undefined : "No rate in Settings: type the rate you agreed"} error={s.errors?.rate}>
                <div className="flex items-center gap-2 text-sm text-text-2">
                  <span className="shrink-0">1 {currency} =</span>
                  <Input id="r-rate" name="rate" inputMode="decimal" className="w-28 tabular" value={a.rate} onChange={(e) => a.setRate(e.target.value)} />
                  <span>{a.received}</span>
                </div>
              </Field>
            )}
            <Field label="Reference" htmlFor="r-reference" optional error={s.errors?.reference}>
              <Input id="r-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
            </Field>
            {method === "bank_transfer" && (
              <Field label="Bank charges" htmlFor="r-charges" optional error={s.errors?.bankCharges}>
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
                    <td className="py-2 pr-2">
                      <RefCode>{refNo}</RefCode>
                    </td>
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
          <RecordedBy verify={verify} />
          <FilePicker id="r-file" label="Receipt or bank slip" hint="Photo or PDF" file={file} onChange={setFile} />
          <FormButtons onCancel={onClose}>
            <SubmitButton pendingText={file ? "Sending, with the file…" : verify ? "Sending…" : "Recording…"} disabled={a.countsMinor <= 0 || tooMuch || leftMinor < 0}>
              {verify ? "Send to verify" : "Record the payment"}
            </SubmitButton>
          </FormButtons>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- money reached us (the bank step) */

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
          <FormButtons onCancel={() => setOpen(false)}>
            <SubmitButton pendingText="Saving…">Use the credit</SubmitButton>
          </FormButtons>
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
export function ReceiptForm({
  action,
  customer,
  orders,
  fx,
  today,
  startOpen = false,
}: {
  action: Action;
  customer: string;
  orders: OpenOrderRow[];
  fx: Fx;
  today: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const currencies = [...new Set(orders.map((o) => o.currency))];
  const [currency, setCurrency] = useState(currencies[0] ?? fx.main);
  if (!open)
    return (
      <Button size="sm" variant="secondary" className="w-fit" onClick={() => setOpen(true)}>
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
  const { dayMonth } = useTime();
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
            <p className="text-xs text-text-2">Oldest due first is filled in for you; change any amount. The rest is kept as {customer}&apos;s credit.</p>
          </div>
          <input type="hidden" name="currency" value={currency} />
          <input type="hidden" name="receivedCurrency" value={a.received} />
          <input type="hidden" name="method" value={method} />
          <input type="hidden" name="parts" value={JSON.stringify(parts)} />
          <div className={RULES.form.fields}>
            <Field label="Received" htmlFor="rc-amount" error={s.errors?.receivedAmount}>
              <div className="flex flex-col gap-2">
                <CurrencySelect short aria-label="Currency it arrived in" value={a.received} onChange={(e) => a.setReceived(e.target.value)} className="w-28" />
                <MoneyInput id="rc-amount" name="receivedAmount" currency={a.received} value={a.amount} onChange={(e) => a.setAmount(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
            <AccountSelect id="rc-account" label="Into account" currency={a.received} defaultValue={s.values?.accountId} error={s.errors?.accountId} />
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
            <Field label="Paid by" htmlFor="rc-by" optional>
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
              <Field label="Rate" htmlFor="rc-rate" error={s.errors?.rate}>
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
              <EmptyLine>No open {currency} orders: it all becomes {customer}&apos;s credit.</EmptyLine>
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
                        <td className="py-2 pr-2">
                          <RefCode>{o.refNo}</RefCode>
                        </td>
                        <td className="py-2 pr-2">
                          {o.next?.label ?? "Balance"}
                          {o.next?.dueOn && <span className="block text-xs text-muted">due {dayMonth(o.next.dueOn)}</span>}
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
          <FormButtons onCancel={onClose}>
            <SubmitButton pendingText="Recording…" disabled={a.countsMinor <= 0 || leftMinor < 0 || !!over}>
              Record the payment
            </SubmitButton>
          </FormButtons>
        </>
      )}
    </ActionForm>
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

