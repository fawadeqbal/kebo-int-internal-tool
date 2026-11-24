"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Pencil, Plus } from "lucide-react";
import { CURRENCIES, MONEY_ACCOUNT_KIND_LABEL, MONEY_ACCOUNT_KINDS, type MoneyAccountKind } from "@kebo/shared";
import { Button, Field, Input, RULES, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody, SidePanel, WindowFooter } from "@/components/common/panel";
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
    <ActionForm action={saveAccountAction.bind(null, account?.id ?? null)} onDone={onClose} className={PANEL_FORM}>
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="ac-name" error={s.errors?.name} className="sm:col-span-2">
              <Input id="ac-name" name="name" maxLength={80} defaultValue={s.values?.name ?? account?.name ?? ""} />
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
            <Field label="Currency" htmlFor="ac-currency">
              <Select id="ac-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Balance on the day" htmlFor="ac-opening" error={s.errors?.openingBalance}>
              <MoneyInput
                id="ac-opening"
                name="openingBalance"
                currency={currency}
                defaultValue={s.values?.openingBalance ?? account?.openingBalance ?? ""}
                placeholder="0.00"
              />
            </Field>
            <Field label="On" htmlFor="ac-on" error={s.errors?.openingOn}>
              <Input
                id="ac-on"
                name="openingOn"
                type="date"
                max={today}
                defaultValue={s.values?.openingOn ?? account?.openingOn ?? today}
              />
            </Field>
            {s.code === "rate_needed" && (
              // Settings has no rate for this currency yet: asked here, kept in Settings for every total.
              <Field
                label={`Exchange rate: ${currency} per 1 of the main currency`}
                htmlFor="ac-rate"
                error={s.errors?.rate}
                className="sm:col-span-3"
              >
                <Input
                  id="ac-rate"
                  name="rate"
                  inputMode="decimal"
                  required
                  autoFocus
                  defaultValue={s.values?.rate ?? ""}
                  className="max-w-56"
                />
              </Field>
            )}
            <Field label="Note" htmlFor="ac-note" optional className="sm:col-span-3">
              <Textarea id="ac-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note ?? account?.note ?? ""} />
            </Field>
          </div>
          {account && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="archived" defaultChecked={account.archived} className="size-4 accent-primary" /> Closed: keep it
              in the history, but not for new money
            </label>
          )}
          <WindowFooter onCancel={onClose}>
            <SubmitButton pendingText="Saving…">{account ? "Save" : "Add the account"}</SubmitButton>
          </WindowFooter>
        </>
      )}
    </ActionForm>
  );
}

/** "+ Add account": the page's strong button when it is the list's own create (`main`), a plain one in a box. */
export function NewAccount({ today, main }: { today: string; main?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={main ? "md" : "sm"} variant={main ? "strong" : "secondary"} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add account
      </Button>
      {open && (
        <MoneyWindow
          title="New account"
          description="The office cash box, a bank account or a wallet, with what is in it today."
          onClose={() => setOpen(false)}
        >
          <AccountForm today={today} onClose={() => setOpen(false)} />
        </MoneyWindow>
      )}
    </>
  );
}

export function EditAccount({ account, today }: { account: AccountRow; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)} aria-label={`Change ${account.name}`}>
        <Pencil aria-hidden />
      </Button>
      {open && (
        <MoneyWindow title={`Change ${account.name}`} onClose={() => setOpen(false)}>
          <AccountForm account={account} today={today} onClose={() => setOpen(false)} />
        </MoneyWindow>
      )}
    </>
  );
}

/**
 * Adding or changing an account and moving money open as windows (Esc closes them), one way for all three (review
 * 24 Nov, M-24: Move money opened in the page, which Esc did not close).
 */
function MoneyWindow({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <SidePanel title={title} description={description} onClose={onClose} className={RULES.window.part}>
      <PanelBody>{children}</PanelBody>
    </SidePanel>
  );
}

