import type { ISODate } from "@kebo/utils";
import type { BankContractStatus, BankStepKind, OrderDocumentKind, PaymentRoute, ShipMode, ShipmentStatus } from "../enums";
import type { Tone } from "../labels";
import type { LcCheck } from "./money-route";
import { daysBetween } from "@kebo/utils";
import { documentDone, FLOW_STEP_LABEL, FLOW_STEPS, type FlowStep } from "./flow";
import { documentsInUse } from "./papers";

/**
 * The order without checklists: an order's page is nine tabs, and each stage is
 * small sections. A section shows its values read-only, one word for where it
 * stands (read from its own data), its own files, and Edit (a window with only
 * that section's fields). Nothing is ticked and no tab waits for another.
 *
 * This file is the list of tabs and sections (the API, the web and the phone
 * app share it) and the words worked out from the order's facts.
 */

export const ORDER_TABS = ["overview", "payment", "factory", "production", "shipping", "delivery", "documents", "costs", "history"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export const ORDER_TAB_LABEL: Record<OrderTab, string> = {
  overview: "Overview",
  payment: "Payment",
  factory: "Factory order",
  production: "Production",
  shipping: "Shipping",
  delivery: "Delivery & SAT",
  documents: "Documents",
  costs: "Costs",
  history: "History",
};

/** The six stages among the tabs, in the tabs' order (Delivery & SAT comes before Documents). */
export const ORDER_FLOW_STAGES = ["payment", "factory", "production", "shipping", "delivery", "documents"] as const satisfies readonly FlowStep[];

/**
 * Every section that can hold files, with the tab it is on. A file added in a
 * section's window is kept with this key (Attachment.section) and with the
 * section's stage (Attachment.step), so the old lists by stage keep working.
 */
export const ORDER_SECTIONS = [
  "order",
  "payment_plan",
  "payments",
  "bank_contract",
  "lc",
  "purchase_order",
  "factory_payments",
  "ready_date",
  "fat",
  "goods",
  "booking",
  "container",
  "vessel",
  "packing",
  "freight",
  "arrival",
  "advice",
  "delivery",
  "sat",
  "claims",
  "originals",
  "bank_steps",
  "expenses",
] as const;
export type OrderSection = (typeof ORDER_SECTIONS)[number];

export const ORDER_SECTION_LABEL: Record<OrderSection, string> = {
  order: "The order",
  payment_plan: "Payment plan",
  payments: "Payments received",
  bank_contract: "The bank contract",
  lc: "The letter of credit",
  purchase_order: "Purchase order",
  factory_payments: "Payments to the factory",
  ready_date: "Ready date",
  fat: "Factory test (FAT)",
  goods: "Goods from the factory",
  booking: "Booking",
  container: "Container and loading",
  vessel: "Vessel and bill of lading",
  packing: "Packing",
  freight: "Freight and insurance",
  arrival: "Arrival and customs",
  advice: "Shipping advice",
  delivery: "Delivery",
  sat: "Installation and SAT",
  claims: "Claims",
  originals: "Originals to the customer",
  bank_steps: "The bank's steps",
  expenses: "Expenses",
};

/** The tab a section is on. */
export const ORDER_SECTION_TAB: Record<OrderSection, OrderTab> = {
  order: "overview",
  payment_plan: "payment",
  payments: "payment",
  bank_contract: "payment",
  lc: "payment",
  purchase_order: "factory",
  factory_payments: "factory",
  ready_date: "production",
  fat: "production",
  goods: "production",
  booking: "shipping",
  container: "shipping",
  vessel: "shipping",
  packing: "shipping",
  freight: "shipping",
  arrival: "shipping",
  advice: "shipping",
  delivery: "delivery",
  sat: "delivery",
  claims: "delivery",
  originals: "documents",
  bank_steps: "documents",
  expenses: "costs",
};

/** The stage a section's files are kept under (null: the order itself, or its costs). */
export function sectionStep(section: OrderSection): FlowStep | null {
  const tab = ORDER_SECTION_TAB[section];
  return (FLOW_STEPS as readonly string[]).includes(tab) ? (tab as FlowStep) : null;
}

export const isOrderSection = (v: unknown): v is OrderSection => typeof v === "string" && (ORDER_SECTIONS as readonly string[]).includes(v);

/** How a factory test ended. */
export const FAT_RESULTS = ["passed", "passed_with_remarks", "failed"] as const;
export type FatResult = (typeof FAT_RESULTS)[number];
export const FAT_RESULT_LABEL: Record<FatResult, string> = { passed: "Passed", passed_with_remarks: "Passed with remarks", failed: "Failed" };
export const FAT_RESULT_TONE: Record<FatResult, Tone> = { passed: "ok", passed_with_remarks: "warn", failed: "bad" };

/** How the freight is paid. */
export const FREIGHT_TERMS = ["prepaid", "collect"] as const;
export type FreightTerms = (typeof FREIGHT_TERMS)[number];
export const FREIGHT_TERMS_LABEL: Record<FreightTerms, string> = { prepaid: "Prepaid", collect: "Collect" };

/** Who bears a claim. */
export const CLAIM_BEARERS = ["factory", "us", "customer"] as const;
export type ClaimBearer = (typeof CLAIM_BEARERS)[number];
export const CLAIM_BEARER_LABEL: Record<ClaimBearer, string> = { factory: "The factory", us: "We do", customer: "The customer" };

/** What is stored about one order, gathered once: every section's word is read from it. Dates are YYYY-MM-DD. */
export interface StoredFacts {
  currency: string;
  route: PaymentRoute | null;
  /** The ship mode of the first shipment (sea when none). */
  shipMode: ShipMode | null;
  bankContract: {
    status: BankContractStatus;
    number: string | null;
    amount: string | null;
    currency: string | null;
    openedOn: ISODate | null;
  } | null;
  /** Deposit percent of the order (0: none). */
  depositPercent: number;
  depositIn: boolean;
  /** When the payments reached the deposit, and the deposit amount ("18900.00"). */
  depositOn: ISODate | null;
  deposit: string;
  /** Still due from the customer ("0.00": paid in full). */
  due: string;
  paidInFullOn: ISODate | null;
  factoryOrderedOn: ISODate | null;
  /** The factory's own number for our order. */
  factoryOrderNo?: string | null;
  /**
   * Money owed to the factories, or null when the person may not see factory money; `plan`: its payment
   * plan's parts (advance when ordered, balance on the ready date) with where each stands.
   */
  factories:
    | {
        name: string;
        currency: string;
        owed: string;
        paid: string;
        toPay: string;
        plan?: { label: string; dueRule: string; due: ISODate | null; open: string; status: string }[];
      }[]
    | null;
  /** An LC order: the LC checked against the order (amount, currency, ship-by, expiry); null otherwise. */
  lcChecks?: LcCheck[] | null;
  /** The route is still the one the quotation's terms implied (the order started on it). */
  routeFromQuotation?: boolean;
  /** The order's ready date: the latest of its factories', once each has given one. */
  readyOn: ISODate | null;
  /** Each factory's own ready date (one per factory; one row, factory null, when the lines name none). */
  readyBy?: { factory: string | null; readyOn: ISODate | null }[];
  goods: { lines: number; received: number };
  packedAt: ISODate | null;
  packing: { packages: number; grossKg: string | null; cbm: string | null } | null;
  /** The order's shipments in their order (shipmentsInOrder): Shipment 1, the primary, first. */
  shipments: {
    status: ShipmentStatus;
    mode: ShipMode;
    forwarder: string | null;
    bookingNo: string | null;
    containerNo: string | null;
    sealNo?: string | null;
    loadedOn?: ISODate | null;
    vessel: string | null;
    blNo: string | null;
    etd: ISODate | null;
    eta: ISODate | null;
    departedOn: ISODate | null;
    arrivedOn: ISODate | null;
    portOfDischarge: string | null;
  }[];
  /** Shipped on (the earliest day a shipment left) and Shipment 1's B/L — the one "Shipped" item when the shipping module is off. */
  shippedOn: ISODate | null;
  blNo: string | null;
  proforma: { number: string; issuedOn: ISODate | null } | null;
  documents: { kind: OrderDocumentKind; status: "missing" | "draft" | "ready" | "elsewhere"; number: string | null; issuedOn: ISODate | null }[];
  bankSteps: { step: BankStepKind; doneOn: ISODate; reference: string | null }[];
  deliveredOn: ISODate | null;
  satDoneOn: ISODate | null;
  satSignedBy: string | null;
  claims: { open: number; total: number };
  closedOn: ISODate | null;
  /** Settings › Papers we use: the papers the company switched off (left out unless done). */
  papersOff?: readonly string[];
}

/** The steps the order has: the five core ones, and Delivery & SAT with its module. */
export function orderSteps(features: readonly string[] | null): FlowStep[] {
  const on = (f: string) => !features || features.includes(f);
  return FLOW_STEPS.filter((s) => s !== "delivery" || on("delivery_sat"));
}

/** The order's facts the words are read from: the stored facts, plus what the sections added. */
export interface SectionFacts extends StoredFacts {
  /** Our promise to the customer. */
  shipBy?: ISODate | null;
  /** Each factory's test: planned, done, how it went. */
  fat?: { factory: string | null; plannedOn: ISODate | null; doneOn: ISODate | null; result: FatResult | null }[];
}

/** "5 Dec": a day without its year, for a word on a tab. */
export function dayMonth(d: ISODate): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
}

