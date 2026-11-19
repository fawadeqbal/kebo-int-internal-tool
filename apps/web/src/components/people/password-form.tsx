"use client";

import { Field, Input } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelKeys, PanelSection, WindowFooter } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Change my password (the company app's account and the platform's): the current one, the new one twice. */
export function PasswordForm({ action, onSaved }: { action: Action; onSaved?: () => void }) {
  return (
    <ActionForm
      action={action}
      resetOnSuccess
      showSuccess={false}
      className={PANEL_FORM}
      onDone={(r) => {
        toast(r.message ?? "Password changed");
        onSaved?.();
      }}
    >
      {(s) => (
        <>
          <PanelSection first className="sm:grid-cols-1">
            <Field label="Current password" htmlFor="current" error={s.errors?.current}>
              <Input id="current" name="current" type="password" autoComplete="current-password" aria-invalid={!!s.errors?.current} />
            </Field>
            <Field
              label="New password"
              htmlFor="next"
              error={s.errors?.next}
              hint="At least 10 characters, with letters and a number"
            >
              <Input id="next" name="next" type="password" autoComplete="new-password" aria-invalid={!!s.errors?.next} />
            </Field>
            <Field label="New password again" htmlFor="confirm" error={s.errors?.confirm}>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" aria-invalid={!!s.errors?.confirm} />
            </Field>
          </PanelSection>
          <WindowFooter>
            <SubmitButton pendingText="Changing…">Change my password</SubmitButton>
            <PanelKeys />
          </WindowFooter>
        </>
      )}
    </ActionForm>
  );
}
