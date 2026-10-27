"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Pencil, Plus } from "lucide-react";
import { CURRENCIES, MONEY_ACCOUNT_KIND_LABEL, MONEY_ACCOUNT_KINDS, type MoneyAccountKind } from "@kebo/shared";
import { Button, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { MoneyInput } from "@/components/common/money-input";
import type { ActionState } from "@/lib/actions";
import { money } from "@/lib/format";
import { saveAccountAction, setEntryAccountAction, transferAction } from "@/app/(app)/money/actions";
import type { AccountOption } from "./accounts";

const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";

export interface AccountRow extends AccountOption {
  openingBalance: string;
  openingOn: string;
  note: string | null;
  balance: string;
}

/** Add one of our accounts, or change one (name, opening balance, closed). */
export function AccountForm({ account, today, onClose }: { account?: AccountRow; today: string; onClose: () => void }) {
  const [currency, setCurrency] = useState(account?.currency ?? "PKR");
  return (
    <ActionForm action={saveAccountAction.bind(null, account?.id ?? null)} onDone={onClose} className={framed}>
      {(s) => (
        <>
          <p className="text-sm font-medium">{account ? `Change ${account.name}` : "New account"}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="ac-name" error={s.errors?.name} className="sm:col-span-2">
              <Input id="ac-name" name="name" maxLength={80} defaultValue={s.values?.name ?? account?.name ?? ""} placeholder="e.g. Meezan Bank USD, Office cash" />
            </Field>
            <Field label="Kind" htmlFor="ac-kind">
              <Select id="ac-kind" name="kind" defaultValue={(s.values?.kind as MoneyAccountKind) ?? account?.kind ?? "bank"}>
                {MONEY_ACCOUNT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {MONEY_ACCOUNT_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" htmlFor="ac-currency" hint="One currency per account">
              <Select id="ac-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Balance on the day" htmlFor="ac-opening" error={s.errors?.openingBalance} hint="What was in it on the day below">
              <MoneyInput id="ac-opening" name="openingBalance" currency={currency} defaultValue={s.values?.openingBalance ?? account?.openingBalance ?? ""} placeholder="0.00" />
            </Field>
            <Field label="On" htmlFor="ac-on" error={s.errors?.openingOn} hint="Money recorded from this day on is added">
              <Input id="ac-on" name="openingOn" type="date" max={today} defaultValue={s.values?.openingOn ?? account?.openingOn ?? today} />
            </Field>
            <Field label="Note" htmlFor="ac-note" optional className="sm:col-span-3">
              <Textarea id="ac-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note ?? account?.note ?? ""} placeholder="e.g. account number ending 4471" />
            </Field>
          </div>
          {account && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="archived" defaultChecked={account.archived} className="size-4 accent-primary" /> Closed: keep it in the history, but not for new money
            </label>
          )}
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              {account ? "Save" : "Add the account"}
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

export function NewAccount({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="w-full">
      <AccountForm today={today} onClose={() => setOpen(false)} />
    </div>
  ) : (
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
      <Plus aria-hidden /> Add an account
    </Button>
  );
}

export function EditAccount({ account, today }: { account: AccountRow; today: string }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="w-full">
      <AccountForm account={account} today={today} onClose={() => setOpen(false)} />
    </div>
  ) : (
    <Button size="xs" variant="ghost" onClick={() => setOpen(true)} aria-label={`Change ${account.name}`}>
      <Pencil aria-hidden />
    </Button>
  );
}

/** Move money between two of our accounts; asks what arrived when the currencies differ. */
export function MoveMoney({ accounts, today }: { accounts: AccountRow[]; today: string }) {
  const open_ = accounts.filter((a) => !a.archived);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(open_[0]?.id ?? "");
  const [to, setTo] = useState(open_[1]?.id ?? "");
  if (open_.length < 2) return null;
  if (!open)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ArrowLeftRight aria-hidden /> Move money
      </Button>
    );
  const a = open_.find((x) => x.id === from);
  const b = open_.find((x) => x.id === to);
  const differ = a && b && a.currency !== b.currency;
  return (
    <div className="w-full">
      <ActionForm action={transferAction} onDone={() => setOpen(false)} className={framed} keepFields>
        {(s: ActionState) => (
          <>
            <p className="text-sm font-medium">Move money between our accounts</p>
            <p className="text-xs text-muted">Cash paid into the bank, dollars changed into rupees… It is not money earned or spent.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="tr-from" error={s.errors?.fromAccountId}>
                <Select id="tr-from" name="fromAccountId" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {open_.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {money(x.balance, x.currency)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To" htmlFor="tr-to" error={s.errors?.toAccountId}>
                <Select id="tr-to" name="toAccountId" value={to} onChange={(e) => setTo(e.target.value)}>
                  {open_.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.currency}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Amount sent (${a?.currency ?? ""})`} htmlFor="tr-out" error={s.errors?.amountOut}>
                <MoneyInput id="tr-out" name="amountOut" currency={a?.currency ?? ""} defaultValue={s.values?.amountOut ?? ""} placeholder="0.00" />
              </Field>
              {differ ? (
                <Field label={`Amount that arrived (${b?.currency})`} htmlFor="tr-in" error={s.errors?.amountIn} hint="After the exchange and any fees">
                  <MoneyInput id="tr-in" name="amountIn" currency={b?.currency ?? ""} defaultValue={s.values?.amountIn ?? ""} placeholder="0.00" />
                </Field>
              ) : (
                <Field label="Amount that arrived" htmlFor="tr-in" optional hint="Empty: the same amount">
                  <MoneyInput id="tr-in" name="amountIn" currency={b?.currency ?? ""} defaultValue={s.values?.amountIn ?? ""} placeholder="0.00" />
                </Field>
              )}
              <Field label="On" htmlFor="tr-on" error={s.errors?.transferredOn}>
                <Input id="tr-on" name="transferredOn" type="date" max={today} defaultValue={s.values?.transferredOn ?? today} />
              </Field>
              <Field label="Reference" htmlFor="tr-ref" optional>
                <Input id="tr-ref" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
              </Field>
              <Field label="Note" htmlFor="tr-note" optional className="sm:col-span-2">
                <Input id="tr-note" name="note" maxLength={500} defaultValue={s.values?.note ?? ""} placeholder="e.g. Changed at 281.40" />
              </Field>
            </div>
            <div className="flex gap-2">
              <SubmitButton size="sm" pendingText="Moving…">
                Move the money
              </SubmitButton>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </ActionForm>
    </div>
  );
}

/** For an amount with no account: choose one, saved at once. */
export function PutOnAccount({ kind, id, currency, accounts }: { kind: "in" | "factory" | "expense"; id: string; currency: string; accounts: AccountOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fits = accounts.filter((a) => a.currency === currency && !a.archived);
  if (fits.length === 0) return <span className="text-xs text-muted">No {currency} account</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <Select
        aria-label="Put it on an account"
        className="h-8 text-xs"
        defaultValue=""
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          start(async () => {
            const r = await setEntryAccountAction(kind, id, v);
            if (!r.ok) setError(r.message ?? "Could not save it.");
            router.refresh();
          });
        }}
      >
        <option value="">Put on an account…</option>
        {fits.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}
