"use client";

import type { ReactNode } from "react";
import { SubmitButton } from "@kebo/ui/client";
import { ConfirmSubmit } from "@/components/common/dialog";
import type { ButtonSize, ButtonVariant } from "@kebo/ui";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * One button that runs an action (remove, switch off, mark all read…), asking
 * first when `confirm` is given. Shows the API's answer above it.
 */
export function ConfirmAction({
  action,
  confirm,
  label,
  icon,
  pendingText = "Working…",
  variant = "danger-ghost",
  size = "sm",
  className,
  showSuccess = true,
  what,
}: {
  action: Action;
  confirm?: string;
  label: string;
  /** What it is done to, read out after the label ("Sign out" "Sana's phone"): each of many alike buttons apart. */
  what?: string;
  icon?: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  showSuccess?: boolean;
}) {
  return (
    <ActionForm action={action} className={className} showSuccess={showSuccess}>
      {confirm ? (
        <ConfirmSubmit confirmLabel={label} message={confirm} variant={variant} size={size} pendingText={pendingText}>
          {icon}
          {label}
          {what && <span className="sr-only"> {what}</span>}
        </ConfirmSubmit>
      ) : (
        <SubmitButton variant={variant} size={size} pendingText={pendingText}>
          {icon}
          {label}
          {what && <span className="sr-only"> {what}</span>}
        </SubmitButton>
      )}
    </ActionForm>
  );
}
