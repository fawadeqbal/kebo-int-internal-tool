import type {
  BankContractStatus,
  BankStepKind,
  ClaimStatus,
  DeliveryCondition,
  LineCondition,
  FactoryRequestStatus,
  OrderDocumentKind,
  OrderDocumentStatus,
  OrderStage,
  PaymentRoute,
  SatResult,
  ShipMode,
  ShipmentStatus,
} from "../enums";
import type { Tone } from "../labels";
import type { PlanFeature } from "../platform";

/**
 * The order flow after the customer accepts, as one line of steps:
 *
 *   Payment → Factory order → Production → Shipping → Documents & bank → Delivery & SAT
 *
 * Each step belongs to a module the platform admin can switch off for a company
 * ("less management"); a switched-off step is left out, never blocking. Nothing
 * here touches the database: the API, the web and the phone app share it.
 */

export const PAYMENT_ROUTE_LABEL: Record<PaymentRoute, string> = {
  informal: "Informal (cash, Alipay, WeChat, personal account)",
  bank_contract: "Bank contract",
  letter_of_credit: "Letter of credit (LC)",
};
export const PAYMENT_ROUTE_SHORT: Record<PaymentRoute, string> = { informal: "Informal", bank_contract: "Bank contract", letter_of_credit: "LC" };

export const BANK_CONTRACT_STATUS_LABEL: Record<BankContractStatus, string> = {
  draft: "Draft",
  opened: "Opened",
  amended: "Amended",
  documents_presented: "Documents presented",
  paid: "Paid",
  closed: "Closed",
};
export const BANK_CONTRACT_STATUS_TONE: Record<BankContractStatus, Tone> = {
  draft: "neutral",
  opened: "info",
  amended: "warn",
  documents_presented: "info",
  paid: "ok",
  closed: "neutral",
};

export const FACTORY_REQUEST_STATUS_LABEL: Record<FactoryRequestStatus, string> = { sent: "Asked", quoted: "Quoted", declined: "Declined", no_reply: "No reply" };
export const FACTORY_REQUEST_STATUS_TONE: Record<FactoryRequestStatus, Tone> = { sent: "info", quoted: "ok", declined: "neutral", no_reply: "warn" };

/** How a factory was asked for a price. */
export const REQUEST_CHANNELS = ["wechat", "email", "whatsapp", "phone", "visit", "other"] as const;
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];
export const REQUEST_CHANNEL_LABEL: Record<RequestChannel, string> = { wechat: "WeChat", email: "Email", whatsapp: "WhatsApp", phone: "Phone", visit: "Visit", other: "Other" };

export const SHIP_MODE_LABEL: Record<ShipMode, string> = { sea: "Sea", air: "Air", road: "Road", rail: "Rail" };
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  planned: "Planned",
  booked: "Booked",
  loaded: "Loaded",
  departed: "On the way",
  arrived: "Arrived",
  cleared: "Cleared customs",
};
export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, Tone> = { planned: "neutral", booked: "info", loaded: "info", departed: "info", arrived: "ok", cleared: "ok" };

export const ORDER_DOCUMENT_LABEL: Record<OrderDocumentKind, string> = {
  bill_of_lading: "Bill of lading (B/L)",
  airway_bill: "Air waybill (AWB)",
  packing_list: "Packing list",
  commercial_invoice: "Commercial invoice",
  proforma_invoice: "Proforma invoice",
  sales_contract: "Sales contract",
  certificate_of_origin: "Certificate of origin (FTA)",
  insurance: "Insurance certificate",
  inspection: "Inspection certificate",
  other: "Other document",
};
export const ORDER_DOCUMENT_STATUS_LABEL: Record<OrderDocumentStatus, string> = { missing: "Missing", draft: "Draft", ready: "Ready" };
export const ORDER_DOCUMENT_STATUS_TONE: Record<OrderDocumentStatus, Tone> = { missing: "warn", draft: "info", ready: "ok" };

