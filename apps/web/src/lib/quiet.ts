/**
 * Failures that may stay quiet, named (Fawad's standard: never swallow an error silently). A read the person relies
 * on goes through part() (lib/part.ts) and says "Could not load"; these are steps whose failure changes nothing
 * they rely on, and each says why it may be quiet. Usable on the server and in the browser. Next's own throws (a
 * redirect, notFound) are never quiet: they go on.
 */

import { unstable_rethrow } from "next/navigation";

const said = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error");

/**
 * For `.catch(…)`: a step whose failure changes nothing the person relies on (closing a page that made a PDF, a
 * file's size for its label). Logged as a warning naming the step; `silent` only for the error reports themselves
 * (a failed report must not report itself).
 */
export const ignore =
  (why: string, opts: { silent?: boolean } = {}) =>
  (e: unknown): undefined => {
    unstable_rethrow(e);
    if (!opts.silent) console.warn(`[ignored] ${why}: ${said(e)}`);
    return undefined;
  };

/** Awaits a step that is done for good measure (signing out at the API, marking an alert read): its failure is logged, not thrown. */
export async function bestEffort<T>(why: string, step: Promise<T>): Promise<T | undefined> {
  try {
    return await step;
  } catch (e) {
    return ignore(why)(e);
  }
}

/** What the API says when it refuses: its words, its code, and each field's problems. */
export type Refusal = { error?: string; code?: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * A response's (or a request's) JSON body, or null when it has none or it is not JSON (an error page from a proxy):
 * to read an error's words after a failure that is shown anyway (an upload, an export), or a body that is checked
 * before use; never to read data a page shows (that is api.get, whose unreadable answer is a failure).
 */
export async function bodyOf<T = Refusal>(res: { text(): Promise<string> }): Promise<T | null> {
  const text = await res.text().catch(ignore("reading an answer's words"));
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
