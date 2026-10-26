import { splitDeposit, formatMinor, type Minor } from "@kebo/money";
import { addDays, daysBetween, maxDate, type ISODate } from "@kebo/utils";
import type { BalanceTerms, MilestoneKey, MilestoneStatus, OrderStage, OrderStatus, Team } from "../enums";

/**
 * The order checklist: every won deal gets the same steps, in the order the
 * payment terms dictate, each with a due date worked out from what has really
 * happened so far. "What do I do next?" is always the first step not yet done.
 * Nothing here touches the database, so the API, the web and the reminder job
 * all show exactly the same plan.
 */

/** What the plan needs to know about the order. */
export interface OrderFacts {
  status: OrderStatus;
  /** The day the customer accepted (the order date). */
  orderedOn: ISODate;
  /** Ship date promised to the customer, if any. */
  shipBy: ISODate | null;
  /** Ready date the factory confirmed, if any. */
  readyOn: ISODate | null;
  currency: string;
  totalMinor: Minor;
  depositPercent: number;
  balanceTerms: BalanceTerms;
  /** Received from the customer so far (incl. bank charges), for the amount hints. */
  customerSettledMinor?: Minor;
}

export interface MilestoneState {
  key: MilestoneKey;
  status: MilestoneStatus;
  doneOn: ISODate | null;
  /** A due date someone typed in, replacing the calculated one. */
  dueOverride?: ISODate | null;
}

/** Days between steps. Defaults suit a typical 30/70 T/T export order; Settings can change them. */
export interface PlanSettings {
  proformaDays: number;
  depositDays: number;
  factoryOrderDays: number;
  factoryDepositDays: number;
  factoryConfirmDays: number;
  samplesDays: number;
  /** Inspect this many days before the ready / ship date. */
  inspectionLeadDays: number;
  /** Pay the factory balance this many days before shipping. */
  factoryBalanceLeadDays: number;
  /** Balance due this many days after shipping (B/L copy, L/C). */
  balanceAfterShipDays: number;
  /** Balance due this many days after shipping when it is paid on arrival. */
  balanceAfterArrivalDays: number;
  documentsDays: number;
  vatInvoiceDays: number;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  proformaDays: 1,
  depositDays: 5,
  factoryOrderDays: 2,
  factoryDepositDays: 2,
  factoryConfirmDays: 3,
  samplesDays: 10,
  inspectionLeadDays: 3,
  factoryBalanceLeadDays: 2,
  balanceAfterShipDays: 5,
  balanceAfterArrivalDays: 35,
  documentsDays: 2,
  vatInvoiceDays: 30,
};

/** The form the UI should open to record a step (the step and the record are saved together). */
export type StepRecord = "invoice" | "payment_in" | "factory_order" | "payment_out" | "ready_date" | "inspection" | "shipment" | "note";

export interface StepDef {
  key: MilestoneKey;
  title: string;
  /** Shown when done, e.g. "Deposit received". */
  doneTitle: string;
  team: Team;
  /** Can be skipped without special permission (e.g. no samples on a repeat order). */
  optional: boolean;
  records: StepRecord;
}

export const STEPS: Record<MilestoneKey, StepDef> = {
  proforma_sent: { key: "proforma_sent", title: "Send the proforma invoice", doneTitle: "Proforma invoice sent", team: "sales", optional: false, records: "invoice" },
  customer_deposit: { key: "customer_deposit", title: "Get the customer's deposit", doneTitle: "Deposit received", team: "accounts", optional: false, records: "payment_in" },
  factory_order: { key: "factory_order", title: "Place the order with the factory", doneTitle: "Factory order placed", team: "sourcing", optional: false, records: "factory_order" },
  factory_deposit: { key: "factory_deposit", title: "Pay the factory deposit", doneTitle: "Factory deposit paid", team: "accounts", optional: false, records: "payment_out" },
  factory_confirmed: { key: "factory_confirmed", title: "Get the factory to confirm the ready date", doneTitle: "Ready date confirmed", team: "sourcing", optional: false, records: "ready_date" },
  samples_approved: { key: "samples_approved", title: "Get the samples approved", doneTitle: "Samples approved", team: "sourcing", optional: true, records: "note" },
  inspection_passed: { key: "inspection_passed", title: "Inspect the goods before shipping", doneTitle: "Inspection passed", team: "sourcing", optional: true, records: "inspection" },
  customer_balance: { key: "customer_balance", title: "Get the customer's balance", doneTitle: "Balance received", team: "accounts", optional: false, records: "payment_in" },
  factory_balance: { key: "factory_balance", title: "Pay the factory balance", doneTitle: "Factory paid in full", team: "accounts", optional: false, records: "payment_out" },
  shipped: { key: "shipped", title: "Ship the goods", doneTitle: "Shipped", team: "logistics", optional: false, records: "shipment" },
  documents_released: { key: "documents_released", title: "Release the original documents (B/L)", doneTitle: "Documents released", team: "logistics", optional: false, records: "note" },
  factory_vat_invoice: { key: "factory_vat_invoice", title: "Get the factory's VAT invoice (fapiao)", doneTitle: "VAT invoice received", team: "accounts", optional: true, records: "note" },
};