export const BANK_STEP_LABEL: Record<BankStepKind, string> = {
  sent_to_our_bank: "Documents handed to our bank",
  couriered_to_customer_bank: "Couriered to the customer's bank",
  copies_to_customer: "Copies sent to the customer",
  customer_paid_bank: "Customer paid their bank",
  bank_paid_us: "Money reached us",
};

export const DELIVERY_CONDITION_LABEL: Record<DeliveryCondition, string> = { good: "Good", minor_damage: "Minor damage", damaged: "Damaged", partial: "Partly delivered" };
export const DELIVERY_CONDITION_TONE: Record<DeliveryCondition, Tone> = { good: "ok", minor_damage: "warn", damaged: "bad", partial: "warn" };
export const LINE_CONDITION_LABEL: Record<LineCondition, string> = { good: "Good", minor_damage: "Minor damage", damaged: "Damaged", missing: "Missing" };
export const LINE_CONDITION_TONE: Record<LineCondition, Tone> = { good: "ok", minor_damage: "warn", damaged: "bad", missing: "bad" };

export const SAT_RESULT_LABEL: Record<SatResult, string> = { pending: "Not checked", pass: "Pass", fail: "Fail", not_applicable: "N/A" };
export const SAT_RESULT_TONE: Record<SatResult, Tone> = { pending: "neutral", pass: "ok", fail: "bad", not_applicable: "neutral" };

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = { open: "Open", with_factory: "With the factory", resolved: "Resolved", rejected: "Rejected" };
export const CLAIM_STATUS_TONE: Record<ClaimStatus, Tone> = { open: "bad", with_factory: "warn", resolved: "ok", rejected: "neutral" };

/** What a site acceptance test usually checks; a new order's SAT list starts from these. */
export const DEFAULT_SAT_CHECKS = [
  "Machine and parts match the packing list",
  "No transport damage",
  "Installed and levelled",
  "Power, air and water connected",
  "Test run at rated speed",
  "Output quality accepted by the customer",
  "Operators trained",
  "Manuals and spare parts handed over",
] as const;

/** A usual production timeline; a new order's timeline can start from these. */
export const DEFAULT_PRODUCTION_STEPS = ["Drawings approved", "Materials and parts in", "Machining and assembly", "Factory test run (FAT)", "Packed and ready"] as const;

const isBank = (route: PaymentRoute | null) => route === "bank_contract" || route === "letter_of_credit";

/** The papers the shipment needs, by how the customer pays and how it ships. */
export function requiredDocuments(route: PaymentRoute | null, mode: ShipMode | null = "sea"): OrderDocumentKind[] {
  const transport: OrderDocumentKind = mode === "air" ? "airway_bill" : "bill_of_lading";
  const base: OrderDocumentKind[] = [transport, "packing_list", "commercial_invoice", "certificate_of_origin"];
  if (!isBank(route)) return base;
  const bank: OrderDocumentKind[] = [...base, "proforma_invoice", "sales_contract"];
  return route === "letter_of_credit" ? [...bank, "insurance"] : bank;
}

/** The documents' trip: through both banks on a bank contract or LC; straight to the customer otherwise. */
export function bankStepsFor(route: PaymentRoute | null): BankStepKind[] {
  return isBank(route) ? ["sent_to_our_bank", "couriered_to_customer_bank", "copies_to_customer", "customer_paid_bank", "bank_paid_us"] : ["copies_to_customer"];
}

