import { z } from "zod";
import { ATTACHMENT_KINDS } from "../enums";
import { FLOW_STEPS, type FlowStep } from "./flow";
import { ORDER_SECTIONS } from "./order-sections";

/**
 * Documents v3: every file of an order in one list (GET /orders/:id/files),
 * wherever it is kept — the deal's files (URS, drawings), a paper's file, a
 * section's file, a file added on a step, a payment's proof, a supplier
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
  factory: "Supplier",
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

/** What a file is attached to: a paper, a section of the order, a step, the deal (inquiry), a payment, a supplier payment, an expense or a supplier offer. */
export const ORDER_FILE_LINKS = ["paper", "section", "step", "inquiry", "payment", "factory_payment", "expense", "offer"] as const;
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
 * a step ("step", target: the step), or a section of the order's page.
 */
export const orderFileAttachInput = z.discriminatedUnion("to", [
  z.object({ to: z.literal("paper"), target: z.string().trim().min(1).max(80) }),
  z.object({ to: z.literal("step"), target: z.enum(FLOW_STEPS) }),
  // A section of the order's page (booking, vessel, fat…): the file is kept as one of that section's files.
  z.object({ to: z.literal("section"), target: z.enum(ORDER_SECTIONS) }),
]);
export type OrderFileAttachInput = z.infer<typeof orderFileAttachInput>;

/** multipart fields with the file: the step it belongs to, what it is, and (optionally) where to attach it. */
export const orderFileUploadInput = z.object({
  step: z.preprocess(blankToUndefined, z.enum(FLOW_STEPS).optional()),
  /** The section whose window the file was added in; its stage follows from it. */
  section: z.preprocess(blankToUndefined, z.enum(ORDER_SECTIONS).optional()),
  kind: z.preprocess(blankToUndefined, z.enum(ATTACHMENT_KINDS).optional()),
  note: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => (v ? v : null)),
  /** A photo of one package and its marks (section "packing"): the package's number as marked. */
  packageNo: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => (v ? v : null)),
  /** "paper:<target>" (see orderFileAttachInput). */
  attachTo: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^paper:[\w:.-]{1,80}$/, "Choose where to attach it")
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
 * How a document went out when the app did not email it (design "Email and Share", 26 Nov 2026): the phone's
 * share sheet, a download to send, the person's own mail app, a chat app, in person or another way.
 */
export const SHARE_VIA = ["share", "download", "email", "whatsapp", "wechat", "telegram", "in_person", "other"] as const;
export type ShareVia = (typeof SHARE_VIA)[number];
/** "on WhatsApp": how it went, after "sent the commercial invoice". */
export const SHARE_VIA_TEXT: Record<ShareVia, string> = {
  share: "through the phone's share sheet",
  download: "after downloading it",
  email: "by email from their own mail app",
  whatsapp: "on WhatsApp",
  wechat: "on WeChat",
  telegram: "on Telegram",
  in_person: "in person",
  other: "another way",
};

/**
 * Sent by the person, not the app (Share, Email › myself): this only notes in History who sent what, how and
 * when (`on`: the day it went, when it was not today).
 */
export const orderFilesShareInput = z
  .object({
    files: z.array(orderFileRef).max(300).default([]),
    /** Paper keys of GET /orders/:id/papers (commercial-invoice, doc:<id>, …). */
    papers: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
    via: z.enum(SHARE_VIA),
    on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish()
      .transform((v) => v ?? null),
    message: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.files.length + v.papers.length > 0, { message: "Choose what to share" });
export type OrderFilesShareInput = z.infer<typeof orderFilesShareInput>;

const listOf = (s: string | undefined) => (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Email from the app (design "Email and Share", 26 Nov 2026): multipart, these fields and what goes as `files`
 * (the documents' PDFs as shown, the stored files), `names` their names in the same order (JSON). For an order,
 * `order` with the paper keys and file refs that go, so its History says what was emailed; else `about`
 * (customer:<id>, inquiry:<id>, supplier:<id>) for the activity log.
 */
export const mailOutForm = z.object({
  to: z.string().transform(listOf).pipe(z.array(z.string().email("Check the email address")).min(1, "Who is it to?").max(10, "At most 10 addresses")),
  cc: z.string().optional().transform(listOf).pipe(z.array(z.string().email("Check the copy address")).max(10, "At most 10 addresses")),
  subject: z.string().trim().min(1, "Write a subject").max(300),
  message: z
    .string()
    .trim()
    .max(10000)
    .optional()
    .transform((v) => v || null),
  names: z
    .string()
    .optional()
    .transform((v, ctx) => {
      try {
        const x: unknown = JSON.parse(v || "[]");
        if (Array.isArray(x) && x.every((n) => typeof n === "string" && n.length <= 200)) return x as string[];
      } catch {
        /* said below */
      }
      ctx.addIssue({ code: "custom", message: "The files' names could not be read" });
      return z.NEVER;
    }),
  order: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
  papers: z.string().optional().transform(listOf).pipe(z.array(z.string().min(1).max(120)).max(60)),
  files: z.string().optional().transform(listOf).pipe(z.array(orderFileRef).max(60)),
  about: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^(customer|inquiry|supplier):[0-9a-f-]{36}$/).optional()),
});
export type MailOutForm = z.infer<typeof mailOutForm>;

/** Size as people read it: 380 KB, 2.4 MB. */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** PDFs and photos open in the app; everything else downloads. */
export const VIEWABLE_FILE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i;
