"use client";

import { Field, Input } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { EditButton } from "@/components/common/edit-button";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, PanelSection, SidePanel, useClosePanel, useSidePanel } from "@/components/common/panel";
import { platformPasswordAction } from "@/app/platform/actions";

/** ✎ Change in the Password card's header, and the side panel it opens (?panel=password). */
export function PasswordEdit() {
  const panel = useSidePanel("password");
  return (
    <>
      <EditButton label="Change" aria-label="Change your password" onClick={() => panel.openPanel()} />
      {panel.open && (
        <SidePanel title="Change your password" description="Your other devices are signed out." onClose={() => panel.close()}>
          <PanelBody>
            <PasswordForm onSaved={() => panel.close()} />
          </PanelBody>
        </SidePanel>
      )}
    </>
  );
}

export function PasswordForm({ onSaved }: { onSaved?: () => void }) {
  const close = useClosePanel();
  return (
    <ActionForm
      action={platformPasswordAction}
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
              <Input id="current" name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" htmlFor="next" hint="At least 10 characters, with letters and a number" error={s.errors?.next}>
              <Input id="next" name="next" type="password" autoComplete="new-password" required />
            </Field>
            <Field label="The new password again" htmlFor="confirm" error={s.errors?.confirm}>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </Field>
          </PanelSection>
          <PanelActions>
            <SubmitButton pendingText="Changing…">Change password</SubmitButton>
            <button type="button" className="text-sm font-medium text-text-2 hover:text-text" onClick={() => close()}>
              Cancel
            </button>
            <PanelKeys />
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}
