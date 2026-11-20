"use client";

import { EditButton } from "@/components/common/edit-button";
import { PanelBody, SidePanel, useSidePanel } from "@/components/common/panel";
import { platformPasswordAction } from "@/app/platform/actions";
import { PasswordForm } from "@/components/people/password-form";

/** ✎ Change in the Password card's header, and the side panel it opens (?panel=password). */
export function PasswordEdit() {
  const panel = useSidePanel("password");
  return (
    <>
      <EditButton label="Change" aria-label="Change your password" onClick={() => panel.openPanel()} />
      {panel.open && (
        <SidePanel title="Change your password" description="Your other devices are signed out." onClose={() => panel.close()}>
          <PanelBody>
            <PasswordForm action={platformPasswordAction} onSaved={() => panel.close()} />
          </PanelBody>
        </SidePanel>
      )}
    </>
  );
}