/** Balance collected after the goods leave (the shipping step comes first). */
const balanceAfterShipping = (terms: BalanceTerms) => terms !== "before_shipment";

/** The steps of an order, in order, for its payment terms. */
export function planFor(terms: BalanceTerms): MilestoneKey[] {
  const start: MilestoneKey[] = ["proforma_sent", "customer_deposit", "factory_order", "factory_deposit", "factory_confirmed", "samples_approved", "inspection_passed"];
  const middle: MilestoneKey[] = balanceAfterShipping(terms)
    ? ["factory_balance", "shipped", "customer_balance"]
    : ["customer_balance", "factory_balance", "shipped"];
  return [...start, ...middle, "documents_released", "factory_vat_invoice"];
}

/** The steps a new order starts with: a 0% deposit means there is no deposit step to wait for. */
export function initialStates(facts: Pick<OrderFacts, "depositPercent" | "balanceTerms">): MilestoneState[] {
  return planFor(facts.balanceTerms).map((key) => ({
    key,
    status: key === "customer_deposit" && facts.depositPercent <= 0 ? "skipped" : "todo",
    doneOn: null,
  }));
}

/* ---------------------------------------------------------------- gates */

export interface Gate {
  requires: MilestoneKey;
  code: string;
  message: string;
}

/** Steps that must wait for another (money in before money out; inspect before shipping). */
export function gatesFor(key: MilestoneKey, terms: BalanceTerms): Gate[] {
  switch (key) {
    case "factory_deposit":
      return [{ requires: "customer_deposit", code: "deposit_first", message: "Wait for the customer's deposit before paying the factory." }];
    case "shipped": {
      const gates: Gate[] = [{ requires: "inspection_passed", code: "inspect_first", message: "Pass (or skip) the inspection before shipping." }];
      if (terms === "before_shipment")
        gates.push({ requires: "customer_balance", code: "balance_first", message: "The terms say the balance is paid before shipment." });
      return gates;
    }
    case "documents_released":
      // Under a letter of credit the documents go through the banks, which release them against payment.
      return terms === "letter_of_credit"
        ? []
        : [{ requires: "customer_balance", code: "balance_first", message: "Release the original documents only after the balance is received." }];
    default:
      return [];
  }
}

const settled = (s: MilestoneState | undefined) => !!s && s.status !== "todo";

/** Steps already done that were allowed only because `key` was settled (undoing `key` would break their gate). */
export function doneDependents(key: MilestoneKey, terms: BalanceTerms, states: MilestoneState[]): MilestoneKey[] {
  return planFor(terms).filter((k) => gatesFor(k, terms).some((g) => g.requires === key) && states.find((s) => s.key === k)?.status === "done");
}

/** The gates still closed for a step (empty = it can be done now). */
export function openGates(key: MilestoneKey, terms: BalanceTerms, states: MilestoneState[]): Gate[] {
  return gatesFor(key, terms).filter((g) => !settled(states.find((s) => s.key === g.requires)));
}

/* ---------------------------------------------------------------- due dates */

type DueMap = Partial<Record<MilestoneKey, ISODate | null>>;

