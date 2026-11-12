import { numberToWords } from "@kebo/utils";
import type { OrderDocumentKind, PaymentRoute, ShipMode } from "../enums";
import type { Tone } from "../labels";
import type { PlanFeature } from "../platform";
import { requiredDocuments, type FlowStep } from "./flow";

/**
 * Order flow v3, papers: every paper the app makes from the order, in the one
 * document template (KeboDoc), with its lines from the order's lines.
 *
 * - Made papers (sales contract, commercial invoice, …) are a draft until made
 *   final: final keeps a snapshot of exactly what was printed, locks the number
 *   and ticks the checklist; "Make again" starts version 2 and keeps version 1.
 * - The customer statement is live: printed from the data whenever opened.
 * - Payment requests and receipts are kept as sent: a request is kept exactly
 *   as printed when it is sent (sent again: R2, the first one stays), a receipt
 *   when its payment is recorded. No draft and no Make page.
 * - The proforma and the packing list are the order's own documents and work
 *   as before; papers others issue (B/L, certificate of origin…) are uploaded
 *   or marked "kept elsewhere".
 *
 * Nothing here touches the database: the API, the web and the phone app share it.
 */

export const PAPER_KINDS = [
  "sales-contract",
  "payment-request",
  "payment-receipt",
  "customer-statement",
  "purchase-order",
  "fat-report",
  "inspection-report",
  "commercial-invoice",
  "shipping-advice",
  "bill-of-exchange",
  "beneficiary-certificate",
  "bank-cover-letter",
  "delivery-note",
  "sat-certificate",
] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];

export const isPaperKind = (k: string): k is PaperKind => (PAPER_KINDS as readonly string[]).includes(k);

export const PAPER_LABEL: Record<PaperKind, string> = {
  "sales-contract": "Sales contract",
  "payment-request": "Payment request",
  "payment-receipt": "Payment receipt",
  "customer-statement": "Customer statement",
  "purchase-order": "Purchase order to the factory",
  "fat-report": "FAT report",
  "inspection-report": "Inspection report",
  "commercial-invoice": "Commercial invoice",
  "shipping-advice": "Shipping advice",
  "bill-of-exchange": "Bill of exchange (draft)",
  "beneficiary-certificate": "Beneficiary certificate",
  "bank-cover-letter": "Cover letter to our bank",
  "delivery-note": "Delivery / handover note",
  "sat-certificate": "SAT certificate",
};

/** The title on the paper (KeboDoc shows it in title case). */
export const PAPER_TITLE: Record<PaperKind, string> = {
  "sales-contract": "SALES CONTRACT",
  "payment-request": "PAYMENT REQUEST",
  "payment-receipt": "PAYMENT RECEIPT",
  "customer-statement": "STATEMENT OF ACCOUNT",
  "purchase-order": "PURCHASE ORDER",
  "fat-report": "FAT REPORT",
  "inspection-report": "INSPECTION REPORT",
  "commercial-invoice": "COMMERCIAL INVOICE",
  "shipping-advice": "SHIPPING ADVICE",
  "bill-of-exchange": "BILL OF EXCHANGE",
  "beneficiary-certificate": "BENEFICIARY CERTIFICATE",
  "bank-cover-letter": "COVER LETTER",
  "delivery-note": "DELIVERY NOTE",
  "sat-certificate": "SAT CERTIFICATE",
};

/** "Contract No.", shown before the number under the title. */
export const PAPER_NUMBER_LABEL: Record<PaperKind, string> = {
  "sales-contract": "Contract No.",
  "payment-request": "Request No.",
  "payment-receipt": "Receipt No.",
  "customer-statement": "Statement No.",
  "purchase-order": "PO No.",
  "fat-report": "Report No.",
  "inspection-report": "Report No.",
  "commercial-invoice": "Invoice No.",
  "shipping-advice": "Advice No.",
  "bill-of-exchange": "Bill No.",
  "beneficiary-certificate": "Certificate No.",
  "bank-cover-letter": "Letter No.",
  "delivery-note": "Note No.",
  "sat-certificate": "Certificate No.",
};

/** Numbers follow the order's: SO-2026-0031 → SC-2026-0031, CI-2026-0031… */
export const PAPER_PREFIX: Record<PaperKind, string> = {
  "sales-contract": "SC",
  "payment-request": "PR",
  "payment-receipt": "RC",
  "customer-statement": "ST",
  "purchase-order": "PO",
  "fat-report": "FAT",
  "inspection-report": "IR",
  "commercial-invoice": "CI",
  "shipping-advice": "SA",
  "bill-of-exchange": "BE",
  "beneficiary-certificate": "BC",
  "bank-cover-letter": "CL",
  "delivery-note": "DN",
  "sat-certificate": "SAT",
};

