import { z } from "zod";
import {
  ATTACHMENT_KINDS,
  BALANCE_TERMS,
  CUSTOMER_TYPES,
  EXPENSE_CATEGORIES,
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
} from "../enums";
import { amount, bool, currency, email, id, isoDate, listQuery, amountOr, optionalAmount, optionalDate, optionalId, optionalRate, optionalText, percentOr, phone, quantity, text } from "./common";
import { DEFAULT_TAX_RATE } from "../workflows/tax";

/**
 * Why a change was made. Optional in the schema: the API asks for it (409
 * "reason_needed") only where a change affects others (see workflows/reasons).
 */
export const reasonField = optionalText(500).optional();

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
  regNo: optionalText(60),
  defaultCurrency: currency.default("USD"),
  notes: optionalText(5000),
  contacts: z.array(contactInput).min(1, "Add at least one contact").max(20),
  reason: reasonField,
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
  bankDetails: optionalText(1000),
  notes: optionalText(5000),
  /** The person in our team who looks after this factory. */
  ownerId: optionalId,
  reason: reasonField,
});
export type FactoryInput = z.infer<typeof factoryInput>;

/* ---------------------------------------------------------------- inquiries */

export const requestedItemInput = z.object({
  id: optionalId,
  /** A part of another item: that item's id (saved items), or its position in `items` (0-based, for new ones). */
  parentId: optionalId,
  partOf: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(0).nullable()).default(null),
  description: text(2000, "Each item needs a description"),
  model: optionalText(120),
  quantity,
  unit: z.string().trim().max(20).default("pcs"),
  targetPrice: optionalAmount,
});

export const inquiryInput = z
  .object({
  customerId: id("Choose a customer"),
  contactId: optionalId,
  channel: z.enum(INQUIRY_CHANNELS).default("email"),
  category: text(120, "Choose a category"),
  title: optionalText(200),
  requirements: optionalText(20000),
  priority: z.enum(PRIORITIES).default("normal"),
  requiredBy: optionalDate,
  assigneeId: optionalId,
  /** Optional: often the customer sends only a requirement or a URS; the lines are made at factory prices. */
  items: z.array(requestedItemInput).max(1000).default([]),
  reason: reasonField,
})
  .refine((v) => v.items.length > 0 || !!v.requirements, {
    message: "Write what the customer needs, or add their list of items",
    path: ["requirements"],
  });
export type InquiryInput = z.infer<typeof inquiryInput>;

export const stageMoveInput = z
  .object({
    to: z.enum(INQUIRY_STAGES),
    lostReason: z.enum(LOST_REASONS).nullish(),
    note: optionalText(2000),
    reason: reasonField,
  })
  .refine((v) => v.to !== "lost" || !!v.lostReason, { message: "Choose why the deal was lost", path: ["lostReason"] });
export type StageMoveInput = z.infer<typeof stageMoveInput>;

export const holdInput = z.object({ onHold: bool, note: optionalText(2000), reason: reasonField });
export const assignInput = z.object({ assigneeId: optionalId, reason: reasonField });

/** Split an item into parts (at factory pricing): each part is an item of its own, numbered under it (3.1, 3.2). */
export const splitItemInput = z.object({
  parts: z
    .array(z.object({ description: text(2000, "Each part needs a description"), model: optionalText(120), quantity, unit: z.string().trim().max(20).default("pcs") }))
    .min(1, "Add at least one part")
    .max(50),
  reason: reasonField,
});
export type SplitItemInput = z.infer<typeof splitItemInput>;

