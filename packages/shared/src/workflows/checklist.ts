import { daysBetween, type ISODate } from "@kebo/utils";
import { lcChecksLine, type LcCheck } from "./money-route";
import type { BankContractStatus, BankStepKind, OrderDocumentKind, PaymentRoute, ShipMode, ShipmentStatus } from "../enums";
import { documentsInUse, type PaperKind } from "./papers";
import {
  BANK_STEP_LABEL,
  bankStepsFor,
  documentDone,
  FLOW_STEP_LABEL,
  FLOW_STEPS,
  ORDER_DOCUMENT_LABEL,
  PAYMENT_ROUTE_LABEL,
  SHIP_MODE_LABEL,
  type FlowStep,
} from "./flow";

/**
 * Order flow v3: every step of an order is a checklist.
 *
 * - Automatic items (round box) tick themselves from the order's data and are
 *   worked out on every read, never stored as done. A stored row with the same
 *   key only keeps overrides: due date, person, skip with a reason, a note.
 * - Own items (square box) come from the company's list (or DEFAULT_CHECKLIST),
 *   copied into the order once, or are added on the order. Each has a tool:
 *   what its button does.
 *
 * Nothing here touches the database: the API, the web and the phone app share it.
 */

export const CHECKLIST_TOOLS = ["done", "fill", "upload", "pay", "make", "send"] as const;
export type ChecklistTool = (typeof CHECKLIST_TOOLS)[number];

/** The row's button for an own item. */
export const TOOL_LABEL: Record<ChecklistTool, string> = {
  done: "Mark done",
  fill: "Fill in",
  upload: "Upload",
  pay: "Pay",
  make: "Make",
  send: "Send",
};

/** What each tool does, for the company's list in Settings. */
export const TOOL_HINT: Record<ChecklistTool, string> = {
  done: "One click, for items with nothing to fill in",
  fill: "A small form with the item's fields; saving ticks it",
  upload: "Attach the file; the item ticks when it is in",
  pay: "Opens the payment form; tick it once paid",
  make: "The app makes the paper (choose which); made final, it ticks",
  send: "The app makes the paper and gives the email / WhatsApp text to send it; made final, it ticks",
};

export const CHECKLIST_FIELD_TYPES = ["text", "date", "number", "file"] as const;
export type ChecklistFieldType = (typeof CHECKLIST_FIELD_TYPES)[number];

export interface ChecklistField {
  key: string;
  label: string;
  type: ChecklistFieldType;
}

/** The step a key belongs to ("doc:…" and "bank:…" are Documents & bank). */
export interface AutoItemDef {
  key: string;
  title: string;
  /** Where it sits among the step's items (own items use their sort order). */
  sort: number;
  /** Only for orders paid this way. */
  routes?: readonly PaymentRoute[];
}

/** Everything the automatic items are worked out from, for one order. Dates are YYYY-MM-DD. */
export interface ChecklistFacts {
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
  readyOn: ISODate | null;
  goods: { lines: number; received: number };
  packedAt: ISODate | null;
  packing: { packages: number; grossKg: string | null; cbm: string | null } | null;
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
  /** Shipped (the order's own date) — used when the shipping module is off. */
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
  /** Settings › Papers we use: the papers the company switched off (their doc:* items are left out unless done). */
  papersOff?: readonly string[];
}

export interface AutoItem {
  step: FlowStep;
  key: string;
  title: string;
  sort: number;
  done: boolean;
  /** When it got done (YYYY-MM-DD), when known. */
  doneOn: ISODate | null;
  /** What it collected, as label / value pairs (a YYYY-MM-DD value is a date). */
  data: [string, string][];
  /** What it still needs, when open. */
  needs: string | null;
  routes?: readonly PaymentRoute[];
  /** Its own due date from the data (the factory balance on the ready date); a stored due date wins. */
  due?: ISODate | null;
  /** Shown like a late item while open (an LC check that fails). */
  warn?: boolean;
}

const BANK: readonly PaymentRoute[] = ["bank_contract", "letter_of_credit"];
const SAILED: ShipmentStatus[] = ["departed", "arrived", "cleared"];
const LOADED: ShipmentStatus[] = ["loaded", ...SAILED];

