/**
 * Every status and choice in the system, as constant lists. The Prisma schema
 * declares the same values (a test in @kebo/database checks they match), so
 * the web can use these without importing the database client.
 */
const values = <const T extends readonly string[]>(...v: T) => v;

/** The built-in roles (more can be made in Security). Their key never changes; the name can. */
export const PRESET_ROLE_KEYS = values("admin", "manager", "staff");
export type PresetRoleKey = (typeof PRESET_ROLE_KEYS)[number];
/** A role's key: a preset, or one made in Security ("accounts", "sales-china"). */
export type Role = string;

/* ---------------------------------------------------------------- money */

/** The currencies the business works in. Everything with a currency is chosen from these. */
export const CURRENCIES = values("USD", "CNY", "PKR");
export type Currency = (typeof CURRENCIES)[number];

/* ---------------------------------------------------------------- sign-in */

/** What happened at one sign-in attempt (the sign-in history). */
export const SIGN_IN_RESULTS = values(
  "signed_in",
  "code_needed",
  "wrong_password",
  "unknown_email",
  "wrong_code",
  "locked",
  "switched_off",
  "too_many",
);
export type SignInResult = (typeof SIGN_IN_RESULTS)[number];

/* ---------------------------------------------------------------- inquiries */

/** How far a deal has got. Most moves happen by themselves (see workflows/inquiry). */
export const INQUIRY_STAGES = values("new", "sourcing", "quoted", "won", "lost");
export type InquiryStage = (typeof INQUIRY_STAGES)[number];

export const INQUIRY_CHANNELS = values("website", "whatsapp", "wechat", "email", "phone", "visit", "other");
export type InquiryChannel = (typeof INQUIRY_CHANNELS)[number];

export const PRIORITIES = values("low", "normal", "high", "urgent");
export type Priority = (typeof PRIORITIES)[number];

/** Why a deal closed without an order: a fixed list, so reports can count them. */
export const LOST_REASONS = values(
  "price_too_high",
  "no_reply",
  "factory_cannot_supply",
  "bought_elsewhere",
  "customer_cancelled",
  "duplicate_or_spam",
  "other",
);
export type LostReason = (typeof LOST_REASONS)[number];

/* ---------------------------------------------------------------- parties */

export const CUSTOMER_TYPES = values("company", "individual");
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/* ---------------------------------------------------------------- quotations */

/** Status of one revision (R1, R2…) of a quotation. */
/** "void": accepted, but the order made from it was later cancelled (the deal can be reopened and quoted again). */
export const REVISION_STATUSES = values("draft", "sent", "accepted", "rejected", "expired", "superseded", "void");
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** Goods are shipped (packing list, inspection); services and charges are not. */
export const LINE_TYPES = values("goods", "service", "charge");
export type LineType = (typeof LINE_TYPES)[number];

/** What a file on a deal is: the customer's URS (user requirement specification), a drawing, a photo… */
export const ATTACHMENT_KINDS = values("urs", "drawing", "photo", "specification", "factory_quote", "other");
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const INCOTERMS = values("EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP");
export type Incoterm = (typeof INCOTERMS)[number];

/** When the balance after the deposit is due. */
export const BALANCE_TERMS = values("before_shipment", "against_bl_copy", "after_arrival", "letter_of_credit");
export type BalanceTerms = (typeof BALANCE_TERMS)[number];

/* ---------------------------------------------------------------- orders */

export const ORDER_STATUSES = values("open", "closed", "cancelled");
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** An order moves through four stages, one button at a time (cancelled is its status, not a stage). */
export const ORDER_STAGES = values("confirmed", "in_production", "shipped", "done");
export type OrderStage = (typeof ORDER_STAGES)[number];

/* ---------------------------------------------------------------- money */

export const PAYMENT_KINDS = values("deposit", "balance", "other");
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** Where money is kept: an office cash box, a bank account, a wallet (Alipay, JazzCash…). */
export const MONEY_ACCOUNT_KINDS = values("cash", "bank", "wallet");
export type MoneyAccountKind = (typeof MONEY_ACCOUNT_KINDS)[number];

export const PAYMENT_METHODS = values("bank_transfer", "letter_of_credit", "cash", "cheque", "online", "other");
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What a cost was for. Order expenses belong to one order; general ones to the company (rent, salaries…). */
export const EXPENSE_CATEGORIES = values(
  "travel",
  "hotel",
  "meals",
  "gifts",
  "samples",
  "freight",
  "inland_transport",
  "inspection",
  "customs",
  "bank_charges",
  "commission",
  "rent",
  "salaries",
  "utilities",
  "office",
  "other",
);
/**
 * Expenses that pay for the costs planned to reach the basis we sell on (to the
 * port, sea freight, delivery, duties): on an order, they are part of its
 * planned costs up to those, and only beyond them a cost of their own.
 */
export const BASIS_COST_CATEGORIES: readonly ExpenseCategory[] = ["freight", "inland_transport", "customs"];
/** The company's running costs, the same every month whoever the customers are. */
export const RUNNING_COST_CATEGORIES: readonly ExpenseCategory[] = ["rent", "salaries", "utilities", "office"];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** The costs between a factory's price and ours (see workflows/basis). */
export const BASIS_STEPS = values("to_port", "freight", "insurance", "delivery", "duties");
export type BasisStep = (typeof BASIS_STEPS)[number];

export const ENUMS = {
  SignInResult: SIGN_IN_RESULTS,
  InquiryStage: INQUIRY_STAGES,
  InquiryChannel: INQUIRY_CHANNELS,
  Priority: PRIORITIES,
  LostReason: LOST_REASONS,
  CustomerType: CUSTOMER_TYPES,
  RevisionStatus: REVISION_STATUSES,
  LineType: LINE_TYPES,
  Incoterm: INCOTERMS,
  BasisStep: BASIS_STEPS,
  BalanceTerms: BALANCE_TERMS,
  OrderStatus: ORDER_STATUSES,
  OrderStage: ORDER_STAGES,
  PaymentKind: PAYMENT_KINDS,
  PaymentMethod: PAYMENT_METHODS,
} as const;
