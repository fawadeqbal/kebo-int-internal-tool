import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ApiError } from "./api";
import { isFailed, type Failed } from "./failed";

// What a failed part is lives in lib/failed.ts, which client components may import too.
export { isFailed, type Failed };

/** Not there for this person: 403 (they may not see it) or 404 (it is not there). Left out, never a failure. */
const missing = (e: unknown) => e instanceof ApiError && (e.status === 403 || e.status === 404);

/**
 * A read that may be missing (403, 404: null) but never fails quietly: any other failure goes on to the page's
 * error page. For a page's main read, and what a document cannot be made without (its company's brand).
 */
export async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/** The data of a part, or nothing (null and failed alike): for the places that only need what is there. */
export const dataOf = <T>(v: T | Failed | null): T | null => (v === null || isFailed(v) ? null : v);

/**
 * Reads one part of a page on its own. Its data; null when this person may not see it or it is not there (403,
 * 404: the part is left out, as before); a Failed when it could not be read for any other reason (the server
 * down, an error): the page shows "Could not load {what}" in its place (CouldNotLoad) and the rest works. The
 * failure is logged here (its status and code, never the person's data). Next's own redirects (the two-step
 * set-up) and "not found" go on as they would.
 */
export async function part<T>(what: string, read: () => Promise<T>): Promise<T | Failed | null> {
  try {
    return await read();
  } catch (e) {
    unstable_rethrow(e);
    if (missing(e)) return null;
    console.error(`[part] could not load ${what}: ${why(e)}`);
    return { failed: true, what };
  }
}

/** Why a read failed, in a few words for the log: the API's status and code, or the network's (ECONNREFUSED). */
function why(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}${e.code ? ` ${e.code}` : ""}`;
  if (e instanceof Error) {
    const code = (e.cause as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? `${e.message} (${code})` : e.message;
  }
  return "unknown error";
}

/** The failed parts' names, said once ("who owes, the sales and the open inquiries"); null when none failed. */
export function failedWhat(...parts: unknown[]): string | null {
  const names = [...new Set(parts.filter(isFailed).map((p) => p.what))];
  if (!names.length) return null;
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
