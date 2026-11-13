"use client";

import { useState } from "react";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@kebo/shared";
import { Alert, Button, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { MoneyInput } from "@/components/common/money-input";
import { FormWindow } from "@/components/order-sections/form-window";
import { submitCostAction } from "@/app/(app)/money/actions";
import { AccountSelect, RecordedBy } from "./accounts";
import { FilePicker, useSaveThenSend } from "./attachment";

const chip = (on: boolean) =>
  `inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium ${on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-text-2 hover:bg-surface-2"}`;

/**
 * "Add a cost" for someone who does not record costs themselves (Staff): what was paid, for which order (or
 * the company), and how: from their own money, or from one of our accounts. It is sent to a manager to
 * verify, with its receipt, and counts only then.
 */
export function SendCostWindow({ meId, orders, mainCurrency, today }: { meId: string; orders: { id: string; refNo: string; customer: string }[]; mainCurrency: string; today: string }) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <>
      <FormWindow button={{ label: "Add a cost", kind: "plain" }} title="Add a cost" sub="A manager verifies it before it counts" size="md">
        {(close) => <Fields meId={meId} orders={orders} mainCurrency={mainCurrency} today={today} onClose={close} onFileError={setFileError} />}
      </FormWindow>
      {fileError && <Alert tone="error">{fileError}</Alert>}
    </>
  );
}

function Fields({ meId, orders, mainCurrency, today, onClose, onFileError }: { meId: string; orders: { id: string; refNo: string; customer: string }[]; mainCurrency: string; today: string; onClose: () => void; onFileError: (m: string) => void }) {
  const [currency, setCurrency] = useState(mainCurrency);
  const [own, setOwn] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const save = useSaveThenSend(submitCostAction, file, (id) => `/files/submissions/${id}`, "The cost is sent to verify", onFileError);
  return (
    <ActionForm action={save} onDone={onClose} keepFields className="flex flex-col gap-3">
      {(s) => (
        <>
          <input type="hidden" name="ownMoney" value={own ? "on" : "off"} />
          <input type="hidden" name="paidById" value={own ? meId : ""} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="For" htmlFor="sc-order" error={s.errors?.orderId}>
              <Select id="sc-order" name="orderId" defaultValue={s.values?.orderId ?? ""}>
                <option value="">The company (no order)</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.refNo} · {o.customer}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kind" htmlFor="sc-category" error={s.errors?.category}>
              <Select id="sc-category" name="category" defaultValue={s.values?.category ?? "travel"}>
                {EXPENSE_CATEGORIES.map((c: ExpenseCategory) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="What was it" htmlFor="sc-description" error={s.errors?.description}>
            <Input id="sc-description" name="description" maxLength={200} defaultValue={s.values?.description ?? ""} placeholder="Taxi to the factory" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount" htmlFor="sc-amount" error={s.errors?.amount}>
              <MoneyInput id="sc-amount" name="amount" currency={currency} defaultValue={s.values?.amount ?? ""} placeholder="0.00" />
            </Field>
            <Field label="Currency" htmlFor="sc-currency" error={s.errors?.currency ?? s.errors?.rate}>
              <CurrencySelect id="sc-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
            <Field label="Paid on" htmlFor="sc-spentOn" error={s.errors?.spentOn}>
              <Input id="sc-spentOn" name="spentOn" type="date" max={today} defaultValue={s.values?.spentOn ?? today} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-medium text-text-2">Paid from</legend>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={own} onClick={() => setOwn(true)} className={chip(own)}>
                My own money
              </button>
              <button type="button" aria-pressed={!own} onClick={() => setOwn(false)} className={chip(!own)}>
                One of our accounts
              </button>
            </div>
            {own ? (
              <p className="text-xs text-text-2">It is owed back to you once a manager verifies it.</p>
            ) : (
              <AccountSelect key={currency} id="sc-account" label="From account" currency={currency} defaultValue={s.values?.accountId} error={s.errors?.accountId} className="sm:max-w-[60%]" />
            )}
            {s.errors?.paidById && <p className="text-xs text-bad">{s.errors.paidById[0]}</p>}
          </fieldset>
          <FilePicker id="sc-file" label="Receipt" hint="Photo or PDF" file={file} onChange={setFile} />
          <RecordedBy verify />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingText={file ? "Sending, with the file…" : "Sending…"}>Send to verify</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
