import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ApiError } from "./api";

/**
 * A part of a page that could not be read (Fawad, 27 Nov: "only the failed part says Could not load, the rest of
 * the page works"). Plain data, so it can be handed to a client component.
 */
export type Failed = { readonly failed: true; readonly what: string };

export const isFailed = (v: unknown): v is Failed =>
  !!v && typeof v === "object" && (v as { failed?: unknown }).failed === true && typeof (v as { what?: unknown }).what === "string";

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
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    console.error(
      `[part] could not load ${what}: ${e instanceof ApiError ? `${e.status}${e.code ? ` ${e.code}` : ""}` : e instanceof Error ? e.message : "unknown error"}`,
    );
    return { failed: true, what };
  }
}
