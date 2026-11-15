"use client";

import { Fragment, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@kebo/ui";
import { toast, toastsShown } from "@kebo/ui/client";
import type { ActionState } from "@/lib/actions";
import { ONCE_FIELD, newOnceKey } from "@/lib/once";
import { ReasonPrompt } from "./reason-prompt";
import { useWindowDone } from "./route-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A form that closes this soon after its save closed because of it (its window shut): its message goes to a toast. */
const CLOSES_WITHIN_MS = 3000;

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
  id,
  banner,
}: {
  /** Draws the form's own message instead of the usual one (return null to show nothing). */
  banner?: (state: ActionState) => ReactNode;
  /** The form's id, for a submit button placed outside it (form="…"). */
  id?: string;
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
  // In a page shown as a window (Record payment): saving closes it, back to the page under it.
  const windowDone = useWindowDone();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<ActionState | null>(null);
  // The save's one-time key (lib/once.ts): the same one until it goes through, so sending it twice saves once.
  const onceKey = useRef<string | null>(null);
  // A save's message ("Payment recorded.") while the form may still close (a window shuts on save): if it does,
  // the message goes to a toast, so every save says it was saved. Nothing is added when the owner of the form
  // already showed its own note, or when the form stays open and shows the message itself.
  const unseen = useRef<{ message: string; toasts: number } | null>(null);
  useEffect(() => {
    if (state === seen.current || state.ok === undefined) return;
    seen.current = state;
    if (state.ok) {
      onceKey.current = null;
      if (state.message && !banner) {
        const note = { message: state.message, toasts: toastsShown() };
        unseen.current = note;
        setTimeout(() => {
          if (unseen.current === note) unseen.current = null;
        }, CLOSES_WITHIN_MS);
      }
      if (resetOnSuccess) formRef.current?.reset();
      router.refresh();
      onDone?.(state);
      windowDone?.();
    }
  }, [state, router, onDone, resetOnSuccess, windowDone, banner]);
  useEffect(
    () => () => {
      const note = unseen.current;
      if (note && toastsShown() === note.toasts) toast(note.message);
    },
    [],
  );
  return (
    <form
      ref={formRef}
      id={id}
      action={formAction}
      className={className}
      noValidate
      onReset={keepFields ? (e) => e.preventDefault() : undefined}
      onSubmit={(e) => {
        const field = e.currentTarget.elements.namedItem(ONCE_FIELD);
        if (field instanceof HTMLInputElement) field.value = onceKey.current ??= newOnceKey();
      }}
    >
      <input type="hidden" name={ONCE_FIELD} />
      {state.code === "reason_needed" && <ReasonPrompt key={state.message} state={state} />}
      {banner && state.code !== "reason_needed" && banner(state)}
      {!banner &&
        state.message &&
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
