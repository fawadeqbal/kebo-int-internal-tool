/**
 * A part that could not be read (Fawad, 27 Nov: "only the failed part says Could not load, the rest of the page
 * works"). Plain data, so a server action can return it and a client component can tell it apart from "none".
 * Made by part() (lib/part.ts, on the server).
 */
export type Failed = { readonly failed: true; readonly what: string };

export const isFailed = (v: unknown): v is Failed =>
  !!v && typeof v === "object" && (v as { failed?: unknown }).failed === true && typeof (v as { what?: unknown }).what === "string";

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
