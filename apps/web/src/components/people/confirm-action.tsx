"use client";

import type { ReactNode } from "react";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
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
}: {
  action: Action;
  confirm?: string;
  label: string;
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
        <ConfirmSubmit message={confirm} variant={variant} size={size} pendingText={pendingText}>
          {icon}
          {label}
        </ConfirmSubmit>
      ) : (
        <SubmitButton variant={variant} size={size} pendingText={pendingText}>
          {icon}
          {label}
        </SubmitButton>
      )}
    </ActionForm>
  );
}
