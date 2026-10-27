"use client";

import { useState } from "react";
import { Target } from "lucide-react";
import { Button, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { MoneyInput } from "@/components/common/money-input";
import { saveTargetAction } from "@/app/(app)/money/actions";

/** Set or change a month's sales target (managers). */
export function TargetEditor({ month, current, currency }: { month: string; current: string | null; currency: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant={current ? "ghost" : "secondary"} onClick={() => setOpen(true)}>
        <Target aria-hidden /> {current ? "Change target" : "Set a monthly target"}
      </Button>
    );
  return (
    <ActionForm action={saveTargetAction} onDone={() => setOpen(false)} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Month" htmlFor="tg-month" error={s.errors?.month}>
              <Input id="tg-month" name="month" type="month" defaultValue={s.values?.month ?? month} />
            </Field>
            <Field label={`Sales target (${currency})`} htmlFor="tg-amount" hint="Orders won that month. Empty removes it." error={s.errors?.amount}>
              <MoneyInput id="tg-amount" name="amount" currency={currency} defaultValue={s.values?.amount ?? current ?? ""} placeholder="e.g. 100,000" />
            </Field>
          </div>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save the target
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
