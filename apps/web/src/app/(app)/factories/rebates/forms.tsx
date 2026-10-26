"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { REBATE_CHOICES } from "@kebo/shared";
import { Badge, Button, Field, Input } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PercentChoice } from "@/components/common/percent-choice";
import type { ActionState } from "@/lib/actions";
import { date } from "@/lib/format";
import type { HsCodeRow } from "@/lib/types-deals";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const REBATE_OPTIONS = REBATE_CHOICES.map((value) => ({ value }));
const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";

/** Add a code (row null) or change one: its rebate % and a description. */
function HsCodeForm({ action, row, onDone }: { action: Action; row: HsCodeRow | null; onDone: () => void }) {
  const [rebate, setRebate] = useState(row ? String(row.rebateRate) : "");
  const id = row ? `hs-${row.code}` : "hs-new";
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => (
        <>
          <input type="hidden" name="rebateRate" value={rebate} />
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            {row ? (
              <div>
                <p className="text-xs text-muted">HS code</p>
                <p className="flex h-9 items-center font-medium tabular">{row.code}</p>
              </div>
            ) : (
              <Field label="HS code" htmlFor={`${id}-code`} error={s.errors?.code}>
                <Input id={`${id}-code`} name="code" inputMode="decimal" maxLength={20} placeholder="e.g. 8437.80" className="tabular" defaultValue={s.values?.code} autoFocus aria-invalid={!!s.errors?.code || undefined} />
              </Field>
            )}
            <Field label="Description" htmlFor={`${id}-desc`} optional error={s.errors?.description}>
              <Input id={`${id}-desc`} name="description" maxLength={200} placeholder="e.g. Maize shellers" defaultValue={s.values?.description ?? row?.description ?? ""} />
            </Field>
          </div>
          <Field label="Export rebate" htmlFor={`${id}-rebate`} error={s.errors?.rebateRate}>
            <PercentChoice id={`${id}-rebate`} label="Export rebate" value={rebate} onChange={setRebate} choices={REBATE_OPTIONS} invalid={!!s.errors?.rebateRate} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              {row ? "Save" : "Add the HS code"}
            </SubmitButton>
            <Button size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** "Add an HS code" at the end of the filter bar; the form opens on its own line below. */
export function AddHsCode({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="sm" variant="primary" className="ml-auto" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add an HS code
      </Button>
    );
  return (
    <div className="basis-full pt-1">
      <HsCodeForm action={action} row={null} onDone={() => setOpen(false)} />
    </div>
  );
}

/** One remembered code: its rebate, what it is, who changed it last; edit or remove. */
export function HsCodeItem({ row, saveAction, removeAction }: { row: HsCodeRow; saveAction: Action; removeAction: Action }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <li className="px-4 py-3">
        <HsCodeForm action={saveAction} row={row} onDone={() => setEditing(false)} />
      </li>
    );
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium tabular">{row.code}</span>
          <Badge tone={row.rebateRate > 0 ? "ok" : "neutral"}>{row.rebateRate}% rebate</Badge>
        </p>
        {row.description && <p className="truncate text-sm text-text-2">{row.description}</p>}
        <p className="text-xs text-muted">
          Changed {date(row.updatedAt)}
          {row.updatedBy ? ` by ${row.updatedBy.name}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
        <ActionForm action={removeAction} showSuccess={false} className="inline-flex">
          <ConfirmSubmit size="xs" variant="danger-ghost" pendingText="Removing…" message={`Remove HS ${row.code}? Prices already entered keep their rebate; the next price with this code asks for it again.`}>
            Remove
          </ConfirmSubmit>
        </ActionForm>
      </div>
    </li>
  );
}