/** A file's type and note (URS & Documents). */
export const attachmentInput = z.object({
  kind: z.enum(ATTACHMENT_KINDS).default("other"),
  note: optionalText(300),
  /** Evidence for a factory offer (only people who see factory prices see it). */
  factoryQuoteId: optionalId,
});
export type AttachmentInput = z.infer<typeof attachmentInput>;
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
  /** Which of the customer's items this answers (empty for extras the factory added). */
  requestedItemId: optionalId,
  /** A part of an earlier line of this offer: that line's position in `lines` (0-based). */
  partOf: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(0).nullable()).default(null),
  description: text(2000, "Each line needs a description"),
  model: optionalText(120),
  quantity,
  unit: z.string().trim().max(20).default("pcs"),
  unitPrice: amount("Enter the factory's price (without tax)"),
  /** Tax % added on top of this item's price. */
  taxRate: percentOr(DEFAULT_TAX_RATE),
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
    priceBasis: optionalText(60),
    leadTime: optionalText(120),
    moq: optionalText(60),
    paymentTerms: optionalText(2000),
    notes: optionalText(5000),
    /** Left out: the lines are not touched (they are added one by one, see factoryLinesInput). */
    lines: z.array(factoryQuoteLineInput).max(1000).optional(),
    reason: reasonField,
  })
  .refine((v) => v.factoryId || v.newFactoryName, { message: "Choose a factory or type a new one", path: ["factoryId"] });
export type FactoryQuoteInput = z.infer<typeof factoryQuoteInput>;

/**
 * Lines added to an offer as they are typed or pasted: after a line (or at the
 * end), at the same level as that line or as parts of `parentId`.
 */
export const factoryLinesInput = z.object({
  lines: z.array(factoryQuoteLineInput.omit({ id: true })).min(1, "Add a line").max(1000),
  /** Insert after this line (and its parts); empty = at the end. */
  afterId: optionalId,
  /** All new lines become parts of this line (pasting under a line). */
  parentId: optionalId,
  reason: reasonField,
});
export type FactoryLinesInput = z.infer<typeof factoryLinesInput>;

/** One line changed in place (only the fields sent). */
export const factoryLinePatch = z.object({
  requestedItemId: optionalId.optional(),
  description: text(2000, "Each line needs a description").optional(),
  model: optionalText(120).optional(),
  quantity: quantity.optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  unitPrice: amount("Enter the factory's price (without tax)").optional(),
  taxRate: percentOr(DEFAULT_TAX_RATE).optional(),
  reason: reasonField,
});
export type FactoryLinePatch = z.infer<typeof factoryLinePatch>;

/** Up / down among its neighbours, into the line above as a part, or out to a line of its own. */
export const lineMoveInput = z.object({ to: z.enum(["up", "down", "indent", "outdent"]), reason: reasonField });
export type LineMoveInput = z.infer<typeof lineMoveInput>;

/** Start an offer from another factory's lines (same products, this factory's models and prices). */
export const copyLinesInput = z.object({ fromQuoteId: id("Choose the offer to copy"), withPrices: bool.default(false) });
export type CopyLinesInput = z.infer<typeof copyLinesInput>;


/* ---------------------------------------------------------------- quotations */

/** Our selling price for one line of an option: a factory line, or (without factory prices) one of the customer's items. */
export const optionPriceInput = z.object({ lineId: id("Unknown line"), unitPrice: amount("Enter a price") });

/** An extra the factory does not supply: sea freight, inspection, insurance… (our own price and, if known, cost). */
export const chargeInput = z.object({
  type: z.enum(LINE_TYPES).exclude(["goods"]).default("charge"),
  description: text(2000, "Each charge needs a description"),
  quantity,
  unit: z.string().trim().max(20).default("lot"),
  unitPrice: amount("Enter a price"),
  unitCost: optionalAmount,
});

/**
 * One option (A, B…): one factory's offer — its lines exactly as the factory
 * gave them, locked — with our prices, discount and lead time, plus charges.
 * Without factory prices (factoryQuoteId empty) the lines are the customer's items.
 */
export const optionInput = z.object({
  factoryQuoteId: optionalId,
  prices: z.array(optionPriceInput).max(300),
  charges: z.array(chargeInput).max(20).default([]),
  discount: amountOr(0),
  leadTime: optionalText(120),
});
export type OptionInput = z.infer<typeof optionInput>;