/** The step page that lists the paper. */
export const PAPER_STEP: Record<PaperKind, FlowStep> = {
  "sales-contract": "payment",
  "payment-request": "payment",
  "payment-receipt": "payment",
  "customer-statement": "payment",
  "purchase-order": "factory",
  "fat-report": "production",
  "inspection-report": "production",
  "commercial-invoice": "shipping",
  "shipping-advice": "shipping",
  "bill-of-exchange": "documents",
  "beneficiary-certificate": "documents",
  "bank-cover-letter": "documents",
  "delivery-note": "delivery",
  "sat-certificate": "delivery",
};

/** What each paper is made from (the catalogue's "Made from"). */
export const PAPER_MADE_FROM: Record<PaperKind, string> = {
  "sales-contract": "order lines + payment route, shipment, inspection, warranty",
  "payment-request": "the plan: what is due, by when, to which account",
  "payment-receipt": "the recorded payment",
  "customer-statement": "the customer's orders and payments",
  "purchase-order": "the factory's prices, items, ready date",
  "fat-report": "the FAT item: result, date, who watched",
  "inspection-report": "the inspection item: inspector, result",
  "commercial-invoice": "order lines + B/L no., vessel, ports, LC no.",
  "shipping-advice": "the shipment: vessel, B/L, ETD/ETA, container",
  "bill-of-exchange": "LC no., amount, banks",
  "beneficiary-certificate": "the LC clauses we certify",
  "bank-cover-letter": "the paper set and the LC",
  "delivery-note": "goods, condition, received by",
  "sat-certificate": "SAT checks and results, signed by",
};

/** The paper of the order's document set it is (made final: that paper is ready). */
export const PAPER_DOCUMENT: Partial<Record<PaperKind, OrderDocumentKind>> = {
  "sales-contract": "sales_contract",
  "commercial-invoice": "commercial_invoice",
  "inspection-report": "inspection",
};

/** The paper of the app for a document-set kind (the reverse of PAPER_DOCUMENT). */
export const DOCUMENT_PAPER: Partial<Record<OrderDocumentKind, PaperKind>> = {
  sales_contract: "sales-contract",
  commercial_invoice: "commercial-invoice",
  inspection: "inspection-report",
};

/**
 * Document-set kinds the app makes itself (the proforma, the packing list, the sales contract, the
 * commercial invoice): their row in the set is written only by the app (making the paper final), never
 * recorded by hand, so the paper and the set can never disagree. The API refuses them; the form hides them.
 * (An inspection certificate can come from an outside inspector: it may still be recorded.)
 */
export const APP_DOCUMENT_KINDS: readonly OrderDocumentKind[] = ["proforma_invoice", "packing_list", "sales_contract", "commercial_invoice"];
export const appMakesDocument = (kind: OrderDocumentKind) => APP_DOCUMENT_KINDS.includes(kind);

/** Papers that exist only with a module of the company's plan. */
export const PAPER_FEATURE: Partial<Record<PaperKind, PlanFeature>> = {
  "shipping-advice": "shipping",
  "bill-of-exchange": "bank_documents",
  "beneficiary-certificate": "bank_documents",
  "bank-cover-letter": "bank_documents",
  "delivery-note": "delivery_sat",
  "sat-certificate": "delivery_sat",
};

/** Papers only for orders paid this way. */
export const PAPER_ROUTES: Partial<Record<PaperKind, readonly PaymentRoute[]>> = {
  "bill-of-exchange": ["letter_of_credit"],
  "beneficiary-certificate": ["letter_of_credit"],
  "bank-cover-letter": ["letter_of_credit", "bank_contract"],
};

/** The bank papers: these need the bank_documents module. */
export const BANK_PAPERS: readonly PaperKind[] = ["bill-of-exchange", "beneficiary-certificate", "bank-cover-letter"];

/** Printed from the data whenever opened: no draft, final or versions. */
export const LIVE_PAPERS: readonly PaperKind[] = ["customer-statement"];

/**
 * Kept as sent (claude/core-plan.md, phase 1): no draft and no Make page. A payment request is kept, exactly
 * as it prints, when it is sent (Send request), and again as R2, R3… when it is sent again; a payment receipt
 * when its payment is recorded (again when the payment is corrected). Until a request is sent it prints from
 * the data, marked NOT SENT.
 */
export const SENT_PAPERS: readonly PaperKind[] = ["payment-request", "payment-receipt"];

