"use client";

import { createContext, useContext, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MONEY_ACCOUNT_KIND_LABEL, MONEY_ACCOUNT_KINDS, type MoneyAccountKind } from "@kebo/shared";
import { Button, Field, Input, Select } from "@kebo/ui";
import { quickAccountAction } from "@/app/(app)/money/actions";

/** One of our accounts, as offered when money is recorded. */
export interface AccountOption {
  id: string;
  name: string;
  kind: MoneyAccountKind;
  currency: string;
  archived: boolean;
}

interface Desk {
  accounts: AccountOption[];
  /** The person signed in: every money window says who records it. */
  me: string;
  /** Whether this person may add an account (managers, with the cash book). */
  canAdd: boolean;
}
const DeskContext = createContext<Desk>({ accounts: [], me: "", canAdd: false });

/** Our accounts and the person signed in, for every money form on the page (loaded once by the app layout). */
export function AccountsProvider({ accounts, me = "", canAdd = false, children }: { accounts: AccountOption[]; me?: string; canAdd?: boolean; children: ReactNode }) {
  return <DeskContext.Provider value={{ accounts, me, canAdd }}>{children}</DeskContext.Provider>;
}

/** Our accounts (empty when none are set up). */
export const useAccounts = () => useContext(DeskContext).accounts;

/** The account last chosen for a currency on this computer: the next window starts with it. */
const KEY = (currency: string) => `kebo:last-account:${currency}`;
const remembered = (currency: string) => {
  try {
    return window.localStorage.getItem(KEY(currency));
  } catch {
    return null;
  }
};
/** Storage does not tell this page when it changes; it is read when the field is drawn. */
const noStore = () => () => {};
const remember = (currency: string, id: string) => {
  try {
    if (id) window.localStorage.setItem(KEY(currency), id);
  } catch {
    // Private windows may refuse storage: the field still works, it only starts empty next time.
  }
};

/**
 * Which of our accounts the money came into or went from. On every money window, always shown, never
 * required: "Not said" is allowed and can be put right later on Cash & bank. Only accounts in the same
 * currency are offered; the one used last time for that currency is chosen already. With no account in the
 * currency, a manager adds one here without leaving the window.
 */
export function AccountSelect({
  id,
  label,
  currency,
  defaultValue,
  error,
  className,
  name = "accountId",
}: {
  id: string;
  label: string;
  currency: string;
  defaultValue?: string | null;
  error?: string[];
  className?: string;
  name?: string;
}) {
  const { accounts, canAdd } = useContext(DeskContext);
  const fits = accounts.filter((a) => a.currency === currency && (!a.archived || a.id === defaultValue));
  const given = fits.some((a) => a.id === defaultValue) ? (defaultValue ?? "") : "";
  // The account used last for this currency on this computer (the browser's storage, read after the page is drawn).
  const last = useSyncExternalStore(
    noStore,
    () => remembered(currency),
    () => null,
  );
  // What the person chose in this window, with the currency it was chosen for: another currency starts again.
  const [chosen, setChosen] = useState<{ currency: string; id: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const start = given || (last && fits.some((a) => a.id === last && !a.archived) ? last : "");
  const value = chosen?.currency === currency ? chosen.id : start;
  const choose = (id: string) => {
    setChosen({ currency, id });
    remember(currency, id);
  };
  // An account just added is in the list only once the page has read it again: until then the choice waits.
  const shown = fits.some((a) => a.id === value) ? value : "";
  return (
    <Field
      label={label}
      htmlFor={id}
      optional
      error={error}
      className={className}
      hint={
        adding ? undefined : fits.length === 0 ? (
          <>
            No {currency} account yet.{" "}
            {canAdd ? (
              <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => setAdding(true)}>
                Add one
              </button>
            ) : (
              "A manager adds accounts on Cash & bank."
            )}
          </>
        ) : canAdd ? (
          <button type="button" className="text-text-2 underline underline-offset-2 hover:text-text" onClick={() => setAdding(true)}>
            Add another account
          </button>
        ) : undefined
      }
    >
      <Select
        id={id}
        name={name}
        value={shown}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">Not said</option>
        {fits.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.archived ? " (closed)" : ""}
          </option>
        ))}
      </Select>
      {adding && (
        <QuickAccount
          currency={currency}
          onClose={() => setAdding(false)}
          onAdded={(newId) => {
            choose(newId);
            setAdding(false);
          }}
        />
      )}
    </Field>
  );
}

/** A new account without leaving the window: its name and what it is. It starts empty, today; the rest is on Cash & bank. */
function QuickAccount({ currency, onClose, onAdded }: { currency: string; onClose: () => void; onAdded: (id: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MoneyAccountKind>("bank");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await quickAccountAction(name, kind, currency);
      if (!r.ok || !r.id) return setError(r.message ?? "The account could not be added.");
      // The list of accounts comes from the page: read it again, then choose the new one.
      router.refresh();
      onAdded(r.id);
    });
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-surface-2/60 p-2.5">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={`Name of the new ${currency} account`}
          placeholder={`Name, for example Bank of China ${currency}`}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the account; it must not save the payment around it.
            if (e.key === "Enter") {
              e.preventDefault();
              if (name.trim()) add();
            }
          }}
          className="min-w-40 flex-1"
        />
        <Select aria-label="What kind of account" value={kind} onChange={(e) => setKind(e.target.value as MoneyAccountKind)} className="w-36">
          {MONEY_ACCOUNT_KINDS.map((k) => (
            <option key={k} value={k}>
              {MONEY_ACCOUNT_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="xs" onClick={add} disabled={busy || !name.trim()}>
          {busy ? "Adding…" : `Add the ${currency} account`}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Who records what the window saves: the person signed in. Shown on every money window so it is known
 * before saving; it is kept with the record and cannot be typed. `verify`: someone who sends it for a
 * manager to verify.
 */
export function RecordedBy({ verify, className }: { verify?: boolean; className?: string }) {
  const { me } = useContext(DeskContext);
  if (!me) return null;
  return (
    <p className={className ?? "text-xs text-text-2"}>
      {verify ? "Sent by" : "Recorded by"} <strong className="font-semibold text-text">{me}</strong> · today
      {verify && " · it counts once a manager verifies it"}
    </p>
  );
}
