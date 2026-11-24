"use client";

import { FormButtons } from "@/components/common/route-window";
import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { Button, Field, Input, Select } from "@kebo/ui";
import { ActionForm } from "@/components/common/action-form";
import { SubmitButton } from "@kebo/ui/client";
import { closeBooksAction } from "./actions";

export type BooksView = { closedThrough: string | null; closedBy: string | null; closedAt: string | null; reason: string | null; latest: string };

/** Close through a month that has ended; a month before the closed one, or none, opens months again (with a reason). */
export function CloseBooksForm({ view, months }: { view: BooksView; months: { value: string; label: string }[] }) {
  const current = view.closedThrough?.slice(0, 7) ?? "";
  // It starts on the month closed now (nothing to save), not the latest month: closing is chosen, never the default
  // (review 24 Nov), and it is said once more before it is done.
  const [month, setMonth] = useState(current);
  const [sure, setSure] = useState(false);
  const opening = !!current && (month === "" || month < current);
  const chosen = months.find((m) => m.value === month)?.label ?? month;
  return (
    <ActionForm action={closeBooksAction} keepFields className="flex max-w-xl flex-col gap-4">
      {(s) => (
        <>
          <Field label="Closed through the end of" htmlFor="books-month" hint="Only a month that has ended can be closed.">
            <Select
              id="books-month"
              name="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSure(false);
              }}
            >
              {!current && <option value="">Choose a month…</option>}
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              {current && <option value="">None: open every month</option>}
            </Select>
          </Field>
          {opening && (
            <Field label="Why open it again" htmlFor="books-reason" error={s.errors?.reason}>
              <Input id="books-reason" name="reason" required maxLength={500} defaultValue={s.values?.reason ?? ""} />
            </Field>
          )}
          {!opening && sure && (
            <p className="text-md text-text-2" role="status">
              Payments, costs and moves dated up to the end of {chosen} can no longer be added, changed or removed. Press again
              to close.
            </p>
          )}
          <FormButtons>
            {!opening && !sure ? (
              <Button type="button" disabled={month === current || !month} onClick={() => setSure(true)}>
                <Lock aria-hidden /> Close the books
              </Button>
            ) : (
              <SubmitButton pendingText="Saving…" disabled={month === current}>
                {opening ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
                {opening ? "Open again" : `Close through ${chosen}`}
              </SubmitButton>
            )}
          </FormButtons>
        </>
      )}
    </ActionForm>
  );
}
