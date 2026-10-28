"use client";

import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { discardSiteAction, publishSiteAction } from "./actions";

/** Publish the saved draft, or throw it away. */
export function PublishButtons({ unpublished, live }: { unpublished: boolean; live: boolean }) {
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
        <SubmitButton size="sm" pendingText="Publishing…" disabled={!unpublished}>
          {unpublished ? "Publish the draft" : "Published"}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
