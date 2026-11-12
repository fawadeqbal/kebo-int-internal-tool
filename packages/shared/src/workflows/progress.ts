import { FLOW_STEPS, type FlowStep } from "./flow";

/**
 * Where an order stands, read from its to-do items (the order page's one line
 * of steps): each step is done, part done, now, late, waiting (and says what
 * for) — more than one step can be "now" — and the order's status in words
 * comes from the same items, so the two cannot disagree.
 */
export type ProgressState = "done" | "part" | "now" | "late" | "wait";

export interface ProgressItem {
  step: FlowStep;
  /** The automatic item's key; null for the company's own items. */
  key: string | null;
  done: boolean;
  skipped?: boolean;
  late?: boolean;
  dueOn?: string | null;
  sort?: number;
}

/** What an automatic item waits for: the key that comes first, and how the wait reads. */
const WAITS: Record<string, { on: string; text: string }> = {
  contract: { on: "route", text: "After the route is chosen" },
  factory_ordered: { on: "deposit_in", text: "After the deposit" },
  factory_advance: { on: "factory_ordered", text: "After the factory order" },
  ready_date: { on: "factory_ordered", text: "After the factory order" },
  factory_paid: { on: "ready_date", text: "After the ready date" },
  goods_received: { on: "factory_ordered", text: "After the factory order" },
  booked: { on: "factory_ordered", text: "After the factory order" },
  packing_list: { on: "goods_received", text: "After the goods are in" },
  loaded: { on: "booked", text: "After the booking" },
  sailed: { on: "loaded", text: "After loading" },
  shipped: { on: "goods_received", text: "After the goods are in" },
  arrived: { on: "sailed", text: "After it sails" },
  balance_in: { on: "deposit_in", text: "After the deposit" },
  delivered: { on: "arrived", text: "After arrival" },
  sat_done: { on: "delivered", text: "After delivery" },
  claims_closed: { on: "delivered", text: "After delivery" },
};

/** What a whole step waits for (its own items, the papers and the bank steps). */
const STEP_WAITS: Partial<Record<FlowStep, { on: string[]; text: string }>> = {
  factory: { on: ["deposit_in"], text: "After the deposit" },
  production: { on: ["factory_ordered"], text: "After the factory order" },
  shipping: { on: ["factory_ordered"], text: "After the factory order" },
  documents: { on: ["sailed", "shipped"], text: "After it sails" },
  delivery: { on: ["arrived", "shipped"], text: "After arrival" },
};

const closed = (i: ProgressItem) => i.done || !!i.skipped;

export interface StepProgress {
  step: FlowStep;
  state: ProgressState;
  done: number;
  total: number;
  /** What the step waits for ("After it sails"); only when waiting or part done. */
  waits: string | null;
}

export interface OrderProgress<T extends ProgressItem> {
  steps: StepProgress[];
  /** What can be done today, in the order to do it: late first, then by due day, then by step. */
  open: T[];
  /** What waits for something else, each with what for. */
  waiting: { item: T; waits: string }[];
  /** Everything is done or left out. */
  finished: boolean;
}

/** The order's progress from its items. `steps`: the steps this order has, in order. */
export function orderProgress<T extends ProgressItem>(items: T[], steps: readonly FlowStep[] = FLOW_STEPS): OrderProgress<T> {
  const byKey = new Map(items.filter((i) => i.key).map((i) => [i.key!, i]));
  /** A key that is done, left out, or not on this order at all. */
  const met = (key: string) => {
    const i = byKey.get(key);
    return !i || closed(i);
  };
  /** Any of the keys on this order is done; none of them on it: nothing to wait for. */
  const anyMet = (keys: string[]) => {
    const here = keys.filter((k) => byKey.has(k));
    return !here.length || here.some(met);
  };
  const waitOf = (i: T): string | null => {
    const own = i.key ? WAITS[i.key] : undefined;
    if (own && !met(own.on)) return own.text;
    if (i.key === "closed") return items.some((x) => x !== i && !closed(x)) ? "After everything else" : null;
    // A bank step waits for the one before it; the company's own items, the papers and the rest wait with their step.
    if (i.key?.startsWith("bank:")) {
      const chain = items.filter((x) => x.key?.startsWith("bank:")).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      const before = chain[chain.indexOf(i) - 1];
      if (before && !closed(before)) return "After the bank step before it";
    }
    if (own) return null;
    const st = STEP_WAITS[i.step];
    return st && !anyMet(st.on) ? st.text : null;
  };

  const open: T[] = [];
  const waiting: { item: T; waits: string }[] = [];
  for (const i of items) {
    if (closed(i) || !steps.includes(i.step)) continue;
    const w = i.late ? null : waitOf(i);
    if (w) waiting.push({ item: i, waits: w });
    else open.push(i);
  }
  const order = (i: T) => steps.indexOf(i.step) * 10_000 + (i.sort ?? 0);
  open.sort((a, b) => Number(!!b.late) - Number(!!a.late) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || order(a) - order(b));

  const out: StepProgress[] = steps.map((step) => {
    const mine = items.filter((i) => i.step === step);
    const done = mine.filter(closed).length;
    const mineOpen = open.filter((i) => i.step === step);
    const mineWaiting = waiting.filter((w) => w.item.step === step);
    const state: ProgressState =
      done === mine.length ? "done" : mineOpen.some((i) => i.late) ? "late" : mineOpen.length ? "now" : done > 0 ? "part" : "wait";
    return { step, state, done, total: mine.length, waits: state === "wait" || state === "part" ? (mineWaiting[0]?.waits ?? null) : null };
  });
  return { steps: out, open, waiting, finished: items.length > 0 && items.every(closed) };
}

