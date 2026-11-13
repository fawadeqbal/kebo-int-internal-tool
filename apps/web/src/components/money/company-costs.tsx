"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExpenseCategory } from "@kebo/shared";
import { Alert, Button, cn, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { MoneyInput } from "@/components/common/money-input";
import { useAccounts } from "@/components/money/accounts";
import { FilePicker } from "@/components/money/attachment";
import { uploadReceipt } from "@/components/money/forms";
import { FormWindow } from "@/components/order-sections/form-window";
import { expenseAction, repeatingAction } from "@/app/(app)/money/actions";
import type { ActionState } from "@/lib/actions";
import { date, money } from "@/lib/format";
import type { RepeatingCosts } from "@/lib/types-money";
import { COMPANY_KINDS, companyKind } from "./company-kinds";

const chip = (on: boolean) =>
  cn("h-8 rounded-full border px-3 text-sm transition-colors", on ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line bg-surface hover:border-line-strong");

type Waiting = RepeatingCosts["waiting"][number];

/**
 * The fields of a company cost: what kind, what, how much, the day it was paid and the account. New: whether
 * it comes every month. Confirming a proposed month: last month's values filled in, and the chain it belongs to.
 */
function CostFields({ mainCurrency, today, confirm, onClose }: { mainCurrency: string; today: string; confirm?: Waiting; onClose: () => void }) {
  const accounts = useAccounts();
  const router = useRouter();
  const [category, setCategory] = useState<ExpenseCategory>(confirm?.category ?? "rent");
  const [currency, setCurrency] = useState(confirm?.currency ?? mainCurrency);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fits = accounts.filter((a) => a.currency === currency && !a.archived);
  // A proposed month is paid on its day once that day has come; before it, today.
  const paidOn = confirm ? (confirm.on <= today ? confirm.on : today) : today;
  const done = async (st: ActionState) => {
    const id = (st.data as { id?: string } | undefined)?.id;
    if (file && id) {
      const error = await uploadReceipt(id, file);
      router.refresh();
      if (error) return setNotice(`The cost is saved, but the file was not: ${error} Open the cost to add it again.`);
    }
    onClose();
  };
  return (
    <ActionForm action={expenseAction.bind(null, null, null)} onDone={done} showSuccess={false} keepFields className="flex flex-col gap-4">
      {(s) => (
        <>
          {notice && <Alert tone="warning">{notice}</Alert>}
          <input type="hidden" name="category" value={category} />
          {confirm ? (
            <>
              <input type="hidden" name="description" value={confirm.description} />
              <input type="hidden" name="repeats" value="on" />
              <input type="hidden" name="repeatKey" value={confirm.key} />
            </>
          ) : (
            <>
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-text-2">Kind</legend>
                <div className="flex flex-wrap gap-1.5">
                  {COMPANY_KINDS.map((c) => (
                    <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={chip(category === c)}>
                      {companyKind(c)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <Field label="What" htmlFor="cc-description" error={s.errors?.description}>
                <Input id="cc-description" name="description" maxLength={200} defaultValue={s.values?.description ?? ""} placeholder={category === "rent" ? "e.g. Office rent" : category === "salaries" ? "e.g. Salaries" : "Say what it is for"} />
              </Field>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="cc-amount" error={s.errors?.amount}>
              <MoneyInput id="cc-amount" name="amount" currency={currency} defaultValue={s.values?.amount ?? confirm?.amount ?? ""} placeholder="0.00" />
            </Field>
            <Field label="Currency" htmlFor="cc-currency" error={s.errors?.currency ?? s.errors?.rate}>
              <CurrencySelect id="cc-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
            <Field label="Paid on" htmlFor="cc-spentOn" error={s.errors?.spentOn}>
              <Input id="cc-spentOn" name="spentOn" type="date" max={today} defaultValue={s.values?.spentOn ?? paidOn} />
            </Field>
            <Field label="Paid from" htmlFor="cc-account" optional error={s.errors?.accountId}>
              <Select id="cc-account" name="accountId" defaultValue={s.values?.accountId ?? (confirm?.account && fits.some((a) => a.id === confirm.account!.id) ? confirm.account.id : "")} key={currency}>
                <option value="">Not said</option>
                {fits.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!confirm && (
            <Field label="Repeats" htmlFor="cc-repeats">
              <Select id="cc-repeats" name="repeats" defaultValue={s.values?.repeats ?? "off"}>
                <option value="off">Does not repeat</option>
                <option value="on">Every month, on this day</option>
              </Select>
            </Field>
          )}
          <FilePicker id="cc-file" label={confirm ? "Bank slip" : "Receipt"} hint="Photo or PDF" file={file} onChange={setFile} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…">{confirm ? "Confirm" : "Add the cost"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** "Add a company cost": the page's one orange button. */
export function AddCompanyCost({ mainCurrency, today }: { mainCurrency: string; today: string }) {
  return (
    <FormWindow button={{ label: "Add a company cost", kind: "main" }} title="Add a company cost" sub="Not for one order" size="sm">
      {(close) => <CostFields mainCurrency={mainCurrency} today={today} onClose={close} />}
    </FormWindow>
  );
}

/** One cost that comes every month and is not in this month yet: Skip (this month only), or Confirm with what was paid. */
export function RepeatingRow({ w, mainCurrency, today }: { w: Waiting; mainCurrency: string; today: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[18px] py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{w.description}</span>
        <span className="block text-xs text-text-2">
          {companyKind(w.category)} · every month on day {w.day} · last time {money(w.last.amount, w.currency)} on {date(w.last.on)}
          {w.account ? ` from ${w.account.name}` : ""}
        </span>
        {error && <span className="block text-xs text-bad">{error}</span>}
      </span>
      <span className="flex items-center gap-2">
        <span className="mr-2 text-sm font-semibold tabular">{money(w.amount, w.currency)}</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 px-2.5 text-[13px]"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await repeatingAction(w.key, "skip");
              if (r.ok) router.refresh();
              else setError(r.message ?? "It could not be skipped.");
            })
          }
        >
          Skip
        </Button>
        <FormWindow button={{ label: "Confirm", kind: "plain" }} title="Confirm" sub={`${w.description} · every month on day ${w.day}`} size="sm">
          {(close) => <CostFields mainCurrency={mainCurrency} today={today} confirm={w} onClose={close} />}
        </FormWindow>
      </span>
    </li>
  );
}

/** "Stop repeating" on a cost that comes every month: it is no longer proposed. Its past months stay. */
export function StopRepeating({ repeatKey }: { repeatKey: string }) {
  const [busy, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const r = await repeatingAction(repeatKey, "stop");
          if (r.ok) router.refresh();
        })
      }
    >
      Stop repeating
    </Button>
  );
}
