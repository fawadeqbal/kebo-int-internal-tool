import { z } from "zod";
import { PAPER_FIX_FIELDS, PAPER_KINDS, type PAPER_OPTIONS } from "../workflows/papers";
import { listQuery, optionalId } from "./common";

/** Inputs for the papers the app makes (see workflows/papers). */

export const paperKind = z.enum(PAPER_KINDS);

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();
const options = z
  .object({ prices: flag, showHs: flag, lcStatement: flag, advance: flag, stamp: flag, models: flag, meta: flag, terms: flag, bank: flag, signatures: flag } satisfies Record<(typeof PAPER_OPTIONS)[number], typeof flag>)
  .default({});

/** Save as draft: the options (and, for a purchase order, which supplier). */
export const paperDraftInput = z.object({ options, ref: optionalId });
export type PaperDraftInput = z.infer<typeof paperDraftInput>;

/** Make again: a new version of a final paper. */
export const paperAgainInput = z.object({ ref: optionalId });
export type PaperAgainInput = z.infer<typeof paperAgainInput>;

/** Missing data typed on the Make page, saved where it belongs (an HS code on one of the order's lines). */
export const paperFixInput = z
  .object({
    field: z.enum(PAPER_FIX_FIELDS),
    value: z.string().trim().max(120),
    lineId: optionalId,
  })
  .refine((v) => v.field !== "hs" || !!v.lineId, { message: "Choose the item", path: ["lineId"] })
  .refine((v) => !["etd", "eta", "readyOn", "shipBy"].includes(v.field) || v.value === "" || /^\d{4}-\d{2}-\d{2}$/.test(v.value), {
    message: "Use a valid date",
    path: ["value"],
  });
export type PaperFixInput = z.infer<typeof paperFixInput>;

/** Read a paper: a version (?v=), the options to preview with (?opts=prices,stamp), which payment, plan item or supplier. */
export const paperQueryInput = z.object({
  v: z.coerce.number().int().min(1).max(999).optional(),
  opts: z.string().max(200).optional(),
  ref: z.string().max(60).optional(),
  /** A payment request as it would print if sent now (not the copy that was sent). */
  now: z.enum(["1"]).optional(),
});
export type PaperQueryInput = z.infer<typeof paperQueryInput>;

/** Send a payment request (kept as sent). `ref`: the plan row, or "balance" for an order without a plan. Sent again: says why. */
export const sendRequestInput = z.object({
  ref: z.string().trim().min(1).max(60),
  reason: z.string().trim().max(500).nullish(),
});
export type SendRequestInput = z.infer<typeof sendRequestInput>;

/* ---------------------------------------------------------------- the translator (25 Nov 2026) */

/** POST /translations/lookup: a paper's texts; answers the Chinese of those that have one, and asks for the rest. */
export const translationLookupInput = z.object({
  texts: z.array(z.string().max(4000)).max(300),
});
export type TranslationLookupInput = z.infer<typeof translationLookupInput>;

/** PATCH /translations/:id: a person's Chinese for the text (it wins over the translator's). */
export const translationFixInput = z.object({
  zh: z
    .string()
    .trim()
    .min(1, "Type the Chinese")
    .max(8000)
    .refine((v) => /[一-鿿]/.test(v), "Type it in Chinese"),
});
export type TranslationFixInput = z.infer<typeof translationFixInput>;

/** GET /translations: to check (the translator's, not checked yet), waiting, failed, or all. */
export const TRANSLATION_SHOWS = ["check", "waiting", "failed", "all"] as const;
export type TranslationShow = (typeof TRANSLATION_SHOWS)[number];
export const translationListQuery = listQuery.extend({
  show: z.enum(TRANSLATION_SHOWS).default("check"),
});
export type TranslationListQuery = z.infer<typeof translationListQuery>;

/** One text of the translator's memory, as the review page shows it. */
export interface TranslationView {
  id: string;
  source: string;
  zh: string | null;
  by: "machine" | "staff" | null;
  status: "waiting" | "done" | "failed";
  error: string | null;
  tries: number;
  checkedBy: string | null;
  updatedAt: string;
}

/** The translator now: off (not set up), ready, starting (loading its model), unreachable; and its texts. */
export interface TranslatorStatus {
  state: "off" | "ready" | "starting" | "unreachable";
  counts: { check: number; waiting: number; failed: number; done: number };
}
