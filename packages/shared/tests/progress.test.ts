import { describe, expect, it } from "vitest";
import { orderProgress, orderStatusLine, type ProgressItem } from "../src/workflows/progress";

const item = (step: ProgressItem["step"], key: string | null, done = false, more: Partial<ProgressItem> = {}): ProgressItem => ({ step, key, done, ...more });

/** An order just confirmed: nothing done. */
const fresh = (): ProgressItem[] => [
  item("payment", "route"),
  item("payment", "deposit_in"),
  item("factory", "factory_ordered"),
  item("factory", "factory_advance"),
  item("production", "ready_date"),
  item("production", null),
  item("production", "goods_received"),
  item("shipping", "booked"),
  item("shipping", "packing_list"),
  item("shipping", "loaded"),
  item("shipping", "sailed"),
  item("shipping", "arrived"),
  item("documents", "doc:bill_of_lading"),
  item("delivery", "delivered"),
  item("delivery", "sat_done"),
  item("delivery", "closed"),
];
const tick = (items: ProgressItem[], ...keys: string[]) => items.map((i) => (i.key && keys.includes(i.key) ? { ...i, done: true } : i));
const states = (items: ProgressItem[]) => Object.fromEntries(orderProgress(items).steps.map((s) => [s.step, s.state]));

describe("order progress", () => {
  it("starts with payment now and everything else waiting, each saying what for", () => {
    const p = orderProgress(fresh());
    expect(states(fresh())).toEqual({ payment: "now", factory: "wait", production: "wait", shipping: "wait", documents: "wait", delivery: "wait" });
    expect(p.steps.find((s) => s.step === "factory")!.waits).toBe("After the deposit");
    expect(p.steps.find((s) => s.step === "documents")!.waits).toBe("After it sails");
    expect(p.open.map((i) => i.key)).toEqual(["route", "deposit_in"]);
  });

  it("lets two steps be now at once", () => {
    const items = tick(fresh(), "route", "deposit_in", "factory_ordered", "factory_advance", "ready_date");
    expect(states(items)).toMatchObject({ payment: "done", factory: "done", production: "now", shipping: "now", documents: "wait" });
    // Loading waits for the booking; the packing list for the goods.
    const p = orderProgress(items);
    expect(p.waiting.find((w) => w.item.key === "loaded")!.waits).toBe("After the booking");
    expect(p.open.map((i) => i.key)).toEqual([null, "goods_received", "booked"]);
  });

  it("moves on as things are done; a step whose rest waits is part done", () => {
    const items = tick(fresh(), "route", "deposit_in", "factory_ordered", "factory_advance", "ready_date", "goods_received", "booked").map((i) =>
      i.key === null ? { ...i, done: true } : i,
    );
    // Packing list can be made; once made, loading is next.
    expect(states(items).shipping).toBe("now");
    const later = tick(items, "packing_list", "loaded", "sailed");
    // At sea: "Arrived" is the shipping step's open item; the papers can go to the bank; delivery waits.
    expect(states(later)).toMatchObject({ shipping: "now", documents: "now", delivery: "wait" });
    // Production with its own item open but the factory not ordered yet: nothing to do there, part done.
    const part = fresh().map((i) => (i.key === "ready_date" ? { ...i, done: true } : i));
    expect(states(part).production).toBe("part");
  });

  it("puts a late item first and marks its step late, even when it would wait", () => {
    const items = fresh().map((i) => (i.key === "ready_date" ? { ...i, late: true, dueOn: "2026-11-01" } : i));
    const p = orderProgress(items);
    expect(states(items).production).toBe("late");
    expect(p.open[0]!.key).toBe("ready_date");
  });

  it("closing waits for everything else, and a left-out item counts as done", () => {
    const all = fresh().map((i) => (i.key === "closed" ? i : i.key === "sat_done" ? { ...i, skipped: true } : { ...i, done: true }));
    const p = orderProgress(all);
    expect(p.open.map((i) => i.key)).toEqual(["closed"]);
    expect(states(all).delivery).toBe("now");
    expect(orderProgress(all.map((i) => ({ ...i, done: true }))).finished).toBe(true);
  });
});

describe("order status in words", () => {
  const today = "2026-11-12";
  it("follows the items", () => {
    expect(orderStatusLine(fresh(), {}, today)).toEqual({ stage: "Confirmed", note: "on time", tone: "warn" });
    expect(orderStatusLine(tick(fresh(), "factory_ordered"), {}, today).stage).toBe("In production");
    expect(orderStatusLine(tick(fresh(), "factory_ordered", "sailed"), {}, today).stage).toBe("Shipped");
    expect(orderStatusLine(tick(fresh(), "sailed", "arrived"), {}, today).stage).toBe("Arrived");
    expect(orderStatusLine(tick(fresh(), "arrived", "delivered"), {}, today).stage).toBe("Delivered");
    expect(orderStatusLine(fresh().map((i) => ({ ...i, done: true })), {}, today)).toEqual({ stage: "Done", note: null, tone: "ok" });
    expect(orderStatusLine(fresh(), { cancelled: true }, today).stage).toBe("Cancelled");
  });
  it("says how late", () => {
    const late = tick(fresh(), "factory_ordered").map((i) => (i.key === "ready_date" ? { ...i, late: true, dueOn: "2026-11-06" } : i));
    expect(orderStatusLine(late, {}, today)).toEqual({ stage: "In production", note: "6 days late", tone: "bad" });
  });
});
