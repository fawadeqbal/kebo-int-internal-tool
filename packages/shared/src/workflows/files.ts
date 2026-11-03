import { z } from "zod";
import { ATTACHMENT_KINDS } from "../enums";
import { FLOW_STEPS, type FlowStep } from "./flow";

/**
 * Documents v3: every file of an order in one list (GET /orders/:id/files),
 * wherever it is kept — the deal's files (URS, drawings), a paper's file, a
 * checklist item's file, a file added on a step, a payment's proof, a factory
 * payment's proof, an expense's receipt — with the same tools everywhere.
 */

/** Where a file is stored, which decides who may change it. */
export const ORDER_FILE_SOURCES = ["attachment", "payment", "factory_payment", "expense"] as const;
export type OrderFileSource = (typeof ORDER_FILE_SOURCES)[number];

/** The groups of the Files list (and its filter). */
export const ORDER_FILE_GROUPS = ["customer", "factory", "shipping", "bank", "money"] as const;
export type OrderFileGroup = (typeof ORDER_FILE_GROUPS)[number];

export const ORDER_FILE_GROUP_LABEL: Record<OrderFileGroup, string> = {
  customer: "Customer",
  factory: "Factory",
  shipping: "Shipping",
  bank: "Bank",
  money: "Money",
};

/** The group of a file kept on a step (money files are always Money). */
export const STEP_FILE_GROUP: Record<FlowStep, OrderFileGroup> = {
  payment: "customer",
  factory: "factory",
  production: "factory",
  shipping: "shipping",
  documents: "bank",
  delivery: "customer",
};

/** What a file is attached to: a paper, a checklist item, a step, the deal (inquiry), a payment, a factory payment, an expense or a factory offer. */
export const ORDER_FILE_LINKS = ["paper", "checklist", "step", "inquiry", "payment", "factory_payment", "expense", "offer"] as const;
export type OrderFileLink = (typeof ORDER_FILE_LINKS)[number];

/** "attachment:<uuid>" — one file of the list, as the list and the zip name it. */
export const orderFileRef = z
  .string()
  .trim()
  .regex(
    /^(attachment|payment|factory_payment|expense):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Choose a file of this order",
  );

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/** Rename, and say what it is (the deal's file kinds and a short note). */
export const orderFileUpdateInput = z
  .object({
    name: z.preprocess(blankToUndefined, z.string().trim().min(1).max(200).optional()),
    kind: z.preprocess(blankToUndefined, z.enum(ATTACHMENT_KINDS).optional()),
    note: z
      .string()
      .trim()
      .max(300)
      .nullish()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
  })
  .refine((v) => v.name !== undefined || v.kind !== undefined || v.note !== undefined, { message: "Nothing to change" });
export type OrderFileUpdateInput = z.infer<typeof orderFileUpdateInput>;

/**
 * Attach to… a paper ("paper", target: the document-set kind, e.g. bill_of_lading, or "doc:<row id>"),
 * a checklist item ("checklist", target: the item's id, or an automatic item's key), or a step ("step", target: the step).
 */
export const orderFileAttachInput = z.discriminatedUnion("to", [
  z.object({ to: z.literal("paper"), target: z.string().trim().min(1).max(80) }),
  z.object({ to: z.literal("checklist"), target: z.string().trim().min(1).max(80) }),
  z.object({ to: z.literal("step"), target: z.enum(FLOW_STEPS) }),
]);
export type OrderFileAttachInput = z.infer<typeof orderFileAttachInput>;

/** multipart fields with the file: the step it belongs to, what it is, and (optionally) where to attach it. */
export const orderFileUploadInput = z.object({
  step: z.preprocess(blankToUndefined, z.enum(FLOW_STEPS).optional()),
  kind: z.preprocess(blankToUndefined, z.enum(ATTACHMENT_KINDS).optional()),
  note: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => (v ? v : null)),
  /** "paper:<target>" or "checklist:<target>" (see orderFileAttachInput). */
  attachTo: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^(paper|checklist):[\w:.-]{1,80}$/, "Choose where to attach it")
      .optional(),
  ),
});
export type OrderFileUploadInput = z.infer<typeof orderFileUploadInput>;

/** ?files=attachment:…,payment:… — some files in one zip (all of them when empty). */
export const orderFilesZipQuery = z.object({
  files: z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(orderFileRef).max(300).optional()),
});
export type OrderFilesZipQuery = z.infer<typeof orderFilesZipQuery>;

/**
 * "Share…": the app sends nothing; the phone's share sheet or a download plus a copied message does.
 * This only notes in History who shared what, when and how.
 */
export const orderFilesShareInput = z
  .object({
    files: z.array(orderFileRef).max(300).default([]),
    /** Paper keys of GET /orders/:id/papers (commercial-invoice, doc:<id>, …). */
    papers: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
    via: z.enum(["share", "download"]),
    message: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.files.length + v.papers.length > 0, { message: "Choose what to share" });
export type OrderFilesShareInput = z.infer<typeof orderFilesShareInput>;

/** Size as people read it: 380 KB, 2.4 MB. */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** PDFs and photos open in the app; everything else downloads. */
export const VIEWABLE_FILE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i;
