"use client";

import { Field, Input, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function DatesForm({ action, shipBy, readyOn, canEdit }: { action: Action; shipBy: string | null; readyOn: string | null; canEdit: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(s) => (
        <>
          <Field label="Ship by (promised to the customer)" htmlFor="shipBy" error={s.errors?.shipBy} optional>
            <Input id="shipBy" name="shipBy" type="date" defaultValue={s.values?.shipBy ?? shipBy ?? ""} disabled={!canEdit} />
          </Field>
          <Field label="Factory ready date" htmlFor="readyOn" error={s.errors?.readyOn} optional hint="Set by the factory's confirmation; change it if they move it">
            <Input id="readyOn" name="readyOn" type="date" defaultValue={s.values?.readyOn ?? readyOn ?? ""} disabled={!canEdit} />
          </Field>
          {canEdit && (
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
              Save dates
            </SubmitButton>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function CancelOrderForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(s) => (
        <>
          <Field label="Reason" htmlFor="reason" error={s.errors?.reason}>
            <Textarea id="reason" name="reason" rows={2} className="min-h-0" />
          </Field>
          <SubmitButton size="sm" variant="danger" pendingText="Cancelling…">
            Cancel order
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