/** Due dates for every step: each from its anchor step's done date, or that step's own due date while it is still to do. */
export function dueDates(facts: OrderFacts, states: MilestoneState[], cfg: PlanSettings = DEFAULT_PLAN_SETTINGS): DueMap {
  const state = (k: MilestoneKey) => states.find((s) => s.key === k);
  const due: DueMap = {};
  const at = (k: MilestoneKey): ISODate | null => {
    const s = state(k);
    if (s?.status === "done" && s.doneOn) return s.doneOn;
    return due[k] ?? null;
  };
  const after = (k: MilestoneKey, days: number) => {
    const base = at(k);
    return base ? addDays(base, days) : null;
  };
  /** The day goods should be ready: the factory's date, else a few days before the promised ship date. */
  const ready = facts.readyOn ?? (facts.shipBy ? addDays(facts.shipBy, -cfg.inspectionLeadDays) : null);
  const shipDay = facts.shipBy ?? (facts.readyOn ? addDays(facts.readyOn, cfg.inspectionLeadDays) : null);

  for (const key of planFor(facts.balanceTerms)) {
    let d: ISODate | null;
    switch (key) {
      case "proforma_sent":
        d = addDays(facts.orderedOn, cfg.proformaDays);
        break;
      case "customer_deposit":
        d = after("proforma_sent", cfg.depositDays);
        break;
      case "factory_order":
        d = state("customer_deposit")?.status === "skipped" ? after("proforma_sent", cfg.factoryOrderDays) : after("customer_deposit", cfg.factoryOrderDays);
        break;
      case "factory_deposit":
        d = after("factory_order", cfg.factoryDepositDays);
        break;
      case "factory_confirmed":
        d = after("factory_order", cfg.factoryConfirmDays);
        break;
      case "samples_approved":
        d = after("factory_confirmed", cfg.samplesDays);
        break;
      case "inspection_passed":
        d = ready;
        break;
      case "factory_balance":
        d = shipDay ? addDays(shipDay, -cfg.factoryBalanceLeadDays) : null;
        break;
      case "shipped":
        d = shipDay;
        break;
      case "customer_balance":
        d =
          facts.balanceTerms === "before_shipment"
            ? ready
            : after("shipped", facts.balanceTerms === "after_arrival" ? cfg.balanceAfterArrivalDays : cfg.balanceAfterShipDays);
        break;
      case "documents_released":
        // The originals go out after the goods have left, and (except under an L/C) after the balance is in.
        d = facts.balanceTerms === "letter_of_credit" ? after("shipped", cfg.documentsDays) : maxDate(after("customer_balance", cfg.documentsDays), after("shipped", cfg.documentsDays));
        break;
      case "factory_vat_invoice":
        d = after("shipped", cfg.vatInvoiceDays);
        break;
    }
    due[key] = state(key)?.dueOverride ?? d;
  }
  return due;
}

/* ---------------------------------------------------------------- the plan as people see it */

export interface PlannedStep extends StepDef {
  status: MilestoneStatus;
  doneOn: ISODate | null;
  due: ISODate | null;
  /** Days until due (negative = late); null without a due date or once done. */
  dueInDays: number | null;
  overdue: boolean;
  /** The first gate still closed, if any. */
  blockedBy: Gate | null;
  /** One concrete line: amounts and dates for this deal. */
  hint: string | null;
}

export interface OrderPlan {
  stage: OrderStage;
  steps: PlannedStep[];
  /** What to do now: the first step still to do that is not waiting on another. */
  next: PlannedStep | null;
  done: number;
  total: number;
  overdue: number;
  /** Every step is done or skipped: the order can close. */
  complete: boolean;
}

function hintFor(key: MilestoneKey, facts: OrderFacts, due: DueMap): string | null {
  const fmt = (m: Minor) => formatMinor(m, facts.currency);
  const { deposit, balance } = splitDeposit(facts.totalMinor, facts.depositPercent);
  const paid = facts.customerSettledMinor ?? 0;
  switch (key) {
    case "customer_deposit": {
      const missing = Math.max(deposit - paid, 0);
      return `${facts.depositPercent}% deposit: ${fmt(deposit)}${paid > 0 && missing > 0 ? ` (${fmt(missing)} still to come)` : ""}`;
    }
    case "customer_balance": {
      const missing = Math.max(facts.totalMinor - paid, 0);
      return `Balance: ${fmt(paid > 0 ? missing : balance)} of ${fmt(facts.totalMinor)}`;
    }
    case "factory_confirmed":
      return facts.readyOn ? `Factory says ready on ${facts.readyOn}` : "Ask the factory for a firm ready date";
    case "shipped":
      return facts.shipBy ? `Promised to ship by ${facts.shipBy}` : due.shipped ? null : "Set the promised ship date on the order";
    default:
      return null;
  }
}

