"use client";

import { Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { platformPasswordAction } from "@/app/platform/actions";

export function PasswordForm() {
  return (
    <ActionForm action={platformPasswordAction} resetOnSuccess className="flex flex-col gap-4">
      {(s) => (
        <>
          <Field label="Current password" htmlFor="current" error={s.errors?.current}>
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" htmlFor="next" hint="At least 10 characters, with letters and a number" error={s.errors?.next}>
            <Input id="next" name="next" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="The new password again" htmlFor="confirm" error={s.errors?.confirm}>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <div>
            <SubmitButton size="sm">Change password</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