export interface StageWord {
  /** On the Overview's "Where it stands": "Deposit in", "Ready 5 Dec". */
  word: string;
  tone: Tone;
  /** Beside the tab's name, small: "deposit in", "ready 5 Dec" ("" when there is nothing to say yet). */
  tab: string;
}

const LEFT = ["departed", "arrived", "cleared"];
const IN = ["arrived", "cleared"];
const OPEN_AT_BANK = ["opened", "amended", "documents_presented"];
const latest = (days: (ISODate | null | undefined)[]): ISODate | null => days.filter((d): d is ISODate => !!d).sort().at(-1) ?? null;
const earliest = (days: (ISODate | null | undefined)[]): ISODate | null => days.filter((d): d is ISODate => !!d).sort()[0] ?? null;

/**
 * Where each stage stands, in one word, read from what is stored. The same
 * word on the Overview, on the tab and in the reminders; never typed.
 */
export function stageWords(f: SectionFacts, today: ISODate): Record<(typeof ORDER_FLOW_STAGES)[number], StageWord> {
  // Payment: the money in, then the bank's paper for the routes that have one.
  const paid = Number(f.due) === 0 && !!f.paidInFullOn;
  const atBank = f.route !== "informal" && f.route !== null && !!f.bankContract && OPEN_AT_BANK.includes(f.bankContract.status);
  const bankName = f.route === "letter_of_credit" ? "LC" : "Contract";
  const payment: StageWord = paid
    ? { word: "Paid in full", tone: "ok", tab: "paid in full" }
    : atBank
      ? { word: `${bankName} open`, tone: "info", tab: `${bankName === "LC" ? "LC" : "contract"} open` }
      : f.depositIn && f.depositPercent > 0
        ? { word: "Deposit in", tone: "ok", tab: "deposit in" }
        : { word: "Nothing in", tone: "warn", tab: "nothing in" };

  // Factory order: sent, then paid (the money only for people who may see it).
  const factoryPaid = !!f.factories?.length && f.factories.every((x) => Number(x.toPay) === 0 && Number(x.paid) > 0);
  const factory: StageWord = !f.factoryOrderedOn
    ? { word: "Not sent", tone: "neutral", tab: "not sent" }
    : factoryPaid
      ? { word: "Paid", tone: "ok", tab: "paid" }
      : { word: "PO sent", tone: "ok", tab: "PO sent" };

  // Production: the ready date, until the goods are in.
  const received = f.goods.lines > 0 && f.goods.received >= f.goods.lines;
  const production: StageWord = received
    ? { word: "Received", tone: "ok", tab: "received" }
    : f.readyOn
      ? { word: `Ready ${dayMonth(f.readyOn)}`, tone: f.readyOn < today ? "bad" : "warn", tab: `ready ${dayMonth(f.readyOn)}` }
      : { word: "Not started", tone: "neutral", tab: "" };

  // Shipping: booked, left, arrived (every shipment in for "arrived").
  const ships = f.shipments;
  const sea = (f.shipMode ?? "sea") === "sea";
  const leftOn = earliest(ships.map((s) => s.departedOn));
  const arrivedOn = latest(ships.map((s) => s.arrivedOn));
  const shipping: StageWord =
    ships.length > 0 && ships.every((s) => IN.includes(s.status) || !!s.arrivedOn)
      ? { word: arrivedOn ? `Arrived ${dayMonth(arrivedOn)}` : "Arrived", tone: "ok", tab: "arrived" }
      : ships.some((s) => LEFT.includes(s.status) || !!s.departedOn)
        ? { word: `${sea ? "Sailed" : "Left"}${leftOn ? ` ${dayMonth(leftOn)}` : ""}`, tone: "info", tab: sea ? "sailed" : "left" }
        : ships.some((s) => !!s.bookingNo || !!s.forwarder)
          ? { word: "Booked", tone: "info", tab: "booked" }
          : { word: "Not booked", tone: "neutral", tab: "" };

  // Delivery & SAT.
  const delivery: StageWord = f.satDoneOn
    ? { word: `SAT signed ${dayMonth(f.satDoneOn)}`, tone: "ok", tab: "signed off" }
    : f.deliveredOn
      ? { word: `Delivered ${dayMonth(f.deliveredOn)}`, tone: "ok", tab: "delivered" }
      : { word: "Not yet", tone: "neutral", tab: "" };

  // Documents: how many of the order's papers are ready. The papers the route and the ship mode ask for
  // (a switched-off one only when it was made anyway), the proforma, and any paper added by hand.
  const done = (kind: string) => f.documents.some((d) => d.kind === kind && documentDone(d.status));
  const asked = documentsInUse(f.route, f.shipMode, f.papersOff, done).filter((k) => k !== "proforma_invoice");
  const extra = f.documents.filter((d) => d.kind !== "proforma_invoice" && !asked.includes(d.kind));
  const total = asked.length + 1 + extra.length;
  const ready = asked.filter(done).length + (f.proforma || done("proforma_invoice") ? 1 : 0) + extra.filter((d) => documentDone(d.status)).length;
  const documents: StageWord = { word: `${ready} of ${total} papers`, tone: ready >= total ? "ok" : "neutral", tab: `${ready} of ${total}` };

  return { payment, factory, production, shipping, delivery, documents };
}

