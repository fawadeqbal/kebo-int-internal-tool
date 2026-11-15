"use client";

import { Fragment, useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@kebo/ui";
import { toast, toastsShown, type ToastInput } from "@kebo/ui/client";
import type { ActionState } from "@/lib/actions";
import { ONCE_FIELD, newOnceKey } from "@/lib/once";
import { FormNotice } from "./form-notice";
import { undoAction } from "@/lib/undo-actions";
import { ReasonPrompt } from "./reason-prompt";
import { useWindowDone } from "./route-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A form that closes this soon after its save closed because of it (its window shut): its message goes to a toast. */
const CLOSES_WITHIN_MS = 3000;

/** The save never reached the server (no connection, or the connection dropped): nothing was saved. */
function noConnection(e: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return e instanceof TypeError && /fetch|network|load failed/i.test(e.message);
}

/** What was typed, kept when a save could not go (the form draws its fields from `values` after a failed save). */
function typed(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION") && k !== ONCE_FIELD) out[k] = v;
  return out;
}

/** The fields a failed save named (the server's field errors), in the order the form shows them. */
function problemsOf(state: ActionState): { name: string; message: string }[] {
  if (state.ok !== false || state.code === "reason_needed") return [];
  const seen = new Set<string>();
  return Object.entries(state.errors ?? {}).flatMap(([name, m]) => {
    const message = m?.[0];
    // Said once, even when two fields say the same (two contacts without a name): its link goes to the first.
    if (!message || seen.has(message)) return [];
    seen.add(message);
    return [{ name, message }];
  });
}

/** The field a problem names: where the form says (`fieldId`), else by its name, else its id. */
function fieldOf(form: HTMLFormElement | null, name: string, fieldId?: (key: string) => string | null | undefined): HTMLElement | null {
  if (!form) return null;
  const id = fieldId?.(name);
  if (id) {
    const byId = form.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (byId) return byId;
  }
  const el = form.elements.namedItem(name);
  const one = el instanceof RadioNodeList ? (el[0] as HTMLElement | undefined) : (el as HTMLElement | null);
  return one ?? form.querySelector<HTMLElement>(`#${CSS.escape(name)}`);
}

const COUNT = ["", "One thing", "Two things", "Three things", "Four things", "Five things"];

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
  fieldId,
}: {
  /** Where a field the server names is, when its name is not its field's (a contact's name in a list): its id. */
  fieldId?: (key: string) => string | null | undefined;
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
  const router = useRouter();
  // A save's message ("Payment recorded") while the form may still close (a window shuts on save, or the save
  // takes the form itself off the page: "Mark lost…" is gone once lost): if it does, the message goes to a
  // note, so every save says it was saved. Nothing is added when the owner of the form already showed its own
  // note, or when the form stays open and shows the message itself.
  const unseen = useRef<{ note: ToastInput; toasts: number } | null>(null);
  // A save that cannot reach the server says so and keeps what was typed (it does not end on an error page).
  const send = useCallback(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      let r: ActionState;
      try {
        r = await action(prev, form);
      } catch (e) {
        if (!noConnection(e)) throw e;
        return { ok: false, code: "offline", message: "Not saved: no connection. What you typed is still here.", values: typed(form) };
      }
      // Remembered now, before the page changes: the answer and a fresh page come back together.
      if (r.ok && r.message && !banner) {
        const undo = r.undo;
        const note = {
          note: {
            message: r.message,
            detail: r.detail,
            kind: r.kind,
            actions: r.next,
            // Undo what the action offered: the API checks again; a refusal says why.
            undo: undo
              ? async () => {
                  const u = await undoAction(undo);
                  if (!u.ok) throw new Error(u.message ?? "It could not be undone.");
                  router.refresh();
                }
              : undefined,
          },
          toasts: toastsShown(),
        };
        unseen.current = note;
        setTimeout(() => {
          if (unseen.current === note) unseen.current = null;
        }, CLOSES_WITHIN_MS);
      }
      return r;
    },
    [action, banner, router],
  );
  const [state, formAction] = useActionState(send, {});
  // In a page shown as a window (Record payment): saving closes it, back to the page under it.
  const windowDone = useWindowDone();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<ActionState | null>(null);
  // The save's one-time key (lib/once.ts): the same one until it goes through, so sending it twice saves once.
  const onceKey = useRef<string | null>(null);
  const problems = problemsOf(state);
  useEffect(() => {
    if (state === seen.current || state.ok === undefined) return;
    seen.current = state;
    // A mistake: the fields it names are marked, and the cursor goes to the first one (nothing typed is lost).
    const form = formRef.current;
    form?.querySelectorAll("[data-marked]").forEach((el) => {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("data-marked");
    });
    const named = Object.keys(state.ok === false && state.code !== "reason_needed" ? (state.errors ?? {}) : {})
      .map((name) => fieldOf(form, name, fieldId))
      .filter((el): el is HTMLElement => !!el);
    for (const el of named)
      if (!el.hasAttribute("aria-invalid")) {
        el.setAttribute("aria-invalid", "true");
        el.setAttribute("data-marked", "");
      }
    named[0]?.focus();
    // No connection: the note says so, with Try again (the window stays, with what was typed).
    if (state.code === "offline")
      toast({
        kind: "fail",
        message: "Not saved: no connection",
        detail: "What you typed is still here.",
        actions: [{ label: "Try again", run: () => formRef.current?.requestSubmit() }],
      });
    if (state.ok) {
      onceKey.current = null;
      if (resetOnSuccess) formRef.current?.reset();
      router.refresh();
      onDone?.(state);
      windowDone?.();
    }
  }, [state, router, onDone, resetOnSuccess, windowDone, banner, fieldId]);
  useEffect(
    () => () => {
      const note = unseen.current;
      if (!note || toastsShown() !== note.toasts) return;
      // Never only "Saved.": a plain word says what was saved, the page's record ("Saved · RFQ-2026-0583").
      const where = document.querySelector("#main [data-page-label]")?.getAttribute("data-page-label");
      const plain = /^(saved|done)\.?$/i.test(note.note.message);
      toast(plain && where ? { ...note.note, message: `${note.note.message.replace(/\.$/, "")} · ${where}` } : note.note);
    },
    [],
  );
  // What the save said, drawn at the top of the form's body (or of the form): a mistake, a refusal, no connection.
  const notice = (
    <>
      {banner && state.code !== "reason_needed" && banner(state)}
      {/* A mistake: what to fix, each a way to its field (the fields say it too). */}
      {!banner && problems.length > 0 && (
        <div role="alert" className="mb-3 rounded-[10px] border border-bad/30 bg-bad-soft px-3.5 py-2.5 text-[13px] leading-snug text-bad">
          <b className="block">{COUNT[problems.length] ?? `${problems.length} things`} to fix before saving</b>
          <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {problems.map((p) => (
              <li key={p.name}>
                <button type="button" className="text-left underline underline-offset-2 hover:opacity-80" onClick={() => fieldOf(formRef.current, p.name, fieldId)?.focus()}>
                  {p.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!banner &&
        problems.length === 0 &&
        state.message &&
        (state.ok === false || showSuccess) &&
        state.code !== "reason_needed" &&
        !(state.code && quietCodes?.includes(state.code)) && (
          <Alert tone={state.ok ? "success" : "error"} className="mb-3">
            {state.message}
            {state.detail && <span className="block text-[12.5px] opacity-80">{state.detail}</span>}
          </Alert>
        )}
    </>
  );
  const [hosted, setHosted] = useState(0);
  const claim = useCallback(() => {
    setHosted((n) => n + 1);
    return () => setHosted((n) => n - 1);
  }, []);
  const host = { notice, claim };
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
      <FormNotice.Provider value={host}>
        {!hosted && notice}
        {/* A browser resets a form after each send, and a <select> goes back to the option it first had.
            When the form waits for a reason, the fields are drawn again from what was typed (state.values). */}
        <Fragment key={state.code === "reason_needed" ? `why:${JSON.stringify(state.values ?? {})}` : "form"}>
          {typeof children === "function" ? children(state) : children}
        </Fragment>
      </FormNotice.Provider>
    </form>
  );
}
