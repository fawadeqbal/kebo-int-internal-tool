import { BALANCE_TERMS_LABEL, ORDER_STAGE_LABEL, STAGE_FLOW, type OrderStage } from "@kebo/shared";
import { date, money } from "@/lib/format";
import type { FactoryOwed } from "@/lib/types-money";
import type { OrderView, PaymentsView } from "@/lib/types-orders";

/** The order's tabs (the overview is the order's own address). */
export type OrderTab = "" | "goods" | "packing" | "money" | "documents" | "history";

/**
 * done: recorded · now: the one to do next · late: the one to do next, past its date ·
 * missed: an earlier stage went by without it (not recorded) · todo: still to come.
 */
export type CheckState = "done" | "now" | "late" | "missed" | "todo";

export interface Checkpoint {
  key: string;
  label: string;
  detail: string | null;
  state: CheckState;
  tab: OrderTab;
  /** What the button in the Now bar says when this is the one to do. */
  action: string;
}

export interface StageProgress {
  stage: OrderStage;
  label: string;
  state: "done" | "current" | "todo";
  /** "done 15 Oct", "2 of 4 · since 15 Oct", "0 of 4". */
  summary: string;
  checkpoints: Checkpoint[];
}

type Draft = Omit<Checkpoint, "state"> & { done: boolean; stage: OrderStage };

/** The first payment date by which the money received reached `target` (deposit, or the whole total). */
function reachedOn(payments: PaymentsView["payments"], target: number): string | null {
  let sum = 0;
  for (const p of [...payments].filter((x) => !x.voided).sort((a, b) => a.paidOn.localeCompare(b.paidOn))) {
    sum += Number(p.amount) + Number(p.bankCharges);
    if (sum >= target - 0.005) return p.paidOn;
  }
  return null;
}

/**
 * Every checkpoint of an order, under its four stages, worked out from what is
 * already recorded: nothing is ticked by hand. Where the balance sits follows
 * the payment terms; the factory payments are only there for people who see
 * factory costs (`factories` is null for the others).
 */
