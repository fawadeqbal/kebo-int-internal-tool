"use client";

import { Bell } from "lucide-react";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

/** "Send a reminder" next to someone who signs in without two-step. */
export function TwoStepRemind({ action }: { action: (prev: ActionState, form: FormData) => Promise<ActionState> }) {
  return (
    <ActionForm action={action} className="inline-flex flex-col items-end gap-1">
      <SubmitButton size="xs" variant="secondary" pendingText="Sending…">
        <Bell aria-hidden /> Send a reminder
      </SubmitButton>
    </ActionForm>
  );
}
