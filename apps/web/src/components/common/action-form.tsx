"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Every form in the app: runs a server action, shows its message, keeps typed
 * values after an error, and refreshes the page data after success.
 * Children may be a function of the state to show field errors.
 */
export function ActionForm({
  action,
  children,
  className,
  onDone,
  resetOnSuccess,
  showSuccess = true,
  quietCodes,
}: {
  action: Action;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  onDone?: (state: ActionState) => void;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  /** Error codes the form explains itself (e.g. "confirm": a warning with "Go ahead anyway"), so the usual red message is not shown. */
  quietCodes?: string[];
}) {
  const [state, formAction] = useActionState(action, {});
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state === seen.current || state.ok === undefined) return;
    seen.current = state;
    if (state.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      router.refresh();
      onDone?.(state);
    }
  }, [state, router, onDone, resetOnSuccess]);
  return (
    <form ref={formRef} action={formAction} className={className} noValidate>
      {state.message && (state.ok === false || showSuccess) && !(state.code && quietCodes?.includes(state.code)) && (
        <Alert tone={state.ok ? "success" : "error"} className="mb-3">
          {state.message}
        </Alert>
      )}
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}