/** Papers made one per factory (?ref=<factory id>). */
export const PER_FACTORY_PAPERS: readonly PaperKind[] = ["purchase-order"];

/** Papers that show factory prices: only for people who see them (sourcing.manage). */
export const FACTORY_PRICE_PAPERS: readonly PaperKind[] = ["purchase-order"];

/* ---------------------------------------------------------------- papers we use */

/**
 * Settings › Papers we use: every paper the app makes or tracks, each with an
 * on/off switch for the company. Every paper starts switched on; a company
 * turns off the ones it never uses. A switched-off paper leaves the Papers
 * lists, their counts, the step's numbers, the checklist's paper items and
 * the "missing" warnings; a paper already made (or recorded) stays visible.
 * The keys are the Papers list's kinds: the app's papers, the order's own
 * proforma and packing list, and the document-set kinds others issue.
 */
export const PAPER_SWITCHES = [
  "proforma",
  "sales-contract",
  "payment-request",
  "payment-receipt",
  "customer-statement",
  "purchase-order",
  "fat-report",
  "inspection-report",
  "packing-list",
  "commercial-invoice",
  "shipping-advice",
  "bill-of-exchange",
  "beneficiary-certificate",
  "bank-cover-letter",
  "delivery-note",
  "sat-certificate",
  "bill_of_lading",
  "airway_bill",
  "certificate_of_origin",
  "insurance",
] as const;
export type PaperSwitch = (typeof PAPER_SWITCHES)[number];

export const isPaperSwitch = (k: string): k is PaperSwitch => (PAPER_SWITCHES as readonly string[]).includes(k);

export const PAPER_SWITCH_LABEL: Record<PaperSwitch, string> = {
  proforma: "Proforma invoice",
  "packing-list": "Packing list",
  ...PAPER_LABEL,
  bill_of_lading: "Bill of lading",
  airway_bill: "Airway bill",
  certificate_of_origin: "Certificate of origin",
  insurance: "Insurance certificate",
};

/** Settings' groups: made by the app, or issued by others and kept track of. */
export const PAPER_SWITCH_GROUPS: { title: string; hint: string; keys: readonly PaperSwitch[] }[] = [
  {
    title: "Made by the app",
    hint: "From the order's data, in the company's template.",
    keys: PAPER_SWITCHES.filter((k) => !["bill_of_lading", "airway_bill", "certificate_of_origin", "insurance"].includes(k)),
  },
  {
    title: "From others",
    hint: "Issued by the forwarder, the chamber or the insurer: uploaded, or marked kept elsewhere.",
    keys: ["bill_of_lading", "airway_bill", "certificate_of_origin", "insurance"],
  },
];

/** A short note beside a switch: where the paper shows up at all. */
export const PAPER_SWITCH_NOTE: Partial<Record<PaperSwitch, string>> = {
  "bill-of-exchange": "LC orders only",
  "beneficiary-certificate": "LC orders only",
  "bank-cover-letter": "LC and bank-contract orders only",
  "purchase-order": "seen by people who see factory prices",
  "fat-report": "when the order has a FAT",
  "inspection-report": "when the order has an inspection",
  airway_bill: "orders going by air",
  insurance: "LC orders",
};

/** The switch of a document-set kind (the papers the shipment needs); null: always used ("other"). */
export function documentSwitch(kind: OrderDocumentKind): PaperSwitch | null {
  switch (kind) {
    case "proforma_invoice":
      return "proforma";
    case "packing_list":
      return "packing-list";
    case "commercial_invoice":
      return "commercial-invoice";
    case "sales_contract":
      return "sales-contract";
    case "inspection":
      return "inspection-report";
    case "other":
      return null;
    default:
      return kind;
  }
}

/** Is this paper used by the company? (`off`: Settings › Papers we use; a key not switched off is on.) */
export const paperUsed = (off: readonly string[] | null | undefined, key: string | null) => !key || !off?.includes(key);

/** Is this document-set kind used by the company? */
export const documentUsed = (off: readonly string[] | null | undefined, kind: OrderDocumentKind) => paperUsed(off, documentSwitch(kind));

/**
 * The papers the shipment needs (requiredDocuments) that the company uses: a
 * switched-off one is left out, unless it is already made or recorded (`made`).
 */
export function documentsInUse(
  route: PaymentRoute | null,
  mode: ShipMode | null,
  off: readonly string[] | null | undefined,
  made: (kind: OrderDocumentKind) => boolean = () => false,
): OrderDocumentKind[] {
  return requiredDocuments(route, mode).filter((k) => documentUsed(off, k) || made(k));
}

