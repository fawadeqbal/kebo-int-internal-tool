"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import type { MoneyAccountKind } from "@kebo/shared";
import { Field, Select } from "@kebo/ui";

/** One of our accounts, as offered when money is recorded. */
export interface AccountOption {
  id: string;
  name: string;
  kind: MoneyAccountKind;
  currency: string;
  archived: boolean;
}

const Accounts = createContext<AccountOption[]>([]);

/** Our accounts for every money form on the page (loaded once by the app layout for people who record money). */
export function AccountsProvider({ accounts, children }: { accounts: AccountOption[]; children: ReactNode }) {
  return <Accounts.Provider value={accounts}>{children}</Accounts.Provider>;
}

/**
 * Which of our accounts money moved through: only accounts in the same
 * currency, open ones (and the one already chosen). With no accounts set up
 * yet it keeps the field out of the way.
 */
export function AccountSelect({
  id,
  label,
  currency,
  defaultValue,
  error,
  className,
}: {
  id: string;
  label: string;
  currency: string;
  defaultValue?: string | null;
  error?: string[];
  className?: string;
}) {
  const all = useContext(Accounts);
  if (all.length === 0) return <input type="hidden" name="accountId" value={defaultValue ?? ""} />;
  const fits = all.filter((a) => a.currency === currency && (!a.archived || a.id === defaultValue));
  return (
    <Field
      label={label}
      htmlFor={id}
      optional
      error={error}
      className={className}
      hint={
        fits.length === 0 ? (
          <>
            No {currency} account yet.{" "}
            <Link href="/money?tab=cash" className="underline">
              Add one
            </Link>
          </>
        ) : (
          "For the cash book"
        )
      }
    >
      <Select key={currency} id={id} name="accountId" defaultValue={fits.some((a) => a.id === defaultValue) ? (defaultValue ?? "") : ""} disabled={fits.length === 0}>
        <option value="">Not said</option>
        {fits.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.archived ? " (closed)" : ""}
          </option>
        ))}
      </Select>
    </Field>
  );
}
