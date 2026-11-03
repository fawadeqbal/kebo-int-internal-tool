"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { discardSiteAction, publishSiteAction } from "./actions";

/** The editor says when it has unsaved changes: then Save the draft is the page's one primary, not Publish. */
export const SITE_DIRTY_EVENT = "site-draft-dirty";

/** Publish the saved draft, or throw it away. */
export function PublishButtons({ unpublished, live }: { unpublished: boolean; live: boolean }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setEditing(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SITE_DIRTY_EVENT, on);
    return () => window.removeEventListener(SITE_DIRTY_EVENT, on);
  }, []);
  return (
    <div className="flex flex-wrap items-start gap-2">
      {unpublished && live && (
        <ActionForm action={discardSiteAction} showSuccess={false}>
          <SubmitButton variant="ghost" size="sm" pendingText="Throwing away…">
            Throw the draft away
          </SubmitButton>
        </ActionForm>
      )}
      <ActionForm action={publishSiteAction} showSuccess={false}>
        <SubmitButton size="sm" variant={unpublished && !editing ? "primary" : "secondary"} pendingText="Publishing…" disabled={!unpublished}>
          {unpublished ? "Publish the draft" : "Published"}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
