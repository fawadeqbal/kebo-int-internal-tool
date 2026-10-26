import type {
  AttachmentKind,
  BalanceTerms,
  CustomerType,
  InquiryChannel,
  InquiryStage,
  LineType,
  LostReason,
  OrderStage,
  PaymentKind,
  PaymentMethod,
  Priority,
  RevisionStatus,
  Role,
} from "./enums";

/** The words people see, in one place, so anything can be renamed without touching logic. */

export const ROLE_LABEL: Record<Role, string> = { admin: "Super Admin", manager: "Manager", staff: "Staff" };

export const INQUIRY_STAGE_LABEL: Record<InquiryStage, string> = {
  new: "New",
  sourcing: "Sourcing",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

/** One line under each stage: whose turn it is. */
export const CHANNEL_LABEL: Record<InquiryChannel, string> = {
  website: "Website form",
  whatsapp: "WhatsApp",
  wechat: "WeChat",
  email: "Email",
  phone: "Phone",
  visit: "Visit / trade fair",
  other: "Other",
};

export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price_too_high: "Price too high",
  no_reply: "No reply from customer",
  factory_cannot_supply: "Factory can't make it or meet the date",
  bought_elsewhere: "Customer bought elsewhere",
  customer_cancelled: "Customer cancelled",
  duplicate_or_spam: "Duplicate or spam",
  other: "Other",
};

/** Country "ZZ" means not known yet (e.g. a website inquiry): the screens ask for it. */
export const UNKNOWN_COUNTRY = "ZZ";

export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = { company: "Company", individual: "Individual" };

export const REVISION_STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Replaced by a newer revision",
  void: "Order cancelled",
};

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = { urs: "URS", drawing: "Drawing", photo: "Photo", specification: "Specification", other: "Other" };

export const LINE_TYPE_LABEL: Record<LineType, string> = { goods: "Goods", service: "Service", charge: "Charge (freight, fees)" };

export const BALANCE_TERMS_LABEL: Record<BalanceTerms, string> = {
  before_shipment: "Balance before shipment",
  against_bl_copy: "Balance against B/L copy",
  after_arrival: "Balance after arrival",
  letter_of_credit: "Letter of credit",
};

export const ORDER_STAGE_LABEL: Record<OrderStage, string> = {
  confirmed: "Confirmed",
  in_production: "In production",
  shipped: "Shipped",
  done: "Done",
};

/** One line under each stage: what the order is waiting for. */
export const ORDER_STAGE_HINT: Record<OrderStage, string> = {
  confirmed: "The customer accepted. Waiting for the deposit.",
  in_production: "The deposit came in and the factory is making the goods.",
  shipped: "The goods are on their way. Waiting for the balance.",
  done: "Fully paid and delivered.",
};

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = { deposit: "Deposit", balance: "Balance", other: "Other" };

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer (T/T)",
  letter_of_credit: "Letter of credit (L/C)",
  cash: "Cash",
  cheque: "Cheque",
  online: "Online payment",
  other: "Other",
};

/** Badge colours by meaning; the UI maps tones to its palette. Colour is never the only signal. */
export type Tone = "neutral" | "info" | "ok" | "warn" | "bad";

export const INQUIRY_STAGE_TONE: Record<InquiryStage, Tone> = { new: "warn", sourcing: "info", quoted: "info", won: "ok", lost: "neutral" };

export const REVISION_STATUS_TONE: Record<RevisionStatus, Tone> = {
  draft: "neutral",
  sent: "info",
  accepted: "ok",
  rejected: "bad",
  expired: "warn",
  superseded: "neutral",
  void: "neutral",
};

export const ORDER_STAGE_TONE: Record<OrderStage, Tone> = {
  confirmed: "warn",
  in_production: "info",
  shipped: "info",
  done: "ok",
};

export const PRIORITY_TONE: Record<Priority, Tone> = { low: "neutral", normal: "neutral", high: "warn", urgent: "bad" };