/* ---------------------------------------------------------------- the buyer */

/**
 * The buyer as on the order (Order.buyerSnapshot): taken when the order is made (the quotation's
 * customer, details missing there from the customer as it was then), printed on every paper of the
 * order. "Refresh from customer" takes it again from the customer, with a reason; final papers keep
 * the buyer they were printed with.
 */
export interface BuyerSnapshot {
  name: string;
  country: string | null;
  address: string | null;
  taxNo: string | null;
  regNo: string | null;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
  /** YYYY-MM-DD: when it was taken. */
  takenOn?: string | null;
  /** order: when the order was made · customer: refreshed from the customer · data: filled in from the data (migration). */
  from?: "order" | "customer" | "data";
}

/** The buyer's details that are printed, compared (name, country, address, tax and registration numbers). */
export const BUYER_FIELDS = ["name", "country", "address", "taxNo", "regNo"] as const;

/** What differs between the buyer on the order and the customer now ("address, tax no."); empty: the same. */
export function buyerChanges(onOrder: Partial<BuyerSnapshot> | null, now: Partial<BuyerSnapshot>): string[] {
  const label: Record<(typeof BUYER_FIELDS)[number], string> = {
    name: "name",
    country: "country",
    address: "address",
    taxNo: "tax no.",
    regNo: "registration no.",
  };
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() : "") || "";
  return BUYER_FIELDS.filter((k) => norm(onOrder?.[k]) !== norm(now[k])).map((k) => label[k]);
}

/* ---------------------------------------------------------------- options */

export const PAPER_OPTIONS = ["prices", "showHs", "lcStatement", "stamp"] as const;
export type PaperOption = (typeof PAPER_OPTIONS)[number];
export type PaperOptions = Partial<Record<PaperOption, boolean>>;

export const PAPER_OPTION_LABEL: Record<PaperOption, string> = {
  prices: "Line amounts",
  showHs: "Show HS codes",
  lcStatement: "LC statement at the bottom",
  stamp: "Stamp and signature",
};

/** The options a kind has (the Make page's checkboxes). */
export function paperOptionsOf(kind: PaperKind): PaperOption[] {
  if (kind === "commercial-invoice") return ["prices", "showHs", "lcStatement", "stamp"];
  if (kind === "sales-contract") return ["prices", "showHs", "stamp"];
  return ["stamp"];
}

/** Options from "prices,stamp" (the Make page's preview); unknown words are ignored. */
export function parsePaperOptions(kind: PaperKind, list: string | null | undefined): PaperOptions | null {
  if (list === null || list === undefined) return null;
  const on = new Set(list.split(",").map((s) => s.trim()));
  return Object.fromEntries(paperOptionsOf(kind).map((o) => [o, on.has(o)]));
}

export const paperOptionsQuery = (o: PaperOptions) => PAPER_OPTIONS.filter((k) => o[k]).join(",");

/* ---------------------------------------------------------------- numbers */

/** SO-2026-0031 → CI-2026-0031; `n` adds "-n" (the second receipt: RC-2026-0031-2). */
export function paperNumber(refNo: string, kind: PaperKind, n?: number | null): string {
  const tail = /^[A-Za-z]+-(.+)$/.exec(refNo)?.[1] ?? refNo;
  return `${PAPER_PREFIX[kind]}-${tail}${n ? `-${n}` : ""}`;
}

/**
 * The packing list's number, from the order's (SO-2026-0005 → PL-2026-0005): the one formula for the
 * packing list itself, the Papers list and the bank cover letter.
 */
export const packingListNo = (refNo: string): string => refNo.replace(/^[A-Z]+-/, "PL-");

/* ---------------------------------------------------------------- where a paper stands */

export const PAPER_STATES = ["ready", "draft", "can", "wait", "up", "miss", "else"] as const;
export type PaperState = (typeof PAPER_STATES)[number];

export const PAPER_STATE_LABEL: Record<PaperState, string> = {
  ready: "Ready",
  draft: "Draft",
  can: "Can be made",
  wait: "Waiting for data",
  up: "Uploaded",
  miss: "Missing",
  else: "Kept elsewhere",
};
export const PAPER_STATE_TONE: Record<PaperState, Tone> = {
  ready: "ok",
  draft: "info",
  can: "info",
  wait: "warn",
  up: "info",
  miss: "warn",
  else: "neutral",
};

/** Ready, uploaded and kept elsewhere all count as done. */
export const paperDone = (s: PaperState) => s === "ready" || s === "up" || s === "else";

/** Where a paper comes from (the Documents page's badge). */
export type PaperSource = "app" | "upload";