const money = (currency: string | null, amount: string | null) => {
  if (amount === null) return "";
  const n = Number(amount);
  return `${currency ?? ""} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
};
const isZero = (v: string) => Math.abs(Number(v)) < 0.005;
const pairs = (list: [string, string | null | undefined][]): [string, string][] => list.filter((p): p is [string, string] => !!p[1]);

/** The keys and sort places of the automatic items, per step (what Settings lists, with a Hide switch). */
export const AUTO_ITEMS: Record<FlowStep, AutoItemDef[]> = {
  payment: [
    { key: "route", title: "Payment route chosen", sort: 10 },
    { key: "contract", title: "Bank contract or LC opened", sort: 20, routes: BANK },
    { key: "deposit_in", title: "Deposit received", sort: 40 },
  ],
  factory: [
    { key: "factory_ordered", title: "Order placed with the factory", sort: 10 },
    { key: "factory_advance", title: "Advance paid to the factory", sort: 20 },
  ],
  production: [
    { key: "ready_date", title: "Ready date from the factory", sort: 25 },
    { key: "factory_paid", title: "Balance paid to the factory", sort: 80 },
    { key: "goods_received", title: "Goods received from the factory", sort: 90 },
  ],
  shipping: [
    { key: "booked", title: "Space booked with the forwarder", sort: 10 },
    { key: "packing_list", title: "Packing list made", sort: 20 },
    { key: "loaded", title: "Loaded", sort: 30 },
    { key: "sailed", title: "Sailed · bill of lading", sort: 40 },
    { key: "shipped", title: "Shipped", sort: 40 },
    { key: "arrived", title: "Arrived", sort: 70 },
    { key: "balance_in", title: "Balance received", sort: 80 },
    { key: "closed", title: "Order closed", sort: 1000 },
  ],
  documents: [
    // doc:<kind> (sort 10…) and bank:<step> (sort 50…) are added per order from the route and the ship mode.
  ],
  delivery: [
    { key: "delivered", title: "Delivered to the customer", sort: 10 },
    { key: "sat_done", title: "SAT signed off", sort: 20 },
    { key: "claims_closed", title: "Claims closed", sort: 30 },
    { key: "closed", title: "Order closed", sort: 1000 },
  ],
};

/** Every automatic key a company can hide in Settings (the paper and bank-step keys are not hidden one by one). */
export const HIDEABLE_AUTO_KEYS = [...new Set(FLOW_STEPS.flatMap((s) => AUTO_ITEMS[s].map((d) => d.key)))].filter((k) => k !== "closed");

/** The steps the order has: the five core ones, and Delivery & SAT with its module. */
export function orderSteps(features: readonly string[] | null): FlowStep[] {
  const on = (f: string) => !features || features.includes(f);
  return FLOW_STEPS.filter((s) => s !== "delivery" || on("delivery_sat"));
}

/**
 * The automatic items of one order, worked out from its data. `features` null
 * means every module. Items of a switched-off module are not returned; items
 * limited to a route the order does not have are left out.
 */
export function autoChecklist(f: ChecklistFacts, features: readonly string[] | null): AutoItem[] {
  const on = (feature: string) => !features || features.includes(feature);
  const bankRoute = f.route !== null && BANK.includes(f.route);
  const out: AutoItem[] = [];
  const add = (
    step: FlowStep,
    key: string,
    item: Omit<AutoItem, "step" | "key" | "title" | "sort"> & { title?: string; sort?: number },
  ) => {
    const def = AUTO_ITEMS[step].find((d) => d.key === key);
    out.push({ step, key, title: item.title ?? def?.title ?? key, sort: item.sort ?? def?.sort ?? 50, ...item });
  };

  /* Payment */
  if (on("bank_contracts")) {
    add("payment", "route", {
      done: f.route !== null,
      doneOn: null,
      data: pairs([["Route", f.route ? PAYMENT_ROUTE_LABEL[f.route].replace(/ \(.*\)$/, "") : null]]),
      needs: f.route ? null : "how the customer pays",
    });
    if (bankRoute) {
      const c = f.bankContract;
      const lc = f.route === "letter_of_credit";
      // An LC is also checked against the order: a check that fails keeps it open, shown like a late item.
      const checks = lc ? (f.lcChecks ?? []) : [];
      const failing = checks.filter((x) => x.ok === false);
      const opened = !!c && c.status !== "draft";
      add("payment", "contract", {
        title: lc ? "LC opened and checked against the order" : "Bank contract opened",
        done: opened && !failing.length,
        doneOn: c?.openedOn ?? null,
        data: pairs([
          [lc ? "LC" : "Contract", c?.number],
          ["Amount", c?.amount ? money(c.currency, c.amount) : null],
          ["Checks", lc && c && checks.length ? lcChecksLine(checks) : null],
        ]),
        needs: failing.length
          ? failing.map((x) => `${x.label.toLowerCase()}: ${x.detail}`).join(" · ")
          : c
            ? `the ${lc ? "LC" : "contract"} to open`
            : `the ${lc ? "LC" : "contract"} number, banks and amount`,
        routes: BANK,
        warn: failing.length > 0,
      });
    }
  }
  if (f.depositPercent > 0)
    add("payment", "deposit_in", {
      title: `Deposit received`,
      done: f.depositIn,
      doneOn: f.depositOn,
      data: f.depositIn
        ? pairs([
            ["Amount", money(f.currency, f.deposit)],
            ["On", f.depositOn],
          ])
        : [],
      needs: f.depositIn ? null : `${money(f.currency, f.deposit)} (${f.depositPercent}%)`,
    });

  /* Factory order */
  add("factory", "factory_ordered", {
    done: !!f.factoryOrderedOn,
    doneOn: f.factoryOrderedOn,
    data: pairs([
      ["Their no.", f.factoryOrderNo],
      ["Ordered", f.factoryOrderedOn],
    ]),
    needs: f.factoryOrderedOn ? null : "the day we confirmed the order with the factory",
  });
  const owing = f.factories?.filter((x) => Number(x.owed) > 0) ?? [];
  if (owing.length) {
    // The advance: the plan's parts due when we order, paid (no plan: anything paid).
    const advanceOf = (x: (typeof owing)[number]) => x.plan?.filter((p) => p.dueRule === "on_order") ?? [];
    const advance = owing.every((x) => (advanceOf(x).length ? advanceOf(x).every((p) => p.status === "paid") : Number(x.paid) > 0));
    add("factory", "factory_advance", {
      done: advance,
      doneOn: null,
      data: advance ? owing.map((x): [string, string] => [owing.length > 1 ? x.name : "Paid", money(x.currency, x.paid)]) : [],
      needs: advance
        ? null
        : owing
            .map((x) => {
              const open = advanceOf(x).find((p) => p.status !== "paid");
              return open ? `${x.name}: ${open.label} ${money(x.currency, open.open)}` : `${x.name}: nothing paid yet`;
            })
            .join(" · "),
      due: owing.map((x) => advanceOf(x).find((p) => p.status !== "paid")?.due ?? null).find((d) => !!d) ?? null,
    });
  }

  /* Production */
  add("production", "ready_date", {
    done: !!f.readyOn,
    doneOn: null,
    data: pairs([["Ready", f.readyOn]]),
    needs: f.readyOn ? null : "the date the factory gives",
  });
  if (owing.length) {
    const paid = owing.every((x) => isZero(x.toPay) || Number(x.toPay) < 0);
    // Due when the factory's balance is (the ready date): late once that passes unpaid.
    const balanceDue = owing.map((x) => x.plan?.filter((p) => p.status !== "paid").at(-1)?.due ?? null).filter((d): d is string => !!d).sort()[0] ?? null;
    add("production", "factory_paid", {
      done: paid,
      doneOn: null,
      data: [
        ...owing.map((x): [string, string] => [owing.length > 1 ? x.name : paid ? "Paid" : "To pay", money(x.currency, paid ? x.owed : x.toPay)]),
        ...pairs([["Due", paid ? null : balanceDue]]),
      ],
      needs: null,
      due: paid ? null : balanceDue,
    });
  }
  if (f.goods.lines > 0)
    add("production", "goods_received", {
      done: f.goods.received >= f.goods.lines,
      doneOn: null,
      data: [["Received", `${f.goods.received} of ${f.goods.lines} item${f.goods.lines === 1 ? "" : "s"}`]],
      needs: null,
    });

  /* Shipping */
  const ships = on("shipping");
  const first = f.shipments[0] ?? null;
  const air = (first?.mode ?? f.shipMode) === "air";
  if (ships) {
    const booked = f.shipments.filter((s) => s.status !== "planned");
    add("shipping", "booked", {
      done: booked.length > 0,
      doneOn: null,
      data: pairs([
        ["Forwarder", booked[0]?.forwarder],
        ["Booking no.", booked[0]?.bookingNo],
        ["ETD", booked[0]?.etd],
      ]),
      needs: booked.length ? null : "forwarder, booking number, ETD",
    });
  }
  if (f.goods.lines > 0)
    add("shipping", "packing_list", {
      done: !!f.packedAt,
      doneOn: f.packedAt,
      data:
        f.packedAt && f.packing
          ? pairs([
              ["Packages", String(f.packing.packages)],
              ["Gross", f.packing.grossKg ? `${f.packing.grossKg} kg` : null],
              ["Volume", f.packing.cbm ? `${f.packing.cbm} CBM` : null],
            ])
          : [],
      needs: f.packedAt ? null : "packages, weights and volume per line",
    });
  if (ships) {
    const loaded = f.shipments.find((s) => LOADED.includes(s.status));
    add("shipping", "loaded", {
      title: air ? "Handed to the airline" : "Loaded",
      done: !!loaded,
      doneOn: loaded?.loadedOn ?? null,
      data: pairs([
        ["Container", loaded?.containerNo],
        ["Seal", loaded?.sealNo],
        ["Loaded", loaded?.loadedOn],
      ]),
      needs: loaded ? null : air ? null : "container number",
    });
    const sailed = f.shipments.find((s) => SAILED.includes(s.status));
    add("shipping", "sailed", {
      title: air ? "Flown · air waybill" : "Sailed · bill of lading",
      done: !!sailed,
      doneOn: sailed?.departedOn ?? null,
      data: pairs([
        ["Vessel", sailed?.vessel],
        [air ? "AWB" : "B/L", sailed?.blNo],
        [air ? "Flown" : "Sailed", sailed?.departedOn],
      ]),
      needs: sailed ? null : air ? "AWB number, flown on" : "vessel, B/L number, sailed on",
    });
    const arrived = f.shipments.length > 0 && f.shipments.every((s) => s.status === "arrived" || s.status === "cleared");
    const at = first?.portOfDischarge;
    add("shipping", "arrived", {
      title: at ? `Arrived at ${at}` : "Arrived",
      done: arrived,
      doneOn: arrived
        ? (f.shipments
            .map((s) => s.arrivedOn)
            .filter((d): d is string => !!d)
            .sort()
            .at(-1) ?? null)
        : null,
      data: arrived
        ? pairs([
            [
              "Arrived",
              f.shipments
                .map((s) => s.arrivedOn)
                .filter((d): d is string => !!d)
                .sort()
                .at(-1),
            ],
          ])
        : pairs([["ETA", first?.eta]]),
      needs: null,
    });
  } else {
    add("shipping", "shipped", {
      done: !!f.shippedOn,
      doneOn: f.shippedOn,
      data: pairs([
        ["Shipped", f.shippedOn],
        ["B/L", f.blNo],
      ]),
      needs: f.shippedOn ? null : "ship date and B/L number",
    });
  }
  // The balance: through the banks on a bank route (Documents & bank), here otherwise.
  const docs = on("bank_documents");
  if (!(bankRoute && docs))
    add("shipping", "balance_in", {
      done: isZero(f.due) || Number(f.due) < 0,
      doneOn: f.paidInFullOn,
      data:
        isZero(f.due) || Number(f.due) < 0 ? pairs([["Paid in full", f.paidInFullOn ?? "yes"]]) : [["Still due", money(f.currency, f.due)]],
      needs: null,
    });

  /* Documents & bank */
  if (docs) {
    const mode = first?.mode ?? f.shipMode ?? "sea";
    const doneKind = (kind: OrderDocumentKind) =>
      f.documents.some((d) => d.kind === kind && documentDone(d.status)) || (kind === "proforma_invoice" ? !!f.proforma : kind === "packing_list" ? !!f.packedAt : false);
    documentsInUse(f.route, mode, f.papersOff, doneKind).forEach((kind, i) => {
      const rows = f.documents.filter((d) => d.kind === kind);
      const ready = rows.find((d) => documentDone(d.status));
      const system = kind === "proforma_invoice" ? f.proforma : null;
      const done = rows.length ? !!ready : kind === "proforma_invoice" ? !!f.proforma : kind === "packing_list" ? !!f.packedAt : false;
      add("documents", `doc:${kind}`, {
        title: ORDER_DOCUMENT_LABEL[kind],
        sort: 10 + i,
        done,
        doneOn: ready?.issuedOn ?? system?.issuedOn ?? null,
        data: pairs([
          ["No.", ready?.number ?? system?.number ?? (kind === "bill_of_lading" || kind === "airway_bill" ? f.blNo : null)],
          ["Issued", ready?.issuedOn ?? system?.issuedOn],
        ]),
        needs: done
          ? null
          : rows.length
            ? `${rows[0]!.status === "draft" ? "draft: " : ""}mark it ready`
            : kind === "packing_list"
              ? "made from the packing list"
              : kind === "commercial_invoice" || kind === "sales_contract" || kind === "inspection"
                ? "the app makes it"
                : "upload it, or say where it is kept",
      });
    });
    bankStepsFor(f.route).forEach((step, i) => {
      const s = f.bankSteps.find((b) => b.step === step);
      add("documents", `bank:${step}`, {
        title: BANK_STEP_LABEL[step],
        sort: 50 + i,
        done: !!s,
        doneOn: s?.doneOn ?? null,
        data: pairs([
          ["On", s?.doneOn],
          ["Ref.", s?.reference],
        ]),
        needs: null,
      });
    });
  }

  /* Delivery & SAT */
  const delivery = on("delivery_sat");
  if (delivery) {
    add("delivery", "delivered", {
      done: !!f.deliveredOn,
      doneOn: f.deliveredOn,
      data: pairs([["Delivered", f.deliveredOn]]),
      needs: f.deliveredOn ? null : "date and condition",
    });
    add("delivery", "sat_done", {
      done: !!f.satDoneOn,
      doneOn: f.satDoneOn,
      data: pairs([
        ["Signed off", f.satDoneOn],
        ["By", f.satSignedBy],
      ]),
      needs: f.satDoneOn ? null : "every SAT point passed",
    });
    add("delivery", "claims_closed", {
      done: !!f.deliveredOn && f.claims.open === 0,
      doneOn: null,
      data: [["Claims", f.claims.open ? `${f.claims.open} open` : f.claims.total ? `${f.claims.total} settled` : "none"]],
      needs: null,
    });
  }
  // Closing is the last item: of Delivery & SAT, or of Shipping without it.
  add(delivery ? "delivery" : "shipping", "closed", {
    done: !!f.closedOn,
    doneOn: f.closedOn,
    data: pairs([["Closed", f.closedOn]]),
    needs: null,
  });
  return out;
}

/* ---------------------------------------------------------------- the company's list */

export interface ChecklistTemplateItem {
  step: FlowStep;
  title: string;
  tool: ChecklistTool;
  fields?: ChecklistField[];
  /** Make and Send items: the paper the app makes. */
  paper?: PaperKind | null;
  route?: PaymentRoute | null;
  /** Due this many days after the order date. */
  dueDays?: number | null;
  /** Where it sits among the step's items (the automatic ones are at 10, 20, …). */
  sort: number;
}

/**
 * Order v4, light rows: a fill item asks its date fields (filled with today)
 * and its first two other fields up front; the rest are "+ chips" one tap
 * away. The non-file fields asked up front are the ones that tick it.
 */
export function fillSplit<F extends ChecklistField>(fields: readonly F[]): { upfront: F[]; later: F[]; required: F[] } {
  const firstTwo = new Set(
    fields
      .filter((f) => f.type !== "date")
      .slice(0, 2)
      .map((f) => f.key),
  );
  const upfront = fields.filter((f) => f.type === "date" || firstTwo.has(f.key));
  return { upfront, later: fields.filter((f) => !upfront.includes(f)), required: upfront.filter((f) => f.type !== "file") };
}

const fld = (key: string, label: string, type: ChecklistFieldType = "text"): ChecklistField => ({ key, label, type });

/** The items every order starts with while the company has not made its own list. */
export const DEFAULT_CHECKLIST: ChecklistTemplateItem[] = [
  { step: "payment", title: "Sales contract signed by both", tool: "upload", route: "bank_contract", sort: 15 },
  { step: "payment", title: "Sales contract signed by both", tool: "upload", route: "letter_of_credit", sort: 15 },
  {
    step: "production",
    title: "Factory test run (FAT) with video",
    tool: "fill",
    fields: [fld("date", "Date", "date"), fld("result", "Result"), fld("video", "Video", "file")],
    sort: 40,
  },
  ...(["letter_of_credit", "bank_contract"] as const).map((route): ChecklistTemplateItem => ({
    step: "production",
    title: "Pre-shipment inspection",
    tool: "fill",
    fields: [fld("inspector", "Inspector"), fld("date", "Date", "date"), fld("result", "Passed or not")],
    route,
    sort: 50,
  })),
  { step: "shipping", title: "Shipping advice to the customer", tool: "send", paper: "shipping-advice", sort: 50 },
];

/* ---------------------------------------------------------------- the steps */

export type StepState = "done" | "now" | "late" | "todo";

export const STEP_STATE_LABEL: Record<StepState, string> = { done: "Done", now: "Now", late: "Late", todo: "Later" };

/** What a step's state is worked out from: its items, each done (or skipped) or open, late or not. */
export interface StepItemState {
  done: boolean;
  skipped?: boolean;
  late?: boolean;
}

export const itemClosed = (i: StepItemState) => i.done || !!i.skipped;

/** "3 of 8": skipped items count as done. */
export function stepProgress(items: StepItemState[]) {
  return { done: items.filter(itemClosed).length, total: items.length };
}

/**
 * A step's state: done when every item is done or skipped; late when an open
 * item is past its date; now when it is the order's current step (the first not
 * done); later otherwise.
 */
export function stepState(items: StepItemState[], current: boolean): StepState {
  if (items.every(itemClosed)) return "done";
  if (items.some((i) => !itemClosed(i) && i.late)) return "late";
  return current ? "now" : "todo";
}

/**
 * The steps' states in order: the first step with something open is the
 * current one ("now"); a cancelled order has none.
 */
export function stepStates<T extends StepItemState>(steps: { key: FlowStep; items: T[] }[], cancelled = false): StepState[] {
  const current = cancelled ? -1 : steps.findIndex((s) => !s.items.every(itemClosed));
  return steps.map((s, i) => stepState(s.items, i === current));
}

/** "Do this now": the first open item of the current step, late ones first. Null when everything is done. */
export function doNow<T extends StepItemState>(
  steps: { key: FlowStep; items: T[] }[],
  cancelled = false,
): { step: FlowStep; item: T } | null {
  if (cancelled) return null;
  const s = steps.find((x) => !x.items.every(itemClosed));
  if (!s) return null;
  const open = s.items.filter((i) => !itemClosed(i));
  const item = open.find((i) => i.late) ?? open[0]!;
  return { step: s.key, item };
}

export const stepNumber = (step: FlowStep) => FLOW_STEPS.indexOf(step) + 1;
export const stepLabel = (step: FlowStep) => FLOW_STEP_LABEL[step];

/** The step an automatic key belongs to. */
export function stepOfKey(key: string): FlowStep | null {
  if (key.startsWith("doc:") || key.startsWith("bank:")) return "documents";
  for (const s of FLOW_STEPS) if (AUTO_ITEMS[s].some((d) => d.key === key)) return key === "closed" ? null : s;
  return null;
}

/* ---------------------------------------------------------------- where a step stands */

/**
 * One plain line under a step's name on its page and its card: where the step
 * stands in the order's own words ("Ready 2027-01-07 · day 24 of 60",
 * "Deposit received · balance through the LC"), never a count of the
 * checklist (the header already says "n of m done"). Empty when there is
 * nothing useful to say. Dates are YYYY-MM-DD (the screens show them their way).
 */
export function stepLine(
  step: FlowStep,
  f: ChecklistFacts,
  items: { key: string | null; title: string; done: boolean; skipped: boolean }[],
  today: ISODate,
): string {
  const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" · ");
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  switch (step) {
    case "payment": {
      if (f.paidInFullOn) return `Paid in full ${f.paidInFullOn}`;
      const balance =
        f.route === "letter_of_credit"
          ? "balance through the LC"
          : f.route === "bank_contract"
            ? "balance through the bank contract"
            : f.route === null
              ? "route not chosen"
              : `balance ${money(f.currency, f.due)} due`;
      if (f.depositIn) return f.depositPercent > 0 ? join(`Deposit received${f.depositOn ? ` ${f.depositOn}` : ""}`, balance) : balance;
      if (f.route === null) return "Choose how the customer pays";
      return f.depositPercent > 0 ? `Waiting for the deposit, ${money(f.currency, f.deposit)}` : `Waiting for ${money(f.currency, f.due)}`;
    }
    case "factory":
      return f.factoryOrderedOn
        ? join(`Ordered ${f.factoryOrderedOn}`, f.readyOn ? `ready ${f.readyOn}` : "ready date not given yet")
        : "Not ordered from the factory yet";
    case "production": {
      const allIn = f.goods.lines > 0 && f.goods.received >= f.goods.lines;
      if (allIn) return "Everything has come in from the factory";
      const goods = f.goods.received > 0 ? `${f.goods.received} of ${plural(f.goods.lines, "item")} in` : null;
      if (!f.readyOn) return join(f.factoryOrderedOn ? "Ready date not known yet" : null, goods);
      const late = daysBetween(f.readyOn, today);
      if (late > 0) return join(`Ready ${f.readyOn}`, `${plural(late, "day")} late`, goods);
      const lead = f.factoryOrderedOn ? daysBetween(f.factoryOrderedOn, f.readyOn) : 0;
      const day = f.factoryOrderedOn ? daysBetween(f.factoryOrderedOn, today) : 0;
      return join(`Ready ${f.readyOn}`, lead > 0 && day >= 0 ? `day ${day} of ${lead}` : null, goods);
    }
    case "shipping": {
      const s = f.shipments;
      if (!s.length) {
        if (f.shippedOn) return join(`Shipped ${f.shippedOn}`, f.blNo && `B/L ${f.blNo}`);
        return f.packedAt && f.packing ? join("Packing list made", plural(f.packing.packages, "package")) : "";
      }
      const arrived = s.filter((x) => x.arrivedOn).map((x) => x.arrivedOn!).sort();
      if (arrived.length === s.length) return `Arrived ${arrived.at(-1)}`;
      const going = s.find((x) => x.departedOn && !x.arrivedOn);
      if (going) return join(`Sailed ${going.departedOn}`, going.eta && `ETA ${going.eta}`);
      const booked = s.find((x) => x.status !== "planned");
      if (booked)
        return join(
          `${SHIP_MODE_LABEL[booked.mode]}${booked.portOfDischarge ? ` to ${booked.portOfDischarge}` : ""}`,
          booked.forwarder,
          booked.etd && `ETD ${booked.etd}`,
        );
      return "Planned, not booked yet";
    }
    case "documents": {
      const papers = items.filter((i) => i.key?.startsWith("doc:"));
      const open = papers.filter((i) => !i.done && !i.skipped).map((i) => i.title);
      const lastBank = [...f.bankSteps].sort((a, b) => a.doneOn.localeCompare(b.doneOn)).at(-1);
      return join(
        open.length
          ? `Still to come: ${open.slice(0, 2).join(", ")}${open.length > 2 ? ` and ${open.length - 2} more` : ""}`
          : papers.length
            ? "Every paper is ready"
            : null,
        lastBank && `${BANK_STEP_LABEL[lastBank.step]} ${lastBank.doneOn}`,
      );
    }
    case "delivery": {
      if (f.closedOn) return `Closed ${f.closedOn}`;
      if (f.claims.open) return plural(f.claims.open, "open claim");
      if (f.satDoneOn) return `SAT signed off ${f.satDoneOn}`;
      if (f.deliveredOn) return join(`Delivered ${f.deliveredOn}`, "SAT to do");
      const arrived = f.shipments.filter((x) => x.arrivedOn).map((x) => x.arrivedOn!).sort().at(-1);
      return arrived ? join(`Arrived ${arrived}`, "not delivered yet") : "";
    }
  }
}

/* ---------------------------------------------------------------- history per step */

/**
 * The step a change in the order's history belongs to, for "Changes in this
 * step" and the history's step filter. Null: the order as a whole.
 */
export function STEP_OF_ACTION(action: string, newValues?: unknown): FlowStep | null {
  const nv = (newValues && typeof newValues === "object" ? newValues : {}) as Record<string, unknown>;
  const step = typeof nv.step === "string" && (FLOW_STEPS as readonly string[]).includes(nv.step) ? (nv.step as FlowStep) : null;
  if (action.startsWith("checklist.") || action.startsWith("paper.") || action.startsWith("file.")) return step;
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

/** An automatic item's name from its key ("doc:insurance" → "Insurance certificate"), for history and reminders. */
export function autoTitle(key: string): string {
  if (key.startsWith("doc:")) return ORDER_DOCUMENT_LABEL[key.slice(4) as OrderDocumentKind] ?? key;
  if (key.startsWith("bank:")) return BANK_STEP_LABEL[key.slice(5) as BankStepKind] ?? key;
  for (const s of FLOW_STEPS) {
    const d = AUTO_ITEMS[s].find((x) => x.key === key);
    if (d) return d.title;
  }
  return key;
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