export function orderProgress(o: OrderView, p: PaymentsView, factories: FactoryOwed[] | null): StageProgress[] {
  // What the order needs now (the same rule the reminders use) points at its checkpoint.
  const t = o.needs?.title ?? "";
  const focus = /deposit/i.test(t) && !/is in/i.test(t)
    ? "deposit"
    : /ready date/i.test(t)
      ? "ready"
      : /packing list/i.test(t)
        ? "packed"
        : /goods/i.test(t)
          ? "goods"
          : /balance/i.test(t)
            ? "balance"
            : null;
  const at = STAGE_FLOW.indexOf(o.stage);
  const cur = o.currency;
  const closed = o.status === "closed" || o.stage === "done";
  const stageDate = (s: OrderStage): string | null => {
    if (s === "confirmed") return o.orderedOn;
    if (s === "shipped" && o.shippedOn) return o.shippedOn;
    return o.history.findLast((h) => h.to === s)?.at ?? null;
  };
  const due = Number(o.money.due);
  const balanceDone = due <= 0.005;
  const fullOn = balanceDone ? reachedOn(p.payments, Number(o.money.total)) : null;
  const balance: Omit<Draft, "stage"> = {
    key: "balance",
    label: "Balance received",
    detail: balanceDone ? `paid in full${fullOn ? ` · ${date(fullOn)}` : ""}` : `${money(o.money.due, cur)} · ${BALANCE_TERMS_LABEL[o.balanceTerms].toLowerCase().replace(/^balance /, "")}`,
    done: balanceDone,
    tab: "money",
    action: "Record a payment",
  };
  const rows = factories?.filter((f) => Number(f.owed) > 0) ?? null;
  const factoryNote = (f: FactoryOwed[], what: (x: FactoryOwed) => string) => (f.length === 1 ? what(f[0]!) : `${f.length} factories`);

  const list: Draft[] = [
    { stage: "confirmed", key: "made", label: "Order made", detail: date(o.orderedOn), done: true, tab: "", action: "" },
    {
      stage: "confirmed",
      key: "proforma",
      label: "Proforma issued",
      detail: o.proforma ? `${o.proforma.number}${o.proforma.issuedOn ? ` · ${date(o.proforma.issuedOn)}` : ""}` : "still a draft",
      done: !!o.proforma,
      tab: "documents",
      action: "Issue the proforma",
    },
  ];
  if (o.depositPercent > 0) {
    const ok = Number(o.money.depositDue) <= 0.005;
    const on = ok ? reachedOn(p.payments, Number(o.money.deposit)) : null;
    list.push({
      stage: "confirmed",
      key: "deposit",
      label: "Deposit received",
      detail: ok ? `${money(o.money.deposit, cur)}${on ? ` · ${date(on)}` : ""}` : `${money(o.money.depositDue, cur)} to come`,
      done: ok,
      tab: "money",
      action: "Record a payment",
    });
  }
  if (rows && rows.length)
    list.push({
      stage: "confirmed",
      key: "factory-deposit",
      label: "Factory deposit paid",
      detail: rows.every((f) => Number(f.paid) > 0) ? factoryNote(rows, (f) => `${money(f.paid, f.currency)} paid`) : factoryNote(rows, (f) => `${f.factory.name}: nothing paid yet`),
      done: rows.every((f) => Number(f.paid) > 0),
      tab: "money",
      action: "Pay the factory",
    });

  const started = at >= 1 ? stageDate("in_production") : null;
  list.push({ stage: "in_production", key: "started", label: "Production started", detail: started ? date(started) : null, done: at >= 1, tab: "", action: "" });
  list.push({ stage: "in_production", key: "ready", label: "Ready date from the factory", detail: o.readyOn ? date(o.readyOn) : "not given yet", done: !!o.readyOn, tab: "", action: "Set the ready date" });
  if (o.goods.lines > 0) {
    list.push({
      stage: "in_production",
      key: "goods",
      label: "Goods received",
      detail: o.goods.allReceived ? `all ${o.goods.lines} line${o.goods.lines === 1 ? "" : "s"} in` : `${o.goods.received} of ${o.goods.lines} line${o.goods.lines === 1 ? "" : "s"} complete`,
      done: o.goods.allReceived,
      tab: "goods",
      action: "Record goods",
    });
    list.push({ stage: "in_production", key: "packed", label: "Packed", detail: o.goods.packedAt ? date(o.goods.packedAt) : "packing list not made", done: o.goods.packed, tab: "packing", action: "Make the packing list" });
  }

  if (o.balanceTerms === "before_shipment") list.push({ ...balance, stage: "shipped" });
  if (rows && rows.length)
    list.push({
      stage: "shipped",
      key: "factory-balance",
      label: "Factory paid in full",
      detail: rows.every((f) => Number(f.toPay) <= 0) ? "nothing left to pay" : factoryNote(rows, (f) => `${money(f.toPay, f.currency)} to pay`),
      done: rows.every((f) => Number(f.toPay) <= 0),
      tab: "money",
      action: "Pay the factory",
    });
  list.push({ stage: "shipped", key: "shipped", label: "Shipped", detail: o.shippedOn ? date(o.shippedOn) : null, done: at >= 2 && !!o.shippedOn, tab: "", action: "" });
  list.push({ stage: "shipped", key: "bl", label: "B/L number", detail: o.blNo ?? null, done: !!o.blNo, tab: "", action: "Add the B/L number" });
  if (o.balanceTerms === "against_bl_copy") list.push({ ...balance, stage: "shipped" });
  if (o.balanceTerms === "after_arrival" || o.balanceTerms === "letter_of_credit") list.push({ ...balance, stage: "done" });
  const doneOn = closed ? stageDate("done") : null;
  list.push({ stage: "done", key: "closed", label: "Order closed", detail: doneOn ? date(doneOn) : null, done: closed, tab: "", action: "" });

  // The one to do now: the first open checkpoint of the current stage (the balance too once shipped, wherever the terms put it).
  // When the stage has nothing left, the Now bar's button is the move to the next stage.
  const live = o.status !== "cancelled";
  const focused = focus ? list.findIndex((c) => c.key === focus && !c.done) : -1;
  const nowIndex = !live
    ? -1
    : focused >= 0
      ? focused
      : list.findIndex((c) => !c.done && c.action && (STAGE_FLOW.indexOf(c.stage) === at || (c.key === "balance" && at >= 2)));
  const states: Checkpoint[] = list.map((c, i) => ({
    key: c.key,
    label: c.label,
    detail: c.detail,
    tab: c.tab,
    action: c.action,
    state: c.done ? "done" : i === nowIndex ? (o.needs?.late ? "late" : "now") : STAGE_FLOW.indexOf(c.stage) < at ? "missed" : "todo",
  }));

  return STAGE_FLOW.map((s, i) => {
    const cps = states.filter((_, k) => list[k]!.stage === s);
    const doneCount = cps.filter((c) => c.state === "done").length;
    const state: StageProgress["state"] = i < at || (i === at && s === "done" && closed) ? "done" : i === at ? "current" : "todo";
    const next = STAGE_FLOW[i + 1];
    const finishedOn = state === "done" ? (next ? stageDate(next) : doneOn) : null;
    const since = i === at ? o.stageSince : null;
    return {
      stage: s,
      label: ORDER_STAGE_LABEL[s],
      state,
      summary:
        state === "done"
          ? `done${finishedOn ? ` ${date(finishedOn)}` : ""}${doneCount < cps.length ? ` · ${cps.length - doneCount} not recorded` : ""}`
          : state === "current"
            ? `${doneCount} of ${cps.length}${since ? ` · since ${date(since)}` : ""}`
            : `${doneCount} of ${cps.length}`,
      checkpoints: cps,
    };
  });
}
