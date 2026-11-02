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
  STEP_OF_CATEGORY,
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
  /** The factories on the order (one of them can bear an expense). */
  factories: { id: string; name: string }[];
  /** The quote's planned costs, for "counts against the plan" / "not planned" before saving. */
  plan: { label: string; categories: ExpenseCategory[]; planned: string | null; difference: string }[];
  /** The profit now expected (order currency), or null when unknown. */
  expected: string | null;
  canEdit: boolean;
}

export interface ExpensePrefill {
  category?: ExpenseCategory;
  description?: string;
  step?: FlowStep | null;
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

/**
 * An expense on one order (OrderV3AddExpense): what for as chips, the amount
 * in any currency with the rate that turns it into the order's, the step, who
 * paid and from where (an account, or their own money: we repay them), who
 * bears it, the receipt. On a phone the receipt photo comes first.
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
  const [stepValue, setStepValue] = useState<string>(
    expense ? (expense.step ?? "") : (prefill?.step ?? step ?? STEP_OF_CATEGORY[prefill?.category ?? "freight"] ?? ""),
  );
  const [stepTouched, setStepTouched] = useState(Boolean(expense || step || prefill?.step));
  const [currency, setCurrencyRaw] = useState(expense?.currency ?? s0.mainCurrency);
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const settingsRate = (c: string) => (c === s0.mainCurrency ? 1 : rateOf(s0.fx, c, s0.mainCurrency));
  const [rate, setRate] = useState(expense ? rateText(expense.rate) : "");
  const [paidBy, setPaidBy] = useState(expense?.paidBy?.id ?? s0.me ?? "");
  const [from, setFrom] = useState(expense ? (expense.ownMoney ? "own" : (expense.account?.id ?? "")) : "");
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
    if (from && from !== "own") setFrom("");
  };
  const pick = (c: ExpenseCategory) => {
    setCategory(c);
    if (!stepTouched) setStepValue(STEP_OF_CATEGORY[c] ?? step ?? "");
  };

  // What it counts as on this order: into the main currency at the rate, then into the order's at today's rate.
  const used = currency === s0.mainCurrency ? 1 : num(rate) > 0 ? num(rate) : settingsRate(currency);
  const inMain = amount.trim() && Number.isFinite(num(amount)) && used ? num(amount) / used : null;
  const orderPerMain = s0.orderCurrency === s0.mainCurrency ? 1 : rateOf(s0.fx, s0.orderCurrency, s0.mainCurrency);
  const inOrder = inMain !== null && orderPerMain ? inMain * orderPerMain : null;

  // Before saving: does it fit what the quote planned, or does it cut the expected profit?
  let warning: ReactNode = null;
  if (!expense && bearer === "us" && inOrder !== null && inOrder > 0) {
    const row = s0.plan.find((r) => r.planned !== null && r.categories.includes(category));
    const room = row ? Math.max(Number(row.difference), 0) : 0;
    const extra = Math.max(inOrder - room, 0);
    const c = s0.orderCurrency;
    if (extra > 0.004 && s0.expected !== null) {
      const to = Number(s0.expected) - extra;
      warning = (
        <Alert tone="warning">
          {row ? `Over the planned ${row.label.toLowerCase()}` : "Not planned on the quote"}: expected profit goes from{" "}
          <span className="tabular">{money(s0.expected, c)}</span> to <span className="tabular">{money(to, c)}</span>.
        </Alert>
      );
    } else if (row)
      warning = (
        <Alert tone="info">
          Counts against the planned {row.label.toLowerCase()} ({money(room, c)} left): the expected profit does not change.
        </Alert>
      );
  }

  const fits = accounts.filter((a) => a.currency === currency && (!a.archived || a.id === from));
  const payer = s0.people.find((p) => p.id === paidBy);
  const chips = ORDER_EXPENSE_CHIPS.includes(category) ? ORDER_EXPENSE_CHIPS : [...ORDER_EXPENSE_CHIPS.slice(0, -1), category, "other" as const];
  const stepOptions = s0.steps;
  const action = expenseAction.bind(null, s0.orderId, expense?.id ?? null);
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
      if (error) notice = `The expense is saved, but the receipt was not: ${error} Open it to add the receipt again.`;
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
          <img src={preview} alt="The receipt" className="h-24 rounded-md object-contain sm:h-10" />
        ) : (
          <Camera className="size-4" aria-hidden />
        )}
        <span className="truncate">
          {file ? file.name : expense?.receipt ? "Replace the receipt" : <><span className="sm:hidden">Take a photo of the receipt</span><span className="hidden sm:inline">+ Receipt photo or PDF</span></>}
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
        <span className="text-xs text-muted">
          {expense?.receipt ? `Kept: ${expense.receipt.name}` : "or add it later; it shows as missing until then"}
        </span>
      )}
    </div>
  );

  return (
    <ActionForm action={action} onDone={done} keepFields className="flex flex-col gap-4">
      {(st) => (
        <>
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="ownMoney" value={from === "own" ? "on" : "off"} />
          <input type="hidden" name="accountId" value={from === "own" ? "" : from} />
          <input type="hidden" name="reference" value={expense?.reference ?? ""} />
          <input type="hidden" name="note" value={expense?.note ?? ""} />
          {bearer !== "factory" && <input type="hidden" name="factoryId" value={expense?.factory?.id ?? ""} />}

          {receipt}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-medium text-text-2">What for</legend>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => pick(c)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-sm transition-colors",
                    category === c ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  {expenseShort(c)}
                </button>
              ))}
            </div>
            {st.errors?.category && <p className="text-xs text-bad">{st.errors.category}</p>}
          </fieldset>

          <Field label="Description" htmlFor="oe-description" error={st.errors?.description} className="sm:order-none">
            <Input
              id="oe-description"
              name="description"
              maxLength={200}
              defaultValue={st.values?.description ?? expense?.description ?? prefill?.description ?? ""}
              placeholder={PLACEHOLDER[category] ?? "Say what it was for"}
            />
          </Field>

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
                    ? "The main currency"
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
            {inOrder !== null && (
              <p className="text-xs text-text-2">
                <span className="sm:hidden">
                  = <span className="font-semibold tabular">{money(inOrder, s0.orderCurrency)}</span>
                  {currency !== s0.mainCurrency && used ? ` at ${rateText(used)}` : ""}
                </span>
                <span className="hidden sm:inline">
                  Counts as <span className="font-semibold tabular">{money(inOrder, s0.orderCurrency)}</span> on this order.
                </span>
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Spent on" htmlFor="oe-spentOn" error={st.errors?.spentOn}>
              <Input id="oe-spentOn" name="spentOn" type="date" max={s0.today} defaultValue={st.values?.spentOn ?? expense?.spentOn ?? s0.today} />
            </Field>
            <Field label="Step" htmlFor="oe-step" hint={step && stepValue === step ? "from the page you opened it on" : undefined} error={st.errors?.step}>
              <Select
                id="oe-step"
                name="step"
                value={stepValue}
                onChange={(e) => {
                  setStepValue(e.target.value);
                  setStepTouched(true);
                }}
              >
                <option value="">No step</option>
                {stepOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.number} · {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid by" htmlFor="oe-paidBy" optional={from !== "own"} error={st.errors?.paidById}>
              <Select id="oe-paidBy" name="paidById" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                <option value="">Not said</option>
                {s0.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From" htmlFor="oe-from" error={st.errors?.accountId} hint={from === "own" ? "Shows under To repay until it is repaid" : undefined}>
              <Select id="oe-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Not said</option>
                {fits.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="own">{payer ? `${payer.name}'s own money · we repay` : "Own money · we repay them"}</option>
              </Select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-text-2">Who bears it</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {EXPENSE_BEARERS.map((b) => (
                <label
                  key={b}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm",
                    bearer === b ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-line-strong",
                    b === "factory" && !s0.factories.length && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name="borneBy"
                    value={b}
                    checked={bearer === b}
                    disabled={b === "factory" && !s0.factories.length}
                    onChange={() => setBearer(b)}
                    className="mt-0.5 accent-[var(--color-primary)]"
                  />
                  <span>
                    <span className="block font-semibold">{EXPENSE_BEARER_LABEL[b]}</span>
                    <span className="block text-xs text-text-2">{EXPENSE_BEARER_HINT[b]}</span>
                  </span>
                </label>
              ))}
            </div>
            {bearer === "factory" && (
              <Field label="Which factory" htmlFor="oe-factory" className="mt-3" error={st.errors?.factoryId}>
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
          </fieldset>

          {warning && <div className="sm:order-[95]">{warning}</div>}

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3 sm:static sm:order-[100] sm:mx-0 sm:border-0 sm:p-0">
            <SubmitButton className="max-sm:flex-1" pendingText="Saving…" {...busy} onClick={() => (again.current = false)}>
              {sending ? "Sending the receipt…" : expense ? "Save the change" : "Save"}
            </SubmitButton>
            {!expense && (
              <SubmitButton variant="secondary" className="max-sm:hidden" pendingText="Saving…" {...busy} onClick={() => (again.current = true)}>
                Save and add another
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

/** "Add expense": opens the order's expense form, filled in from the step (or a checklist item). */
export function AddOrderExpense({
  setup,
  step,
  prefill,
  label = "Add expense",
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
      <ExpenseDialog title="Add an expense" sub={`${setup.refNo}${stepLabel ? ` · ${stepLabel}` : ""}`} open={open} onClose={() => setOpen(false)}>
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
      <ExpenseDialog title="Change the expense" sub={`${setup.refNo} · ${date(expense.spentOn)}`} open={open} onClose={() => setOpen(false)}>
        {notice && <Alert tone="warning">{notice}</Alert>}
        {expense.receipt && (
          <a href={`/files/expenses/${expense.id}?view=1`} target="_blank" rel="noreferrer" className="w-fit text-sm text-primary hover:underline">
            Open the receipt ({expense.receipt.name})
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
          <VoidForm action={voidExpenseAction.bind(null, setup.orderId, expense.id)} label="the expense" />
        </div>
      </ExpenseDialog>
    </>
  );
}
