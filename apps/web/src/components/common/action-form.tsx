"use client";

import { Fragment, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { ReasonPrompt } from "./reason-prompt";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Every form in the app: runs a server action, shows its message, keeps typed
 * values after an error, and refreshes the page data after success.
 * Children may be a function of the state to show field errors. When a change
 * needs a reason (code "reason_needed") it asks "Why?" and sends again.
 */
export function ActionForm({
  action,
  children,
  className,
  onDone,
  resetOnSuccess,
  showSuccess = true,
  quietCodes,
  keepFields,
}: {
  action: Action;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  onDone?: (state: ActionState) => void;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  /** Error codes the form explains itself (e.g. "confirm": a warning with "Go ahead anyway"), so the usual red message is not shown. */
  quietCodes?: string[];
  /**
   * Forms whose fields live in React state: React resets a form after each send, which puts every <select>
   * back on its first option while the state still holds the choice. These forms skip that reset.
   */
  keepFields?: boolean;
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
    <form ref={formRef} action={formAction} className={className} noValidate onReset={keepFields ? (e) => e.preventDefault() : undefined}>
      {state.code === "reason_needed" && <ReasonPrompt key={state.message} state={state} />}
      {state.message &&
        (state.ok === false || showSuccess) &&
        state.code !== "reason_needed" &&
        !(state.code && quietCodes?.includes(state.code)) && (
          <Alert tone={state.ok ? "success" : "error"} className="mb-3">
            {state.message}
          </Alert>
        )}
      {/* A browser resets a form after each send, and a <select> goes back to the option it first had.
          When the form waits for a reason, the fields are drawn again from what was typed (state.values). */}
      <Fragment key={state.code === "reason_needed" ? `why:${JSON.stringify(state.values ?? {})}` : "form"}>
        {typeof children === "function" ? children(state) : children}
      </Fragment>
    </form>
  );
}