/** How the customer pays, as the order's page says it. */
export const ROUTE_NAME: Record<PaymentRoute, string> = {
  informal: "Bank transfer (T/T)",
  bank_contract: "Bank contract",
  letter_of_credit: "Letter of credit (LC)",
};

const amount = (currency: string | null | undefined, value: string | null | undefined) => {
  const n = Number(value ?? 0);
  return `${currency ?? ""} ${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`.trim();
};
const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" · ");
const many = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** A paper's short name inside a sentence. */
const PAPER_SHORT: Record<OrderDocumentKind, string> = {
  bill_of_lading: "B/L",
  airway_bill: "AWB",
  packing_list: "packing list",
  commercial_invoice: "invoice",
  proforma_invoice: "proforma",
  sales_contract: "sales contract",
  certificate_of_origin: "origin",
  insurance: "insurance",
  inspection: "inspection",
  other: "other paper",
};

export interface StageStand extends StageWord {
  stage: (typeof ORDER_FLOW_STAGES)[number];
  label: string;
  /** One sentence of facts: "Sino-Africa Logistics · SAL-88213 · sails 14 Dec". */
  fact: string;
  /** What is still empty, as a reminder (never a block): "container, B/L empty". */
  missing: string;
}

/**
 * The Overview's "Where it stands": one line per stage, in the tabs' order —
 * its word, a sentence of facts, and what is still empty.
 */
