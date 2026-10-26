import { z } from "zod";
import {
  BALANCE_TERMS,
  CUSTOMER_TYPES,
  INCOTERMS,
  INQUIRY_CHANNELS,
  INQUIRY_STAGES,
  LINE_TYPES,
  LOST_REASONS,
  MILESTONE_KEYS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PRIORITIES,
  REVISION_STATUSES,
  TAX_TREATMENTS,
} from "../enums";
import { amount, bool, currency, email, id, isoDate, listQuery, amountOr, optionalAmount, optionalDate, optionalId, optionalRate, optionalText, percentOr, phone, quantity, text } from "./common";

/* ---------------------------------------------------------------- customers */

export const contactInput = z
  .object({
    id: optionalId,
    name: text(120, "Enter the contact's name"),
    email,
    phone,
    whatsapp: phone,
    wechat: optionalText(80),
    position: optionalText(80),
    isPrimary: bool.default(false),
  })
  .refine((c) => c.email || c.phone || c.whatsapp || c.wechat, { message: "Give at least one way to reach this contact", path: ["phone"] });

export const customerInput = z.object({
  type: z.enum(CUSTOMER_TYPES).default("company"),
  name: text(200, "Enter the company or person's name"),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Choose a country"),
  address: optionalText(500),
  taxNo: optionalText(60),
  taxTreatment: z.enum(TAX_TREATMENTS).default("export_zero_rated"),
  defaultCurrency: currency.default("USD"),
  notes: optionalText(5000),
  contacts: z.array(contactInput).min(1, "Add at least one contact").max(20),
  /** Save even though a contact's email or phone matches another customer. */
  allowDuplicate: bool.default(false),
});
export type CustomerInput = z.infer<typeof customerInput>;

/* ---------------------------------------------------------------- inquiries */

export const requestedItemInput = z.object({
  id: optionalId,
  description: text(2000, "Each item needs a description"),
  model: optionalText(120),
  quantity,
  unit: z.string().trim().max(20).default("pcs"),
  targetPrice: optionalAmount,
});

export const inquiryInput = z.object({
  customerId: id("Choose a customer"),
  contactId: optionalId,
  channel: z.enum(INQUIRY_CHANNELS).default("email"),
  category: text(120, "Choose a category"),
  title: optionalText(200),
  requirements: optionalText(20000),
  priority: z.enum(PRIORITIES).default("normal"),
  requiredBy: optionalDate,
  assigneeId: optionalId,
  items: z.array(requestedItemInput).min(1, "Add at least one item").max(200),
});
export type InquiryInput = z.infer<typeof inquiryInput>;

export const stageMoveInput = z
  .object({
    to: z.enum(INQUIRY_STAGES),
    lostReason: z.enum(LOST_REASONS).nullish(),
    note: optionalText(2000),
  })
  .refine((v) => v.to !== "lost" || !!v.lostReason, { message: "Choose why the deal was lost", path: ["lostReason"] });
export type StageMoveInput = z.infer<typeof stageMoveInput>;

export const holdInput = z.object({ onHold: bool, note: optionalText(2000) });
export const assignInput = z.object({ assigneeId: optionalId });
export const noteInput = z.object({ body: text(5000, "Write a note first") });

export const inquiryListQuery = listQuery.extend({
  stage: z.union([z.enum(INQUIRY_STAGES), z.enum(["open", "overdue", "on_hold"])]).optional(),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional(),
  customerId: z.uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  channel: z.enum(INQUIRY_CHANNELS).optional(),
  sort: z.enum(["newest", "oldest", "required", "priority", "updated"]).default("newest"),
});
export type InquiryListQuery = z.infer<typeof inquiryListQuery>;

/* ---------------------------------------------------------------- quotations */

export const quoteLineInput = z.object({
  requestedItemId: optionalId,
  type: z.enum(LINE_TYPES).default("goods"),
  description: text(2000, "Each line needs a description"),
  model: optionalText(120),
  hsCode: optionalText(20),
  quantity,
  unit: z.string().trim().max(20).default("pcs"),
  unitPrice: amount("Enter a price"),
  /** Our cost for one unit in the quotation currency (internal, never printed). */
  unitCost: optionalAmount,
  /** The factory price line the cost came from. */
  factoryQuoteLineId: optionalId,
  fxRate: optionalRate,
});
export type QuoteLineInput = z.infer<typeof quoteLineInput>;

export const revisionInput = z.object({
  currency: currency.default("USD"),
  incoterm: z.enum(INCOTERMS).default("FOB"),
  incotermPlace: optionalText(80),
  depositPercent: percentOr(30),
  balanceTerms: z.enum(BALANCE_TERMS).default("before_shipment"),
  leadTime: optionalText(120),
  validUntil: isoDate(),
  vatRate: percentOr(0),
  pricesIncludeVat: bool.default(false),
  discount: amountOr(0),
  terms: optionalText(5000),
  notes: optionalText(5000),
  lines: z.array(quoteLineInput).min(1, "Add at least one line").max(300),
});
export type RevisionInput = z.infer<typeof revisionInput>;

export const revisionMoveInput = z.object({
  to: z.enum(REVISION_STATUSES).exclude(["draft", "superseded"]),
  /** The day it was sent or answered; today when empty. */
  on: optionalDate,
});

/* ---------------------------------------------------------------- orders */

export const orderDatesInput = z.object({ shipBy: optionalDate, readyOn: optionalDate });

export const stepActionInput = z.object({
  action: z.enum(["done", "skip", "undo"]),
  key: z.enum(MILESTONE_KEYS),
  on: optionalDate,
  note: optionalText(2000),
});
export type StepActionInput = z.infer<typeof stepActionInput>;

export const stepDueInput = z.object({ key: z.enum(MILESTONE_KEYS), due: optionalDate });

export const cancelOrderInput = z.object({ reason: text(2000, "Say why the order is cancelled") });

/* ---------------------------------------------------------------- payments */

export const paymentInput = z.object({
  kind: z.enum(PAYMENT_KINDS),
  amount: amount().refine((v) => (v as number) > 0, "The amount must be more than 0"),
  bankCharges: amountOr(0),
  currency,
  paidOn: isoDate(),
  method: z.enum(PAYMENT_METHODS).default("bank_transfer"),
  reference: optionalText(120),
  /** Outgoing payments: the factory order paid. */
  factoryOrderId: optionalId,
  note: optionalText(2000),
});
export type PaymentInput = z.infer<typeof paymentInput>;
