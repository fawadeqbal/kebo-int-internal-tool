import { describe, expect, it } from "vitest";
import { ORDER, ORDER_WORD_TONE, orderNextStep, PAPER, type OrderStepFacts } from "../src";

const today = "2026-11-19";
/** A new order: T/T chosen, the deposit in, nothing else yet. */
const base: OrderStepFacts = {
  status: "open",
  canReopen: false,
  canClose: false,
  routeChosen: true,
  depositDue: 0,
  production: true,
  poSent: false,
  supplierDepositDue: 0,
  readyOn: null,
  goodsIn: false,
  shipping: true,
  booked: false,
  etd: null,
  sailed: false,
  eta: null,
  arrived: false,
  balanceBeforeShipment: 0,
  deliverySat: true,
  delivered: false,
  satOpen: false,
  adviceSent: null,
};
const next = (f: Partial<OrderStepFacts>) => orderNextStep({ ...base, ...f }, today)?.key ?? null;

describe("the order record type", () => {
  it("has the pill the lists and the board show for every state", () => {
    for (const [w, s] of Object.entries(ORDER.states)) expect(s.words).toBe(w);
    // Today's colours, word by word (ORDER_WORD_TONE is made from ORDER.states, so this pins both).
    expect(ORDER_WORD_TONE).toEqual({ Confirmed: "warn", "In production": "info", Shipped: "info", Arrived: "info", Delivered: "ok", Done: "ok", Cancelled: "neutral" });
    expect(ORDER.states.Delivered.tone).toBe("ok");
  });
});

describe("the order's next step: the first that is true", () => {
  it("money first: how they pay, then the deposit", () => {
    expect(next({ routeChosen: false, depositDue: 100 })).toBe("choose_route");
    expect(next({ depositDue: 100 })).toBe("record_deposit");
  });

  it("then the supplier: the PO, its ready date, then the goods (always a next step)", () => {
    expect(next({})).toBe("send_po");
    expect(next({ poSent: true })).toBe("set_ready");
    expect(next({ poSent: true, readyOn: "2026-12-20" })).toBe("goods_in");
    expect(next({ poSent: true, readyOn: "2026-11-14" })).toBe("goods_in");
  });

  it("the supplier's deposit right after the PO; the shipping advice once it sailed", () => {
    expect(next({ poSent: true, supplierDepositDue: 500 })).toBe("pay_supplier");
    const gone = { poSent: true, goodsIn: true, booked: true, sailed: true, eta: "2026-11-10" };
    expect(next({ ...gone, adviceSent: false })).toBe("send_advice");
    expect(next({ ...gone, adviceSent: true })).toBe("arrived");
    expect(next({ ...gone, adviceSent: null })).toBe("arrived");
  });

  it("then the shipment: booked once the goods are in or due within two weeks; the balance; then the sailing", () => {
    expect(next({ poSent: true, readyOn: "2026-11-30" })).toBe("book");
    expect(next({ poSent: true, goodsIn: true })).toBe("book");
    expect(next({ poSent: true, goodsIn: true, booked: true, balanceBeforeShipment: 500 })).toBe("ask_balance");
    // Asked already: what is next is recording it, not asking again; then the supplier's balance on the goods.
    expect(next({ poSent: true, goodsIn: true, booked: true, balanceBeforeShipment: 500, balanceAsked: true })).toBe("record_balance");
    expect(next({ poSent: true, goodsIn: true, booked: true, supplierBalanceDue: 10200 })).toBe("pay_supplier_balance");
    expect(next({ poSent: true, goodsIn: true, booked: true, etd: "2026-11-25" })).toBe("sailed");
    expect(next({ poSent: true, goodsIn: true, booked: true, etd: "2026-11-18" })).toBe("sailed");
  });

  it("then the other end: the arrival, delivered, the SAT, close", () => {
    const gone = { poSent: true, goodsIn: true, booked: true, sailed: true };
    expect(next({ ...gone, eta: "2026-12-10" })).toBe("arrived");
    expect(next({ ...gone, eta: "2026-11-10" })).toBe("arrived");
    expect(next({ ...gone, arrived: true })).toBe("delivered");
    expect(next({ ...gone, arrived: true, delivered: true, satOpen: true })).toBe("sign_sat");
    expect(next({ ...gone, arrived: true, delivered: true, canClose: true })).toBe("close");
  });

  it("a company without production or shipping skips those steps", () => {
    expect(next({ production: false, shipping: false, deliverySat: false })).toBe(null);
    expect(next({ production: false, shipping: false, deliverySat: false, canClose: true })).toBe("close");
  });

  it("closed: Reopen for who may; cancelled: nothing", () => {
    expect(next({ status: "closed", canReopen: true })).toBe("reopen");
    expect(next({ status: "closed" })).toBe(null);
    expect(next({ status: "cancelled", depositDue: 5 })).toBe(null);
  });

  it("names the tab and the window each step opens", () => {
    expect(orderNextStep({ ...base, depositDue: 1 }, today)).toEqual({ key: "record_deposit", label: "Record the deposit", tab: "payment", window: "record-payment" });
  });
});

describe("the order as a paper", () => {
  it("shows the quotation's rows and its ship by", () => {
    expect(PAPER.kinds.order.terms).toContain("shipBy");
    const p = PAPER.ofOrder({
      incoterm: "FOB",
      incotermPlace: "Qingdao",
      portOfDischarge: null,
      leadTime: "45 days after the deposit",
      shipBy: "8 Dec 2026",
      deliveryConditions: null,
      paymentRoute: "informal",
      paymentParts: [],
      paymentConditions: null,
      warranty: null,
      warrantyMonths: 12,
      warrantyFrom: "sat",
      notes: null,
    });
    expect(PAPER.text(p, "incoterm")).toBe("FOB Qingdao");
    expect(PAPER.text(p, "shipBy")).toBe("8 Dec 2026");
    expect(PAPER.text(p, "port")).toBe(null);
  });
});