/** Move money between two of our accounts; asks what arrived when the currencies differ. */
export function MoveMoney({
  accounts,
  today,
  startOpen = false,
  header,
}: {
  accounts: AccountRow[];
  today: string;
  startOpen?: boolean;
  /** In a page's header: the header's button size. */ header?: boolean;
}) {
  const open_ = accounts.filter((a) => !a.archived);
  const [open, setOpen] = useState(startOpen);
  const [from, setFrom] = useState(open_[0]?.id ?? "");
  const [to, setTo] = useState(open_[1]?.id ?? "");
  if (open_.length < 2) return null;
  const a = open_.find((x) => x.id === from);
  const b = open_.find((x) => x.id === to);
  const differ = a && b && a.currency !== b.currency;
  const button = (
    <Button size={header ? "md" : "sm"} variant="secondary" onClick={() => setOpen(true)}>
      <ArrowLeftRight aria-hidden /> Move money
    </Button>
  );
  if (!open && !startOpen) return button;
  const close = () => setOpen(false);
  const form = (
    <ActionForm action={transferAction} onDone={close} className={startOpen ? framed : PANEL_FORM} keepFields>
      {(s: ActionState) => (
        <>
          {startOpen && <p className="text-sm font-medium">Move money between our bank accounts</p>}
          {startOpen && (
            <p className="text-xs text-muted">Cash paid into the bank, dollars changed into rupees… It is not money earned or spent.</p>
          )}
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
              <MoneyInput
                id="tr-out"
                name="amountOut"
                currency={a?.currency ?? ""}
                defaultValue={s.values?.amountOut ?? ""}
                placeholder="0.00"
              />
            </Field>
            {differ ? (
              <Field label={`Amount that arrived (${b?.currency})`} htmlFor="tr-in" error={s.errors?.amountIn}>
                <MoneyInput
                  id="tr-in"
                  name="amountIn"
                  currency={b?.currency ?? ""}
                  defaultValue={s.values?.amountIn ?? ""}
                  placeholder="0.00"
                />
              </Field>
            ) : (
              <Field label="Amount that arrived" htmlFor="tr-in" optional>
                <MoneyInput
                  id="tr-in"
                  name="amountIn"
                  currency={b?.currency ?? ""}
                  defaultValue={s.values?.amountIn ?? ""}
                  placeholder="0.00"
                />
              </Field>
            )}
            <Field label="On" htmlFor="tr-on" error={s.errors?.transferredOn}>
              <Input id="tr-on" name="transferredOn" type="date" max={today} defaultValue={s.values?.transferredOn ?? today} />
            </Field>
            <Field label="Reference" htmlFor="tr-ref" optional>
              <Input id="tr-ref" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
            </Field>
            <Field label="Note" htmlFor="tr-note" optional className="sm:col-span-2">
              <Input id="tr-note" name="note" maxLength={500} defaultValue={s.values?.note ?? ""} />
            </Field>
          </div>
          {startOpen ? (
            <div className="flex justify-end gap-2">
              <SubmitButton size="sm" pendingText="Moving…">
                Move the money
              </SubmitButton>
            </div>
          ) : (
            <WindowFooter onCancel={close}>
              <SubmitButton pendingText="Moving…">Move the money</SubmitButton>
            </WindowFooter>
          )}
        </>
      )}
    </ActionForm>
  );
  // On the Record a payment page (startOpen) it is the page's own form; elsewhere a window over the page.
  if (startOpen) return <div className="w-full">{form}</div>;
  return (
    <>
      {button}
      <MoneyWindow
        title="Move money"
        description="Between our own accounts: cash paid into the bank, dollars changed into rupees. It is not money earned or spent."
        onClose={close}
      >
        {form}
      </MoneyWindow>
    </>
  );
}

/** For an amount with no account: choose one, saved at once. */
export function PutOnAccount({
  kind,
  id,
  currency,
  accounts,
}: {
  kind: "in" | "factory" | "expense";
  id: string;
  currency: string;
  accounts: AccountOption[];
}) {
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
