import "server-only";
import { ApiError } from "./api";

/** What every form action returns, so forms show the same kind of feedback everywhere. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  code?: string;
  errors?: Record<string, string[] | undefined>;
  matches?: { id: string; label: string; detail?: string }[];
  /** The values typed, so a form keeps them after an error. */
  values?: Record<string, string>;
  data?: unknown;
};

/** FormData → plain strings (the API's schemas accept form strings). Fields named `payload` hold JSON for complex forms. */
export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export function formBody(form: FormData): Record<string, unknown> {
  const values = formValues(form);
  if (values.payload) {
    try {
      return JSON.parse(values.payload) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return values;
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
        values: form ? formValues(form) : undefined,
      };
    }
    // Next's redirect/notFound are thrown on purpose.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error("[action]", e);
    return { ok: false, message: "Something went wrong. Please try again.", values: form ? formValues(form) : undefined };
  }
}