function stageOf(facts: OrderFacts, states: MilestoneState[], complete: boolean): OrderStage {
  if (facts.status === "cancelled") return "cancelled";
  if (facts.status === "closed" || complete) return "closed";
  const s = (k: MilestoneKey) => states.find((x) => x.key === k);
  if (s("shipped")?.status === "done") return "shipped";
  if (!settled(s("customer_deposit"))) return "awaiting_deposit";
  if (settled(s("factory_confirmed")) && settled(s("inspection_passed"))) return "ready_to_ship";
  return "in_production";
}

/** The whole checklist for an order, with due dates, overdue flags, gates and the next step. */
export function orderPlan(facts: OrderFacts, states: MilestoneState[], today: ISODate, cfg: PlanSettings = DEFAULT_PLAN_SETTINGS): OrderPlan {
  const due = dueDates(facts, states, cfg);
  const steps: PlannedStep[] = planFor(facts.balanceTerms).map((key) => {
    const s = states.find((x) => x.key === key) ?? { key, status: "todo" as const, doneOn: null };
    const d = due[key] ?? null;
    const todo = s.status === "todo";
    const dueInDays = todo && d ? daysBetween(today, d) : null;
    return {
      ...STEPS[key],
      status: s.status,
      doneOn: s.doneOn,
      due: d,
      dueInDays,
      overdue: todo && dueInDays !== null && dueInDays < 0,
      blockedBy: todo ? (openGates(key, facts.balanceTerms, states)[0] ?? null) : null,
      hint: todo ? hintFor(key, facts, due) : null,
    };
  });
  const active = facts.status === "open";
  const todo = steps.filter((s) => s.status === "todo");
  const complete = todo.length === 0;
  return {
    stage: stageOf(facts, states, complete),
    steps,
    next: active ? (todo.find((s) => !s.blockedBy) ?? todo[0] ?? null) : null,
    done: steps.length - todo.length,
    total: steps.length,
    overdue: active ? todo.filter((s) => s.overdue).length : 0,
    complete,
  };
}

/* ---------------------------------------------------------------- changing a step */

export type StepAction = "done" | "skip" | "undo";

/**
 * Whether a person may do this to a step, and why not. Gates and skipping a
 * required step can be overridden by someone with the override permission,
 * who must then write why (kept in the history).
 */
export function checkStepAction(
  key: MilestoneKey,
  action: StepAction,
  ctx: { terms: BalanceTerms; states: MilestoneState[]; orderStatus: OrderStatus; canOverride: boolean; note?: string | null },
): { ok: true; overridden: boolean } | { ok: false; code: string; message: string } {
  if (ctx.orderStatus !== "open") return { ok: false, code: "order_not_open", message: "This order is closed or cancelled. Reopen it to change its steps." };
  const current = ctx.states.find((s) => s.key === key);
  if (!current) return { ok: false, code: "unknown_step", message: "This step is not part of the order." };
  if (action === "undo") {
    if (current.status === "todo") return { ok: false, code: "not_done", message: "This step is still to do." };
    const dependents = doneDependents(key, ctx.terms, ctx.states);
    if (dependents.length === 0) return { ok: true, overridden: false };
    if (!ctx.canOverride) {
      return { ok: false, code: "dependents_done", message: `Undo "${STEPS[dependents[0]].doneTitle}" first: it was allowed because this step was done.` };
    }
    return ctx.note?.trim() ? { ok: true, overridden: true } : { ok: false, code: "note_required", message: "Write why this step is being undone while later steps stay done." };
  }
  if (current.status !== "todo") return { ok: false, code: "already_done", message: "This step is already done or skipped." };

  let overridden = false;
  if (action === "skip" && !STEPS[key].optional) {
    if (!ctx.canOverride) return { ok: false, code: "required_step", message: "Only a manager can skip a required step." };
    overridden = true;
  }
  if (action === "done") {
    const gate = openGates(key, ctx.terms, ctx.states)[0];
    if (gate) {
      if (!ctx.canOverride) return { ok: false, code: gate.code, message: gate.message };
      overridden = true;
    }
  }
  if (overridden && !ctx.note?.trim()) return { ok: false, code: "note_required", message: "Write why this step is being skipped or done out of order." };
  return { ok: true, overridden };
}