export function stageStands(f: SectionFacts, today: ISODate): StageStand[] {
  const w = stageWords(f, today);
  const cur = f.currency;

  // Payment
  const route = f.route ? ROUTE_NAME[f.route] : "Route not chosen";
  const through = f.route === "letter_of_credit" ? " through the LC" : f.route === "bank_contract" ? " through the banks" : "";
  const paid = Number(f.due) === 0 && !!f.paidInFullOn;
  const payment = paid
    ? join(f.depositPercent > 0 && f.depositOn ? `Deposit ${dayMonth(f.depositOn)}` : null, `paid in full ${dayMonth(f.paidInFullOn!)}`)
    : f.depositIn && f.depositPercent > 0
      ? join(route, `${f.depositPercent}% ${amount(cur, f.deposit)} in${f.depositOn ? ` on ${dayMonth(f.depositOn)}` : ""}`, `balance ${amount(cur, f.due)}${through}`)
      : join(route, f.depositPercent > 0 ? `deposit ${f.depositPercent}% ${amount(cur, f.deposit)} to come` : `${amount(cur, f.due)} to come${through}`);

  // Factory order
  const fac = f.factories ?? [];
  const names = list(fac.map((x) => x.name));
  const factory = !f.factoryOrderedOn
    ? join(names || "Not ordered from the factory yet", fac.length === 1 ? amount(fac[0]!.currency, fac[0]!.owed) : null)
    : join(
        names,
        `ordered ${dayMonth(f.factoryOrderedOn)}`,
        f.factoryOrderNo ? `their no. ${f.factoryOrderNo}` : null,
        fac.length === 1 ? (Number(fac[0]!.toPay) === 0 ? `${amount(fac[0]!.currency, fac[0]!.paid)} paid` : `${amount(fac[0]!.currency, fac[0]!.paid)} paid of ${amount(fac[0]!.currency, fac[0]!.owed)}`) : null,
      );

  // Production
  const received = f.goods.lines > 0 && f.goods.received >= f.goods.lines;
  const test = (f.fat ?? []).find((t) => t.doneOn || t.plannedOn);
  const fat = test?.doneOn
    ? `factory test ${test.result ? FAT_RESULT_LABEL[test.result].toLowerCase() : "done"} ${dayMonth(test.doneOn)}`
    : test?.plannedOn
      ? `factory test planned ${dayMonth(test.plannedOn)}`
      : null;
  const left = f.readyOn ? daysBetween(today, f.readyOn) : 0;
  const goods = f.goods.lines > 0 && f.goods.received > 0 ? `${f.goods.received} of ${many(f.goods.lines, "line")} received` : null;
  const production = received
    ? join(f.readyOn ? `Ready ${dayMonth(f.readyOn)}` : null, fat, `${f.goods.received} of ${many(f.goods.lines, "line")} received`)
    : f.readyOn
      ? join(left > 0 ? `${many(left, "day")} left` : left === 0 ? "ready today" : `${many(-left, "day")} late`, fat, goods)
      : join("No ready date yet", fat);
  const productionMissing = !received && f.readyOn && left < 0 ? "goods not received" : "";

  // Shipping (the first shipment speaks; more are counted)
  const sh = f.shipments[0];
  const shipping = !sh || !(sh.forwarder || sh.bookingNo || sh.departedOn)
    ? f.shipBy
      ? `Ship by ${dayMonth(f.shipBy)}`
      : "Nothing booked yet"
    : join(
        sh.forwarder,
        sh.bookingNo,
        sh.vessel,
        sh.blNo ? `B/L ${sh.blNo}` : null,
        sh.departedOn ? `${sh.mode === "sea" ? "sailed" : "left"} ${dayMonth(sh.departedOn)}` : sh.etd ? `${sh.mode === "sea" ? "sails" : "leaves"} ${dayMonth(sh.etd)}` : null,
        sh.arrivedOn ? `arrived ${dayMonth(sh.arrivedOn)}` : sh.eta ? `arrives ${dayMonth(sh.eta)}` : null,
        f.shipments.length > 1 ? `${f.shipments.length} shipments` : null,
      );
  const empty = sh && (sh.forwarder || sh.bookingNo) && !sh.arrivedOn ? [!sh.containerNo && sh.mode === "sea" ? "container" : null, !sh.blNo ? (sh.mode === "air" ? "AWB" : "B/L") : null].filter(Boolean) : [];
  const shippingMissing = empty.length ? `${empty.join(", ")} empty` : "";

  // Delivery & SAT
  const delivery =
    join(
      f.deliveredOn ? `Delivered ${dayMonth(f.deliveredOn)}` : null,
      f.satDoneOn ? `SAT signed ${dayMonth(f.satDoneOn)}${f.satSignedBy ? ` by ${f.satSignedBy}` : ""}` : null,
      f.claims.open ? `${many(f.claims.open, "open claim")}` : f.claims.total ? `${many(f.claims.total, "claim")} settled` : null,
    ) || "After arrival";
  const deliveryMissing = f.deliveredOn && !f.satDoneOn ? "SAT not signed" : "";

  // Documents
  const done = (kind: string) => f.documents.some((d) => d.kind === kind && documentDone(d.status));
  const asked = documentsInUse(f.route, f.shipMode, f.papersOff, done).filter((k) => k !== "proforma_invoice");
  const hasProforma = !!f.proforma || done("proforma_invoice");
  const made = [...(hasProforma ? ["proforma"] : []), ...asked.filter(done).map((k) => PAPER_SHORT[k])];
  const toCome = [...(hasProforma ? [] : ["proforma"]), ...asked.filter((k) => !done(k)).map((k) => PAPER_SHORT[k])];
  const sentence = list(made);
  const documents = made.length ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} ready` : "No paper yet";
  const documentsMissing = toCome.length ? (toCome.length <= 3 ? `${toCome.join(", ")} to come` : `${toCome.length} to come`) : "";

  const row = (stage: (typeof ORDER_FLOW_STAGES)[number], fact: string, missing = ""): StageStand => ({ stage, label: ORDER_TAB_LABEL[stage], ...w[stage], fact, missing });
  return [
    row("payment", payment),
    row("factory", factory),
    row("production", production, productionMissing),
    row("shipping", shipping, shippingMissing),
    row("delivery", delivery, deliveryMissing),
    row("documents", documents, documentsMissing),
  ];
}

/** What the sections' reminders read (an order's whole facts fit). */
export interface SectionReminderFacts {
  closedOn?: ISODate | null;
  readyOn: ISODate | null;
  goods: { lines: number; received: number };
  fat?: SectionFacts["fat"];
  shipments: { status: string; departedOn: ISODate | null }[];
  shippedOn?: ISODate | null;
  shipBy?: ISODate | null;
}

/** A reminder read from the sections: what is late, on which tab. */
export interface SectionReminder {
  key: "goods_late" | "fat_late" | "ship_late";
  tab: OrderTab;
  /** The day it was due. */
  due: ISODate;
  text: string;
}

/**
 * What the sections say is late (the checklist's due dates are gone): the
 * ready date passed and the goods are not all in; a factory test planned and
 * not done; our ship-by date passed and nothing has left.
 */
export function sectionReminders(f: SectionReminderFacts, today: ISODate): SectionReminder[] {
  const out: SectionReminder[] = [];
  if (f.closedOn) return out;
  const received = f.goods.lines > 0 && f.goods.received >= f.goods.lines;
  if (f.readyOn && f.readyOn < today && !received && f.goods.lines > 0)
    out.push({ key: "goods_late", tab: "production", due: f.readyOn, text: `Goods were to be ready ${dayMonth(f.readyOn)}: ${f.goods.received} of ${f.goods.lines} received` });
  for (const t of f.fat ?? []) {
    if (t.plannedOn && !t.doneOn && t.plannedOn < today)
      out.push({ key: "fat_late", tab: "production", due: t.plannedOn, text: `Factory test planned ${dayMonth(t.plannedOn)}${t.factory ? ` at ${t.factory}` : ""}: no result yet` });
  }
  const left = f.shipments.some((s) => LEFT.includes(s.status) || !!s.departedOn) || !!f.shippedOn;
  if (f.shipBy && f.shipBy < today && !left) out.push({ key: "ship_late", tab: "shipping", due: f.shipBy, text: `Ship by ${dayMonth(f.shipBy)} has passed: nothing has left yet` });
  return out;
}

/* ---------------------------------------------------------------- history per stage */

/** A card key without its record ("shipment:<id>" → "shipment"). */
const cardKey = (card: string) => card.split(":")[0]!;

/** The cards that count their edits: how each reads in the history, and the order step it belongs to. */
export const EDIT_CARDS: Record<string, { label: string; step?: FlowStep }> = {
  needs: { label: "Items" },
  lines: { label: "Offer lines" },
  factory: { label: "Factory order", step: "factory" },
  production: { label: "Production", step: "production" },
  "lines.received": { label: "Lines from the factory", step: "production" },
  "lines.packing": { label: "Packing lines", step: "shipping" },
  "packing.marks": { label: "Shipping marks", step: "shipping" },
  shipment: { label: "Shipment", step: "shipping" },
  shipping: { label: "Shipping", step: "shipping" },
  delivery: { label: "Delivery", step: "delivery" },
  "lines.delivered": { label: "Lines delivered", step: "delivery" },
};
/** "Lines from the factory" for "lines.received"; the key itself when it is not a known card. */
export const editCardLabel = (card: string) => EDIT_CARDS[cardKey(card)]?.label ?? card;

/**
 * The stage a change in the order's history belongs to, for the history's
 * Stage column and filter. Null: the order as a whole.
 */
export function STEP_OF_ACTION(action: string, newValues?: unknown): FlowStep | null {
  const nv = (newValues && typeof newValues === "object" ? newValues : {}) as Record<string, unknown>;
  const step = typeof nv.step === "string" && (FLOW_STEPS as readonly string[]).includes(nv.step) ? (nv.step as FlowStep) : null;
  // "checklist.": what was ticked before the order's sections; those entries keep their stage in the history.
  if (action.startsWith("checklist.") || action.startsWith("paper.") || action.startsWith("file.")) return step;
  if (action === "card.edit" || action === "card.first") return typeof nv.card === "string" ? (EDIT_CARDS[cardKey(nv.card)]?.step ?? null) : null;
  if (action.startsWith("expense")) return step;
  if (action.startsWith("payment_out")) return "factory";
  if (action.startsWith("payment_") || action === "payment_plan") return "payment";
  switch (action) {
    case "flow.route":
    case "flow.bank_contract":
      return "payment";
    case "flow.factory_order":
      return "factory";
    case "goods_received":
    case "flow.production":
      return "production";
    case "packing_list":
    case "flow.shipment":
      return "shipping";
    case "flow.document":
    case "flow.bank_step":
      return "documents";
    case "flow.delivery":
    case "delivered":
    case "flow.sat":
    case "flow.claim":
      return "delivery";
    case "update":
      if ("readyOn" in nv) return "production";
      if ("shippedOn" in nv || "blNo" in nv || "containerNo" in nv || "shippingMarks" in nv) return "shipping";
      if ("proformaNo" in nv) return "documents";
      return null;
    default:
      return null;
  }
}

/** Each step's page under /orders/:id. */
export const STEP_PATH: Record<FlowStep, string> = {
  payment: "payment",
  factory: "factory",
  production: "production",
  shipping: "shipping",
  documents: "documents",
  delivery: "delivery",
};

export const stepLabel = (step: FlowStep) => FLOW_STEP_LABEL[step];
