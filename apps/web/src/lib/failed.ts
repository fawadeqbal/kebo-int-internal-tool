import type { Failed } from "@kebo/shared";

/**
 * A part that could not be read: what it is lives in @kebo/shared (the API sends the same in a part's place). Made
 * by part() (lib/part.ts, on the server).
 */
export { isFailed, type Failed } from "@kebo/shared";

/**
 * For `.catch(…)` on a server action called from the browser: a dropped connection (the call rejects) is a Failed
 * too, said like any other, and logged in the browser's console.
 */
export const failedWhenRejected =
  (what: string) =>
  (e: unknown): Failed => {
    console.warn(`[failed] could not load ${what}: ${e instanceof Error ? e.message : String(e)}`);
    return { failed: true, what };
  };