export type OrderStatusTone = "ok" | "warn" | "bad" | "neutral";

/**
 * The one word for where an order stands, the same on its own page, in the lists, on the board and on Home:
 * Confirmed → In production → Shipped → Arrived → Delivered → Done (or Cancelled). It is worked out from what
 * is stored (the day we ordered from the factory, the shipments, the delivery, closed), never typed, so two
 * screens cannot say different things about the same order.
 */
export type OrderWord = "Confirmed" | "In production" | "Shipped" | "Arrived" | "Delivered" | "Done" | "Cancelled";
export const ORDER_WORD_TONE: Record<OrderWord, "ok" | "info" | "warn" | "neutral"> = {
  Confirmed: "warn",
  "In production": "info",
  Shipped: "info",
  Arrived: "info",
  Delivered: "ok",
  Done: "ok",
  Cancelled: "neutral",
};

/** The board's column (and the list's chip) a word falls under: arrived and delivered orders are still under Shipped until closed. */
export const orderWordColumn = (w: OrderWord): "confirmed" | "in_production" | "shipped" | "done" =>
  w === "Confirmed" ? "confirmed" : w === "In production" ? "in_production" : w === "Done" || w === "Cancelled" ? "done" : "shipped";

export interface OrderWordFacts {
  status: "open" | "closed" | "cancelled";
  /** We ordered from the factory. */
  ordered: boolean;
  /** Each shipment: its status, and whether a day it left is recorded. */
  shipments: { status: string; left: boolean }[];
  delivered: boolean;
}

const LEFT_PORT = ["departed", "arrived", "cleared"];
const IN_PORT = ["arrived", "cleared"];

/** `features`: the company's modules (null: all on); a switched-off module's facts are not read, as in the to-do list. */
export function orderWord(f: OrderWordFacts, features: readonly string[] | null): OrderWord {
  const on = (m: string) => !features || features.includes(m);
  if (f.status === "cancelled") return "Cancelled";
  if (f.status === "closed") return "Done";
  if (on("delivery_sat") && f.delivered) return "Delivered";
  if (on("shipping")) {
    if (f.shipments.length > 0 && f.shipments.every((s) => IN_PORT.includes(s.status))) return "Arrived";
    if (f.shipments.some((s) => LEFT_PORT.includes(s.status))) return "Shipped";
  } else if (f.shipments.some((s) => s.left)) return "Shipped";
  return f.ordered ? "In production" : "Confirmed";
}

/**
 * The order's status in words: how far it is (the word, given by the API from the stored facts; without it,
 * read from the same items) and whether anything is late.
 */
export function orderStatusLine(
  items: ProgressItem[],
  o: { cancelled?: boolean; closed?: boolean; word?: OrderWord | null },
  today: string,
): { stage: string; note: string | null; tone: OrderStatusTone } {
  if (o.cancelled) return { stage: "Cancelled", note: null, tone: "bad" };
  const has = (k: string) => items.some((i) => i.key === k && i.done);
  const allDone = items.length > 0 && items.every(closed);
  if (o.closed || (!o.word && allDone)) return { stage: "Done", note: null, tone: "ok" };
  const stage =
    o.word ??
    (has("delivered") ? "Delivered" : has("arrived") ? "Arrived" : has("sailed") || has("shipped") ? "Shipped" : has("factory_ordered") ? "In production" : "Confirmed");
  // Everything ticked, the order not closed yet: the word stays what the facts say, with what is left to do.
  if (allDone) return { stage, note: "all done, close it", tone: "ok" };
  const late = items.filter((i) => !closed(i) && i.late);
  if (!late.length) return { stage, note: "on time", tone: "warn" };
  const days = Math.max(0, ...late.map((i) => (i.dueOn ? Math.round((Date.parse(today) - Date.parse(i.dueOn)) / 86_400_000) : 0)));
  return { stage, note: days > 0 ? `${days} day${days === 1 ? "" : "s"} late` : "late", tone: "bad" };
}