export const FLOW_STEPS = ["payment", "factory", "production", "shipping", "documents", "delivery"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export const FLOW_STEP_LABEL: Record<FlowStep, string> = {
  payment: "Payment",
  factory: "Factory order",
  production: "Production",
  shipping: "Shipping",
  documents: "Documents & bank",
  delivery: "Delivery & SAT",
};

/** The module each step belongs to; with it switched off the step is left out. Payment and the factory order are always there. */
export const FLOW_STEP_FEATURE: Partial<Record<FlowStep, PlanFeature>> = {
  production: "production",
  shipping: "shipping",
  documents: "bank_documents",
  delivery: "delivery_sat",
};

export type FlowState = "done" | "current" | "todo" | "off";

export interface FlowFacts {
  stage: OrderStage;
  cancelled: boolean;
  route: PaymentRoute | null;
  /** The deposit (or everything, with no deposit) has come in. */
  depositIn: boolean;
  factoryOrderedOn: string | null;
  production: { total: number; done: number };
  readyOn: string | null;
  shipments: { total: number; departed: number; arrived: number };
  documents: { required: number; ready: number };
  bankSteps: { required: number; done: number };
  deliveredOn: string | null;
  sat: { total: number; passed: number; failed: number; doneOn: string | null };
  openClaims: number;
}

export interface FlowStepView {
  key: FlowStep;
  label: string;
  state: FlowState;
  /** One short line: what is done or what it waits for. */
  sub: string;
}

const after = (stage: OrderStage, than: OrderStage) => ["confirmed", "in_production", "shipped", "done"].indexOf(stage) > ["confirmed", "in_production", "shipped", "done"].indexOf(than);

/**
 * The steps with their state. The first step not done is the current one; a
 * module switched off (features without it) shows as "off" and is skipped.
 * `features` null means every module (no plan limits).
 */
export function flowSteps(f: FlowFacts, features: readonly string[] | null): FlowStepView[] {
  const on = (s: FlowStep) => {
    const feature = FLOW_STEP_FEATURE[s];
    return !feature || !features || features.includes(feature);
  };
  const shippedStage = f.stage === "shipped" || f.stage === "done";
  const done: Record<FlowStep, boolean> = {
    // The route is asked for, never a gate: an order paid (or past Confirmed) has its payment step done.
    payment: f.depositIn || after(f.stage, "confirmed"),
    factory: f.factoryOrderedOn !== null || after(f.stage, "confirmed"),
    production: (f.production.total > 0 && f.production.done === f.production.total) || shippedStage,
    shipping: f.shipments.total > 0 ? f.shipments.arrived === f.shipments.total : f.stage === "done",
    documents: f.documents.required > 0 && f.documents.ready >= f.documents.required && f.bankSteps.done >= f.bankSteps.required,
    delivery: f.deliveredOn !== null && f.sat.doneOn !== null && f.openClaims === 0,
  };
  const sub: Record<FlowStep, string> = {
    payment: f.depositIn ? (f.route === null ? "Deposit received · route not chosen" : "Deposit received") : f.route === null ? "Choose how the customer pays" : "Waiting for the deposit",
    factory: f.factoryOrderedOn ? `Ordered ${f.factoryOrderedOn}` : "Place the order with the factory",
    production: f.production.total ? `${f.production.done} of ${f.production.total} steps` : f.readyOn ? `Ready ${f.readyOn}` : "No timeline yet",
    shipping: f.shipments.total
      ? f.shipments.arrived === f.shipments.total
        ? "Arrived"
        : f.shipments.departed
          ? "On the way"
          : "Booked, not left yet"
      : shippedStage
        ? "Shipped"
        : "Not booked yet",
    documents: `${f.documents.ready} of ${f.documents.required} papers · ${f.bankSteps.done} of ${f.bankSteps.required} bank steps`,
    delivery: f.openClaims
      ? `${f.openClaims} open claim${f.openClaims === 1 ? "" : "s"}`
      : f.sat.doneOn
        ? "SAT signed off"
        : f.deliveredOn
          ? f.sat.total
            ? `SAT ${f.sat.passed} of ${f.sat.total} passed`
            : "Delivered, SAT to do"
          : "Not delivered yet",
  };
  let current = false;
  return FLOW_STEPS.map((key) => {
    let state: FlowState;
    if (!on(key)) state = "off";
    else if (done[key]) state = "done";
    else if (!current && !f.cancelled) {
      state = "current";
      current = true;
    } else state = "todo";
    return { key, label: FLOW_STEP_LABEL[key], state, sub: sub[key] };
  });
}
