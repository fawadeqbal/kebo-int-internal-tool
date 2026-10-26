import { z } from "zod";
import {
  BALANCE_TERMS,
  CUSTOMER_TYPES,
  INCOTERMS,
  INQUIRY_CHANNELS,
  INQUIRY_STAGES,
  LINE_TYPES,
  LOST_REASONS,
  ORDER_STAGES,
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

export const factoryInput = z.object({
  name: text(200, "Enter the factory's name"),
  contactPerson: optionalText(120),
  phone,
  wechat: optionalText(80),
  email,
  address: optionalText(500),
  defaultVatRate: percentOr(13),
  pricesIncludeVat: bool.default(true),
  bankDetails: optionalText(1000),
  notes: optionalText(5000),
});
export type FactoryInput = z.infer<typeof factoryInput>;

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

/* ---------------------------------------------------------------- sourcing */

export const factoryQuoteLineInput = z.object({
  id: optionalId,
  requestedItemId: optionalId,
  description: text(2000, "Each line needs a description"),
  model: optionalText(120),
  quantity,
  unit: z.string().trim().max(20).default("pcs"),
  unitPrice: amount("Enter the factory's price"),
  vatRate: percentOr(13),
  rebateRate: percentOr(0),
});

export const factoryQuoteInput = z
  .object({
    /** An existing factory, or a new one by name. */
    factoryId: optionalId,
    newFactoryName: optionalText(200),
    reference: optionalText(80),
    receivedOn: isoDate(),
    validUntil: optionalDate,
    currency: currency.default("CNY"),
    pricesIncludeVat: bool.default(true),
    priceBasis: optionalText(60),
    leadTime: optionalText(120),
    moq: optionalText(60),
    paymentTerms: optionalText(2000),
    notes: optionalText(5000),
    lines: z.array(factoryQuoteLineInput).min(1, "Add at least one price").max(300),
  })
  .refine((v) => v.factoryId || v.newFactoryName, { message: "Choose a factory or type a new one", path: ["factoryId"] });
export type FactoryQuoteInput = z.infer<typeof factoryQuoteInput>;

/** Which factory price each requested item is quoted from by default ({ itemId: lineId | null }). */
export const preferredLinesInput = z.object({ choices: z.record(z.uuid(), z.uuid().nullable()) });

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
  to: z.enum(REVISION_STATUSES).exclude(["draft", "superseded", "void"]),
  /** The day it was sent or answered; today when empty. */
  on: optionalDate,
});

/* ---------------------------------------------------------------- orders */

/** Move an order one stage forward or back. When the move has warnings, send it again with confirm: true. */
export const moveStageInput = z.object({
  to: z.enum(ORDER_STAGES),
  /** Going ahead although there is a warning (no deposit, money still due). */
  confirm: bool.default(false),
  note: optionalText(2000),
  /** In production: when the factory expects the goods ready. */
  readyOn: optionalDate,
  /** Shipped: the ship date (today when empty) and the B/L number. */
  shippedOn: optionalDate,
  blNo: optionalText(60),
});
export type MoveStageInput = z.infer<typeof moveStageInput>;

/** The order's dates and B/L, editable at any time. Only the fields sent change (empty clears one). */
export const orderDetailsInput = z.object({ shipBy: optionalDate.optional(), readyOn: optionalDate.optional(), shippedOn: optionalDate.optional(), blNo: optionalText(60).optional() });
export type OrderDetailsInput = z.infer<typeof orderDetailsInput>;

/** How many of each goods line came in from the factory (the total so far, not an addition). */
export const receiptInput = z.object({
  on: optionalDate,
  lines: z
    .array(
      z.object({
        lineId: id("Each line must come from the order"),
        receivedQty: z.preprocess((v) => (v === "" || v === null ? 0 : v), z.coerce.number().min(0, "Cannot be negative").max(10_000_000).refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Use at most 2 decimals")),
      }),
    )
    .min(1)
    .max(300),
});
export type ReceiptInput = z.infer<typeof receiptInput>;

const measure = (max: number) => z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().min(0, "Cannot be negative").max(max).nullable());

/** The packing list: per goods line the packages, weights and volume; for the order the container and shipping marks. */
export const packingInput = z.object({
  containerNo: optionalText(120),
  shippingMarks: optionalText(2000),
  lines: z
    .array(
      z.object({
        lineId: id("Each line must come from the order"),
        packages: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int("Whole packages only").min(0).max(1_000_000).nullable()),
        packageType: z.string().trim().max(40).default("Carton").transform((v) => v || "Carton"),
        netWeightKg: measure(10_000_000),
        grossWeightKg: measure(10_000_000),
        cbm: measure(100_000),
      }),
    )
    .min(1)
    .max(300),
});
export type PackingInput = z.infer<typeof packingInput>;

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
  note: optionalText(2000),
});
export type PaymentInput = z.infer<typeof paymentInput>;

export const voidPaymentInput = z.object({ reason: text(2000, "Say why this payment is being removed") });
