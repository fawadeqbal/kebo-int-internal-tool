"use client";

import { Field, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function NoteForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-2">
      {(s) => (
        <>
          <Field label="Add a note" htmlFor="text" error={s.errors?.text}>
            <Textarea id="text" name="text" rows={3} placeholder="Called, sent the price list, wants a demo on Monday…" />
          </Field>
          <div>
            <SubmitButton size="sm" variant="secondary" pendingText="Adding…">
              Add note
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