/* ---------------------------------------------------------------- the printed paper */

/**
 * A cell of the paper's table or a value beside the title: text, an item (its
 * name with the specs and model under it), money, a quantity or a date. Null in
 * a detail beside the title: still needed (printed as a yellow "needed").
 */
export type PaperCell =
  | string
  | null
  | { item: string; model?: string | null }
  | { money: string; currency: string }
  | { qty: string; unit?: string | null }
  | { date: string };

export interface PaperColumn {
  key: string;
  label: string;
  /** Fixed width in pt; the description column takes the rest. */
  width?: number;
  align?: "left" | "right";
  wrap?: boolean;
}

/**
 * Everything one paper is printed from, in the one template (KeboDoc): the
 * title and number with details beside them, the party in the light-blue box,
 * the table, the total in the navy bar, the terms with the stamp, signatures.
 * Final papers keep exactly this as their snapshot.
 */
export interface PaperDoc {
  kind: PaperKind;
  title: string;
  numberLabel: string;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  company: {
    name: string;
    nameLocal?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    taxNo?: string | null;
    stamp: string | null;
  };
  /** "Prepared for": the customer, or the factory on a purchase order, or our bank on the cover letter. */
  party: { name: string; country?: string | null; address?: string | null; taxNo?: string | null; regNo?: string | null };
  meta: { label: string; value: PaperCell }[];
  heading: string | null;
  columns: PaperColumn[];
  rows: Record<string, PaperCell>[];
  sums: { label: string; value: PaperCell }[];
  total: { label: string; amount: string; currency: string } | null;
  /** A totals row under the items (packages and weights). */
  foot: { label: string; cells: Record<string, PaperCell> } | null;
  boxTitle: string;
  bullets: (string | { label: string; value: PaperCell })[];
  bank: string | null;
  /** Two signature lines (a contract, a handover). */
  signatures: { left: string; right: string } | null;
}

/** One line of the Make page's "Filled from the order". */
export interface PaperCheck {
  key: string;
  label: string;
  /** What the paper takes from the order ("MSC Aurora · Ningbo → Karachi"), or what is missing. */
  value: string;
  ok: boolean;
  /** Needed before it can be made final. */
  required: boolean;
  /** Missing data that can be typed on the Make page (saved where it belongs). */
  fix: PaperFixField | null;
  /** Or where to record it. */
  href: string | null;
  /** What is wrong with the value it has (e.g. our ship-by is later than the LC's latest shipment). */
  warn?: string | null;
}

export const PAPER_FIX_FIELDS = [
  "blNo",
  "vessel",
  "etd",
  "eta",
  "lcNo",
  "ourBank",
  "customerBank",
  "readyOn",
  "shipBy",
  "portOfDischarge",
  "hs",
] as const;
export type PaperFixField = (typeof PAPER_FIX_FIELDS)[number];

export const PAPER_FIX_LABEL: Record<PaperFixField, { label: string; type: "text" | "date"; saves: string }> = {
  blNo: { label: "B/L number", type: "text", saves: "the shipment" },
  vessel: { label: "Vessel", type: "text", saves: "the shipment" },
  etd: { label: "ETD", type: "date", saves: "the shipment" },
  eta: { label: "ETA", type: "date", saves: "the shipment" },
  lcNo: { label: "LC / contract number", type: "text", saves: "the bank contract" },
  ourBank: { label: "Our bank", type: "text", saves: "the bank contract" },
  customerBank: { label: "Customer's bank", type: "text", saves: "the bank contract" },
  readyOn: { label: "Ready date", type: "date", saves: "the order" },
  shipBy: { label: "Ship by", type: "date", saves: "the order" },
  portOfDischarge: { label: "Port of discharge", type: "text", saves: "the order" },
  hs: { label: "HS code", type: "text", saves: "the order's line" },
};

/* ---------------------------------------------------------------- text inside sentences */

/** "Vessel and ports" → "vessel and ports" inside a sentence; "B/L number" and "HS codes" stay as they are. */
export const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Jan 2027", for dates inside a sentence on a paper. */
export function paperDateText(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "USD 44,100.00", for amounts inside a sentence on a paper. */
export function paperMoneyText(amount: string | number, currency: string): string {
  return `${currency} ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "USD Forty-Four Thousand One Hundred only". */
export function paperWordsText(amount: string | number, currency: string): string {
  const cents = Math.round(Math.abs(Number(amount)) * 100);
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${currency} ${numberToWords(whole)}${rest ? ` and Cents ${numberToWords(rest)}` : ""} only`;
}
