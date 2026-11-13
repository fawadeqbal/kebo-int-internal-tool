import type { ISODate } from "@kebo/utils";
import type { Tone } from "../labels";
import type { ChecklistFacts } from "./checklist";
import { documentDone, FLOW_STEPS, type FlowStep } from "./flow";
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

/** The order's facts the words are read from: the stored facts, plus what the sections added. */
export interface SectionFacts extends ChecklistFacts {
  /** Our promise to the customer. */
  shipBy?: ISODate | null;
  /** Each factory's test: planned, done, how it went. */
  fat?: { factory: string | null; plannedOn: ISODate | null; doneOn: ISODate | null; result: FatResult | null }[];
  originalsSentOn?: ISODate | null;
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
