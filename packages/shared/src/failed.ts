/**
 * A part of a page that could not be read (Fawad, 27 Nov: "only the failed part says Could not load, the rest of
 * the page works"). Plain data, the same on both sides: the API puts it in a part's place (GET /orders/:id/page), the
 * web's part() makes it, a server action returns it, and a client component tells it apart from "none" (null).
 */
export type Failed = { readonly failed: true; readonly what: string };

export const isFailed = (v: unknown): v is Failed =>
  !!v && typeof v === "object" && (v as { failed?: unknown }).failed === true && typeof (v as { what?: unknown }).what === "string";
