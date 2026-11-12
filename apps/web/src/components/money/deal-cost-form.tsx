"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@kebo/shared";
import { Alert, Button, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { FileRow, FileZone, fileSize } from "@/components/common/file-zone";
import { CurrencySelect } from "@/components/common/currency-select";
import { useAccounts } from "@/components/money/accounts";
import { uploadReceipt } from "@/components/money/forms";
import { expenseAction } from "@/app/(app)/money/actions";
import type { ActionState } from "@/lib/actions";
import { rateOf, type Fx } from "@/lib/fx";
import type { Person } from "@/lib/types";

const rateText = (r: number) => String(Number(r.toFixed(4)));

/**
 * "Add a cost" beside an inquiry's spending: kind, day, amount (any currency,
 * with its rate to the main one), who paid and from which account — or their
 * own money, repaid later — what it was, its reference and the receipt.
 */
export function DealCostForm({
  dealId,
  customerId,
  mainCurrency,
  fx,
  today,
  people,
  me,
}: {
  dealId: string;
  customerId: string;
  mainCurrency: string;
  fx: Fx;
  today: string;
  people: Person[];
  me: string | null;
}) {
  const router = useRouter();
  const accounts = useAccounts();
  const [round, setRound] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory>("travel");
  const [currency, setCurrencyRaw] = useState(mainCurrency);
  const [rate, setRate] = useState("");
  const [own, setOwn] = useState(false);
  const [account, setAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sending = useRef(false);
  const settingsRate = currency === mainCurrency ? 1 : rateOf(fx, currency, mainCurrency);
  const fits = accounts.filter((a) => a.currency === currency && !a.archived);
  const setCurrency = (c: string) => {
    setCurrencyRaw(c);
    setRate("");
    setAccount("");
  };

  const done = async (st: ActionState) => {
    const id = (st.data as { id?: string } | undefined)?.id;
    if (file && id && !sending.current) {
      sending.current = true;
      const error = await uploadReceipt(id, file);
      sending.current = false;
      if (error) setNotice(`The cost is saved, but the receipt was not: ${error} Add it again from the cost.`);
      router.refresh();
    }
    setFile(null);
    setOwn(false);
    setAccount("");
    setRound((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-3">
      {notice && <Alert tone="warning">{notice}</Alert>}
      <ActionForm key={round} action={expenseAction.bind(null, null, null)} onDone={done} keepFields className="flex flex-col gap-4">
        {(s) => (
          <>
            <input type="hidden" name="inquiryId" value={dealId} />
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="orderId" value="" />
            <input type="hidden" name="factoryId" value="" />
            <input type="hidden" name="descriptionDefault" value={EXPENSE_CATEGORY_LABEL[category]} />
            <input type="hidden" name="ownMoney" value={own ? "on" : "off"} />
            <input type="hidden" name="accountId" value={own ? "" : account} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Category" htmlFor="dc-category" required error={s.errors?.category}>
                <Select id="dc-category" name="category" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {EXPENSE_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Spent on" htmlFor="dc-spentOn" required error={s.errors?.spentOn}>
                <Input id="dc-spentOn" name="spentOn" type="date" max={today} defaultValue={s.values?.spentOn ?? today} />
              </Field>
              <Field label="Amount" htmlFor="dc-amount" required error={s.errors?.amount}>
                <Input id="dc-amount" name="amount" inputMode="decimal" className="text-right tabular" defaultValue={s.values?.amount ?? ""} />
              </Field>
              <Field label={`Rate to ${mainCurrency}`} htmlFor="dc-rate" error={s.errors?.rate ?? s.errors?.currency}>
                <div className="flex">
                  <CurrencySelect
                    id="dc-currency"
                    name="currency"
                    aria-label="Currency of the amount"
                    short
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-[4.6rem] flex-none rounded-r-none border-r-0 pr-6 pl-2"
                  />
                  <Input
                    id="dc-rate"
                    name="rate"
                    inputMode="decimal"
                    className="min-w-0 rounded-l-none tabular"
                    value={currency === mainCurrency ? "1" : rate}
                    placeholder={settingsRate ? rateText(settingsRate) : ""}
                    onChange={(e) => setRate(e.target.value)}
                    disabled={currency === mainCurrency}
                  />
                </div>
              </Field>
              <Field label="Paid by" htmlFor="dc-paidBy">
                <Select id="dc-paidBy" name="paidById" defaultValue={s.values?.paidById ?? me ?? ""}>
                  <option value="">Not said</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From account" htmlFor="dc-account" error={s.errors?.accountId} hint={fits.length === 0 && !own ? `No ${currency} account` : undefined}>
                <Select id="dc-account" value={own ? "" : account} onChange={(e) => setAccount(e.target.value)} disabled={own}>
                  <option value="">{own ? "Own money" : "Choose…"}</option>
                  {fits.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2.5 py-1.5 text-sm">
              <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} className="size-[18px] accent-primary" />
              Own money (repay later)
            </label>
            <Field label="What" htmlFor="dc-description" error={s.errors?.description}>
              <Input
                id="dc-description"
                name="description"
                maxLength={200}
                defaultValue={s.values?.description ?? ""}
                placeholder={EXPENSE_CATEGORY_LABEL[category]}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reference" htmlFor="dc-reference">
                <Input id="dc-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
              </Field>
            </div>
            <FileZone label="Receipt or ticket" one compact hint="Photo or PDF · up to 25 MB" onFiles={(f) => setFile(f[0] ?? null)}>
              {file && (
                <FileRow
                  name={file.name}
                  meta={fileSize(file.size)}
                  actions={
                    <Button size="icon-xs" variant="ghost" onClick={() => setFile(null)} aria-label={`Remove ${file.name}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  }
                />
              )}
            </FileZone>
            <div>
              <SubmitButton pendingText={file ? "Saving, sending the receipt…" : "Saving…"}>
                <Check aria-hidden /> Add cost
              </SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    </div>
  );
}