export const revisionInput = z.object({
  currency: currency.default("USD"),
  incoterm: z.enum(INCOTERMS).default("FOB"),
  incotermPlace: optionalText(80),
  depositPercent: percentOr(30),
  balanceTerms: z.enum(BALANCE_TERMS).default("before_shipment"),
  validUntil: isoDate(),
  terms: optionalText(5000),
  notes: optionalText(5000),
  /** Options A, B… in this order; the customer accepts exactly one. */
  options: z.array(optionInput).min(1, "Add at least one option").max(6, "Use at most 6 options"),
  reason: reasonField,
});
export type RevisionInput = z.infer<typeof revisionInput>;

export const revisionMoveInput = z.object({
  to: z.enum(REVISION_STATUSES).exclude(["draft", "superseded", "void"]),
  /** Accepted: the option the customer chose (needed when there is more than one). */
  optionId: optionalId,
  /** The day it was sent or answered; today when empty. */
  on: optionalDate,
  reason: reasonField,
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
  reason: reasonField,
});
export type MoveStageInput = z.infer<typeof moveStageInput>;

/** The order's dates and B/L, editable at any time. Only the fields sent change (empty clears one). */
export const orderDetailsInput = z.object({
  shipBy: optionalDate.optional(),
  readyOn: optionalDate.optional(),
  shippedOn: optionalDate.optional(),
  blNo: optionalText(60).optional(),
  /** Heading over the lines on the proforma / invoice / packing list. */
  documentTitle: optionalText(200).optional(),
  portOfDischarge: optionalText(120).optional(),
  reason: reasonField,
});
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

/** Changing a recorded payment says why (asked with code "reason_needed"; kept in the order's history). */
export const editPaymentInput = paymentInput.extend({ reason: optionalText(500).optional() });
export type EditPaymentInput = z.infer<typeof editPaymentInput>;

/* ---------------------------------------------------------------- payment plan */

/**
 * The customer's instalments for an order (deposit, balance, or more). They must
 * add up to the order total; a due date is optional ("before shipment" has none
 * until the ship date is known).
 */
export const paymentPlanInput = z.object({
  items: z
    .array(
      z.object({
        id: optionalId,
        label: text(80, "Name each instalment, e.g. Deposit"),
        amount: amount().refine((v) => (v as number) > 0, "Each instalment must be more than 0"),
        dueOn: optionalDate,
      }),
    )
    .min(1, "Add at least one instalment")
    .max(12, "Use at most 12 instalments"),
  reason: optionalText(500).optional(),
});
export type PaymentPlanInput = z.infer<typeof paymentPlanInput>;

/* ---------------------------------------------------------------- factory payments */

/**
 * Money we sent a factory for an order, in the currency we paid in. `rate` is
 * how many of that currency make one unit of the order's currency (CNY 7.10
 * per USD), so profit can be worked out; it starts from Settings.
 */
export const factoryPaymentInput = z.object({
  factoryId: id("Choose the factory"),
  kind: z.enum(PAYMENT_KINDS).default("deposit"),
  amount: amount().refine((v) => (v as number) > 0, "The amount must be more than 0"),
  currency,
  rate: optionalRate,
  paidOn: isoDate(),
  method: z.enum(PAYMENT_METHODS).default("bank_transfer"),
  /** Who in our team paid it (defaults to the person who looks after the factory). */
  paidById: optionalId,
  reference: optionalText(120),
  note: optionalText(2000),
  reason: optionalText(500).optional(),
});
export type FactoryPaymentInput = z.infer<typeof factoryPaymentInput>;

/* ---------------------------------------------------------------- expenses */

/**
 * A cost: for one order (freight, inspection…) or for the company (rent,
 * salaries…). `rate` turns it into the main currency (units of its currency per
 * one main-currency unit); it starts from Settings.
 */
export const expenseInput = z.object({
  orderId: optionalId,
  category: z.enum(EXPENSE_CATEGORIES),
  description: text(200, "Say what it was for"),
  amount: amount().refine((v) => (v as number) > 0, "The amount must be more than 0"),
  currency,
  rate: optionalRate,
  spentOn: isoDate(),
  paidById: optionalId,
  reference: optionalText(120),
  note: optionalText(2000),
  reason: optionalText(500).optional(),
});
export type ExpenseInput = z.infer<typeof expenseInput>;

export const voidInput = z.object({ reason: text(500, "Say why it is removed") });
