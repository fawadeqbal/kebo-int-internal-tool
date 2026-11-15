import "server-only";
import { ApiError } from "./api";
import { ONCE_FIELD, ONCE_KEY } from "./once";

/** What every form action returns, so forms show the same kind of feedback everywhere. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  code?: string;
  errors?: Record<string, string[] | undefined>;
  matches?: { id: string; label: string; detail?: string }[];
  /** code "reason_needed": quick reasons to choose from (the form asks "Why?" and sends again with `reason`). */
  choices?: string[];
  /** The values typed, so a form keeps them after an error. */
  values?: Record<string, string>;
  data?: unknown;
  /** The note's quieter line, the facts: "USD 2,000 from Gulf Foods Trading · 4,724.20 still to come". */
  detail?: string;
  /** What kind of thing happened, for the note: done (default), waiting for someone (sent to verify), partly. */
  kind?: "done" | "wait" | "part";
  /** The note's next steps, as links ("Receipt", "Open"). */
  next?: { label: string; href: string }[];
};

/** FormData → plain strings (the API's schemas accept form strings). Fields named `payload` hold JSON for complex forms. */
export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION") && k !== ONCE_FIELD) out[k] = v;
  return out;
}

/**
 * The form's one-time key (every ActionForm sends one): give it to api.post for a money save. One form that
 * makes several saves gives each its `part` (the record's id), so each is done once.
 */
export function onceOf(form: FormData | null, part?: string): string | undefined {
  const v = form?.get(ONCE_FIELD);
  if (typeof v !== "string" || !ONCE_KEY.test(v)) return undefined;
  const key = part ? `${v}-${part}` : v;
  return ONCE_KEY.test(key) ? key : undefined;
}

export function formBody(form: FormData): Record<string, unknown> {
  const values = formValues(form);
  if (values.payload) {
    try {
      const body = JSON.parse(values.payload) as Record<string, unknown>;
      // The "Why?" box sits outside the JSON: its answer goes along with it.
      return values.reason?.trim() ? { ...body, reason: values.reason.trim() } : body;
    } catch {
      return {};
    }
  }
  return values;
}

/** The answer to "Why?" (see ActionForm), if the person gave one. */
export function reasonOf(form: FormData): string | undefined {
  const r = form.get("reason");
  return typeof r === "string" && r.trim() ? r.trim().slice(0, 500) : undefined;
}

/** Run an API call for a form; API errors become messages and field errors instead of crashing the page. */
export async function attempt(form: FormData | null, fn: () => Promise<unknown>, success?: string): Promise<ActionState> {
  try {
    const data = await fn();
    return { ok: true, message: success, data };
  } catch (e) {
    if (e instanceof ApiError) {
      return {
        ok: false,
        message: e.status === 401 ? "Your session ended. Please sign in again." : e.message,
        code: e.code,
        errors: e.body.fieldErrors,
        matches: e.body.matches,
        choices: e.body.choices,
        values: form ? formValues(form) : undefined,
      };
    }
    // Next's redirect/notFound are thrown on purpose.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error("[action]", e);
    return { ok: false, message: "Something went wrong. Please try again.", values: form ? formValues(form) : undefined };
  }
}
