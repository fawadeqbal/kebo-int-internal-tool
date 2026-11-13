"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Camera, Pencil, Plus, X } from "lucide-react";
import {
  EXPENSE_BEARER_HINT,
  EXPENSE_BEARER_LABEL,
  EXPENSE_BEARERS,
  expenseShort,
  ORDER_EXPENSE_CHIPS,
  type ExpenseBearer,
  type ExpenseCategory,
  type FlowStep,
} from "@kebo/shared";
import { Alert, Button, cn, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { MoneyInput } from "@/components/common/money-input";
import { useAccounts } from "@/components/money/accounts";
import { uploadReceipt, VoidForm } from "@/components/money/forms";
import { expenseAction, voidExpenseAction } from "@/app/(app)/money/actions";
import type { ActionState } from "@/lib/actions";
import { date, money } from "@/lib/format";
import { rateOf, type Fx } from "@/lib/fx";
import type { Person } from "@/lib/types";
import type { CostExpense } from "@/lib/types-money";

/** What the order's expense form needs, read once per page (see costs-data). */
export interface ExpenseSetup {
  orderId: string;
  refNo: string;
  orderCurrency: string;
  mainCurrency: string;
  fx: Fx;
  today: string;
  people: Person[];
  /** Who is adding it: "Paid by" starts with them. */
  me: string | null;
  steps: { key: FlowStep; number: number; label: string }[];
  /** The factories on the order (one of them can bear a cost). */
  factories: { id: string; name: string }[];
  canEdit: boolean;
}

export interface ExpensePrefill {
  category?: ExpenseCategory;
  description?: string;
  step?: FlowStep | null;
  /** An amount already typed elsewhere on the order (the freight on its shipment). */
  amount?: string;
  currency?: string;
}

const PLACEHOLDER: Partial<Record<ExpenseCategory, string>> = {
  freight: "e.g. Sea freight Ningbo → Karachi",
  inland_transport: "e.g. Truck Wenzhou → Ningbo port",
  inspection: "e.g. Pre-shipment inspection, SGS",
  customs: "e.g. Export clearance",
  insurance: "e.g. Cargo insurance",
  bank_charges: "e.g. LC advising fee",
  travel: "e.g. Train Jinan → Wenzhou, factory visit",
  hotel: "e.g. 1 night Wenzhou, factory visit",
  meals: "e.g. Dinner with the factory",
  courier: "e.g. DHL · drawings to the factory",
  commission: "e.g. Agent's commission",
};

const num = (v: string) => Number(v.replace(/,/g, "").trim());
const rateText = (r: number) => String(Number(r.toFixed(4)));

/** How a cost stands when it is added: a bill to pay later, paid now from one of our accounts, or paid by someone from their own money. */
type PaidHow = "later" | "now" | "own";
const PAID_LABEL: Record<PaidHow, string> = { later: "Not yet", now: "Paid now", own: "By someone, from their own money" };

const chip = (on: boolean) =>
  cn("h-8 rounded-full border px-3 text-sm transition-colors", on ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line bg-surface hover:border-line-strong");

/**
 * A cost of one order (design "money, simple", board OCostWin): what for as chips, who we owe, the amount in
 * any currency with the rate that turns it into the order's, their bill number and date, and how it stands:
 * not paid yet (it waits under "to pay"), paid now from an account, or paid by someone from their own money
 * (we repay them). On a phone the photo of the bill comes first.
 */
export function OrderExpenseForm({
  setup,
  step,
  prefill,
  expense,
  onClose,
  onSaved,
}: {
  setup: ExpenseSetup;
  /** The step of the page it was opened on. */
  step: FlowStep | null;
  prefill?: ExpensePrefill;
  expense?: CostExpense;
  onClose: () => void;
  /** Saved: `again` keeps the form open, empty, for the next one. */
  onSaved: (again: boolean, notice: string | null) => void;
}) {
  const s0 = setup;
  const accounts = useAccounts();
  const router = useRouter();
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? prefill?.category ?? (step === "payment" ? "bank_charges" : "freight"));
  const [currency, setCurrencyRaw] = useState(expense?.currency ?? prefill?.currency ?? s0.mainCurrency);
  const [amount, setAmount] = useState(expense?.amount ?? prefill?.amount ?? "");
  const settingsRate = (c: string) => (c === s0.mainCurrency ? 1 : rateOf(s0.fx, c, s0.mainCurrency));
  const [rate, setRate] = useState(expense ? rateText(expense.rate) : "");
  const [paid, setPaid] = useState<PaidHow>(expense ? (expense.ownMoney ? "own" : expense.payLater ? "later" : "now") : "later");
  const [paidBy, setPaidBy] = useState(expense?.paidBy?.id ?? s0.me ?? "");
  const [from, setFrom] = useState(expense?.account?.id ?? "");
  const [bearer, setBearer] = useState<ExpenseBearer>(expense?.borneBy ?? "us");
  const [factoryId, setFactoryId] = useState(expense?.factory?.id ?? (s0.factories.length === 1 ? s0.factories[0]!.id : ""));
  const [file, setFileRaw] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const again = useRef(false);
  const setFile = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setFileRaw(f);
  };

  const setCurrency = (c: string) => {
    setCurrencyRaw(c);
    setRate("");
    setFrom("");
  };

  // What it counts as on this order: into the main currency at the rate, then into the order's at today's rate.
  const used = currency === s0.mainCurrency ? 1 : num(rate) > 0 ? num(rate) : settingsRate(currency);
  const inMain = amount.trim() && Number.isFinite(num(amount)) && used ? num(amount) / used : null;
  const orderPerMain = s0.orderCurrency === s0.mainCurrency ? 1 : rateOf(s0.fx, s0.orderCurrency, s0.mainCurrency);
  const inOrder = inMain !== null && orderPerMain ? inMain * orderPerMain : null;

  const fits = accounts.filter((a) => a.currency === currency && (!a.archived || a.id === from));
  const chips = ORDER_EXPENSE_CHIPS.includes(category) ? ORDER_EXPENSE_CHIPS : [...ORDER_EXPENSE_CHIPS.slice(0, -1), category, "other" as const];
  const action = expenseAction.bind(null, s0.orderId, expense?.id ?? null);
  // Paid after it was added (a bill paid, or a person paid back): that stands; it is not chosen again here.
  const settled = expense?.repaid ?? null;
  // Only while the receipt is sent: otherwise the button keeps its own "saving" state.
  const busy = sending ? { disabled: true } : {};

  const done = async (st: ActionState) => {
    const id = (st.data as { id?: string } | undefined)?.id ?? expense?.id;
    let notice: string | null = null;
    if (file && id) {
      setSending(true);
      const error = await uploadReceipt(id, file);
      setSending(false);
      router.refresh();
      if (error) notice = `The cost is saved, but the file was not: ${error} Open it to add the file again.`;
    }
    onSaved(again.current, notice);
  };

  const receipt = (
    <div className="order-first flex flex-col gap-1.5 sm:order-[90] sm:flex-row sm:items-center sm:gap-3">
      <label
        htmlFor="oe-receipt"
        className={cn(
          "flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 text-sm font-medium text-primary hover:bg-primary-soft",
          file ? "px-3 py-2" : "h-32 sm:h-auto sm:rounded-full sm:px-3.5 sm:py-1.5",
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="The bill" className="h-24 rounded-md object-contain sm:h-10" />
        ) : (
          <Camera className="size-4" aria-hidden />
        )}
        <span className="truncate">
          {file ? file.name : expense?.receipt ? "Replace the bill" : <><span className="sm:hidden">Take a photo of the bill</span><span className="hidden sm:inline">+ Their bill or receipt</span></>}
        </span>
      </label>
      <input
        id="oe-receipt"
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="sr-only"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <Button type="button" size="xs" variant="ghost" onClick={() => setFile(null)} className="w-fit">
          <X aria-hidden /> Do not attach
        </Button>
      ) : (
        expense?.receipt && <span className="text-xs text-muted">Kept: {expense.receipt.name}</span>
      )}
    </div>
  );

  return (
    <ActionForm action={action} onDone={done} keepFields className="flex flex-col gap-4">
      {(st) => (
        <>
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="payLater" value={paid === "later" ? "on" : "off"} />
          <input type="hidden" name="ownMoney" value={paid === "own" ? "on" : "off"} />
          <input type="hidden" name="accountId" value={paid === "now" ? from : ""} />
          {paid !== "own" && <input type="hidden" name="paidById" value={expense?.paidBy?.id ?? ""} />}
          <input type="hidden" name="note" value={expense?.note ?? ""} />
          {bearer !== "factory" && <input type="hidden" name="factoryId" value={expense?.factory?.id ?? ""} />}

          {receipt}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-medium text-text-2">What for</legend>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={chip(category === c)}>
                  {expenseShort(c)}
                </button>
              ))}
            </div>
            {st.errors?.category && <p className="text-xs text-bad">{st.errors.category}</p>}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Description" htmlFor="oe-description" error={st.errors?.description}>
              <Input
                id="oe-description"
                name="description"
                maxLength={200}
                defaultValue={st.values?.description ?? expense?.description ?? prefill?.description ?? ""}
                placeholder={PLACEHOLDER[category] ?? "Say what it is for"}
              />
            </Field>
            <Field label="Who we owe" htmlFor="oe-payee" optional error={st.errors?.payee}>
              <Input id="oe-payee" name="payee" maxLength={120} defaultValue={st.values?.payee ?? expense?.payee ?? ""} placeholder="e.g. the forwarder, the trucking company" />
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
              <Field label="Amount" htmlFor="oe-amount" error={st.errors?.amount}>
                <MoneyInput id="oe-amount" name="amount" currency={currency} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
              </Field>
              <Field label="Currency" htmlFor="oe-currency" error={st.errors?.currency}>
                <CurrencySelect id="oe-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </Field>
              <Field
                label="Rate"
                htmlFor="oe-rate"
                error={st.errors?.rate}
                className="max-sm:hidden"
                hint={
                  currency === s0.mainCurrency
                    ? undefined
                    : settingsRate(currency)
                      ? `today's · 1 ${s0.mainCurrency} = ${rateText(settingsRate(currency)!)} ${currency}`
                      : `No rate for ${currency} in Settings: enter it`
                }
              >
                <Input
                  id="oe-rate"
                  name="rate"
                  inputMode="decimal"
                  className="tabular"
                  value={currency === s0.mainCurrency ? "" : rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder={currency !== s0.mainCurrency && settingsRate(currency) ? rateText(settingsRate(currency)!) : ""}
                  disabled={currency === s0.mainCurrency}
                />
              </Field>
            </div>
            {inOrder !== null && currency !== s0.orderCurrency && (
              <p className="text-xs text-text-2">
                = <span className="font-semibold tabular">{money(inOrder, s0.orderCurrency)}</span> on this order
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their bill no." htmlFor="oe-reference" optional error={st.errors?.reference}>
              <Input id="oe-reference" name="reference" maxLength={120} defaultValue={st.values?.reference ?? expense?.reference ?? ""} />
            </Field>
            <Field label="Date" htmlFor="oe-spentOn" error={st.errors?.spentOn}>
              <Input id="oe-spentOn" name="spentOn" type="date" max={s0.today} defaultValue={st.values?.spentOn ?? expense?.spentOn ?? s0.today} />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-medium text-text-2">Paid</legend>
            {settled ? (
              <p className="text-sm">
                {paid === "own" ? "Paid back" : "Paid"} {date(settled.on)}
                {settled.account ? ` from ${settled.account.name}` : ""}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(PAID_LABEL) as PaidHow[]).map((k) => (
                  <button key={k} type="button" aria-pressed={paid === k} onClick={() => setPaid(k)} className={chip(paid === k)}>
                    {PAID_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
            {!settled && paid === "now" && (
              <Field label="From" htmlFor="oe-from" optional error={st.errors?.accountId} className="mt-1 sm:max-w-[50%]">
                <Select id="oe-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">Not said</option>
                  {fits.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {paid === "own" && (
              <Field label="Who paid" htmlFor="oe-paidBy" error={st.errors?.paidById} className="mt-1 sm:max-w-[50%]">
                <Select id="oe-paidBy" name="paidById" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                  <option value="">Choose the person…</option>
                  {s0.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who bears it" htmlFor="oe-bearer" error={st.errors?.borneBy}>
              <Select id="oe-bearer" name="borneBy" value={bearer} onChange={(e) => setBearer(e.target.value as ExpenseBearer)}>
                {EXPENSE_BEARERS.filter((b) => b !== "factory" || s0.factories.length > 0 || bearer === "factory").map((b) => (
                  <option key={b} value={b}>
                    {EXPENSE_BEARER_LABEL[b]} · {EXPENSE_BEARER_HINT[b]}
                  </option>
                ))}
              </Select>
            </Field>
            {bearer === "factory" && (
              <Field label="Which factory" htmlFor="oe-factory" error={st.errors?.factoryId}>
                <Select id="oe-factory" name="factoryId" value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
                  <option value="">Choose the factory…</option>
                  {s0.factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3 sm:static sm:order-[100] sm:mx-0 sm:border-0 sm:p-0">
            <SubmitButton className="max-sm:flex-1" pendingText="Saving…" {...busy} onClick={() => (again.current = false)}>
              {sending ? "Sending the file…" : expense ? "Save the change" : "Add the cost"}
            </SubmitButton>
            {!expense && (
              <SubmitButton variant="secondary" className="max-sm:hidden" pendingText="Saving…" {...busy} onClick={() => (again.current = true)}>
                Add and add another
              </SubmitButton>
            )}
            <Button type="button" variant="ghost" onClick={onClose} disabled={sending} className="max-sm:hidden">
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** The dialog the form opens in: a panel on a wide screen, the whole screen on a phone. */
function ExpenseDialog({ title, sub, open, onClose, children }: { title: string; sub: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="oe-title"
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-surface p-0 text-text backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[92dvh] sm:max-w-[34rem] sm:rounded-2xl sm:border sm:border-line sm:shadow-pop"
    >
      {open && (
        <div className="flex min-h-full flex-col gap-4 px-4 pt-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="oe-title" className="text-lg font-semibold">
              {title}
            </h2>
            <span className="flex items-center gap-1">
              <span className="pt-1 text-xs text-muted tabular">{sub}</span>
              <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
                <X aria-hidden />
              </Button>
            </span>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** "Add expense": opens the order's expense form, filled in from the stage it was opened on. */
export function AddOrderExpense({
  setup,
  step,
  prefill,
  label = "Add a cost",
  variant = "primary",
  size = "sm",
}: {
  setup: ExpenseSetup;
  step: FlowStep | null;
  prefill?: ExpensePrefill;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const stepLabel = setup.steps.find((s) => s.key === step)?.label;
  if (!setup.canEdit) return null;
  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {label}
      </Button>
      {notice && (
        <Alert tone="warning" className="basis-full">
          {notice}
        </Alert>
      )}
      <ExpenseDialog title="Add a cost" sub={`${setup.refNo}${stepLabel ? ` · ${stepLabel}` : ""}`} open={open} onClose={() => setOpen(false)}>
        <OrderExpenseForm
          key={round}
          setup={setup}
          step={step}
          prefill={prefill}
          onClose={() => setOpen(false)}
          onSaved={(again, n) => {
            setNotice(n);
            setRound((r) => r + 1);
            if (!again) setOpen(false);
          }}
        />
      </ExpenseDialog>
    </>
  );
}

/** "Change" on one expense of the order: the same form (a change asks why), its receipt, and Remove. */
export function EditOrderExpense({ setup, expense }: { setup: ExpenseSetup; expense: CostExpense }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!setup.canEdit || expense.voided) return null;
  return (
    <>
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)} aria-label={`Change ${expense.description}`}>
        <Pencil aria-hidden />
      </Button>
      <ExpenseDialog title="Change the cost" sub={`${setup.refNo} · ${date(expense.spentOn)}`} open={open} onClose={() => setOpen(false)}>
        {notice && <Alert tone="warning">{notice}</Alert>}
        {expense.receipt && (
          <a href={`/files/${expense.receipt.id}?view=1`} target="_blank" rel="noreferrer" className="w-fit text-sm text-primary hover:underline">
            Open the bill ({expense.receipt.name})
          </a>
        )}
        <OrderExpenseForm
          setup={setup}
          step={expense.step}
          expense={expense}
          onClose={() => setOpen(false)}
          onSaved={(_, n) => {
            setNotice(n);
            if (!n) setOpen(false);
          }}
        />
        <div className="border-t border-line pt-3 pb-4">
          <VoidForm action={voidExpenseAction.bind(null, setup.orderId, expense.id)} label="the cost" button="Remove this cost" />
        </div>
      </ExpenseDialog>
    </>
  );
}
