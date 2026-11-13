import { describe, expect, it } from "vitest";
import { editCardLabel, ORDER_SECTIONS, ORDER_SECTION_LABEL, ORDER_SECTION_TAB, ORDER_FLOW_STAGES, ORDER_TABS, orderSteps, sectionReminders, sectionStep, stageStands, stageWords, STEP_OF_ACTION, type SectionFacts } from "../src/workflows/order-sections";

/** An order just made: bank transfer, 30% deposit, nothing done. */
const fresh = (more: Partial<SectionFacts> = {}): SectionFacts => ({
  currency: "USD",
  route: "informal",
  shipMode: "sea",
  bankContract: null,
  depositPercent: 30,
  depositIn: false,
  depositOn: null,
  deposit: "55260.00",
  due: "184200.00",
  paidInFullOn: null,
  factoryOrderedOn: null,
  factories: [{ name: "Jiangsu Filling Machinery", currency: "CNY", owed: "950000.00", paid: "0.00", toPay: "950000.00" }],
  readyOn: null,
  goods: { lines: 4, received: 0 },
  packedAt: null,
  packing: null,
  shipments: [],
  shippedOn: null,
  blNo: null,
  proforma: { number: "PI-0412", issuedOn: "2026-11-12" },
  documents: [],
  bankSteps: [],
  deliveredOn: null,
  satDoneOn: null,
  satSignedBy: null,
  claims: { open: 0, total: 0 },
  closedOn: null,
  ...more,
});
const ship = (more: Partial<SectionFacts["shipments"][number]> = {}): SectionFacts["shipments"][number] => ({
  status: "planned",
  mode: "sea",
  forwarder: null,
  bookingNo: null,
  containerNo: null,
  vessel: null,
  blNo: null,
  etd: null,
  eta: null,
  departedOn: null,
  arrivedOn: null,
  portOfDischarge: null,
  ...more,
});
const TODAY = "2026-11-25";

describe("the tabs and sections of an order", () => {
  it("has nine tabs, and the six stages among them in the tabs' order", () => {
    expect(ORDER_TABS).toEqual(["overview", "payment", "factory", "production", "shipping", "delivery", "documents", "costs", "history"]);
    expect(ORDER_FLOW_STAGES.map((s) => ORDER_TABS.indexOf(s))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("names every section and puts it on a tab", () => {
    for (const s of ORDER_SECTIONS) {
      expect(ORDER_SECTION_LABEL[s]).toBeTruthy();
      expect(ORDER_TABS).toContain(ORDER_SECTION_TAB[s]);
    }
    expect(new Set(ORDER_SECTIONS).size).toBe(ORDER_SECTIONS.length);
  });

  it("keeps a section's files under its stage; the order's own and the costs' under none", () => {
    expect(sectionStep("booking")).toBe("shipping");
    expect(sectionStep("fat")).toBe("production");
    expect(sectionStep("bank_steps")).toBe("documents");
    expect(sectionStep("sat")).toBe("delivery");
    expect(sectionStep("order")).toBeNull();
    expect(sectionStep("expenses")).toBeNull();
  });
});

describe("where each stage stands", () => {
  it("a new order: nothing in, not sent, not started, not booked, not yet, 1 of 5 papers", () => {
    const w = stageWords(fresh(), TODAY);
    expect(w.payment).toEqual({ word: "Nothing in", tone: "warn", tab: "nothing in" });
    expect(w.factory).toEqual({ word: "Not sent", tone: "neutral", tab: "not sent" });
    expect(w.production).toEqual({ word: "Not started", tone: "neutral", tab: "" });
    expect(w.shipping).toEqual({ word: "Not booked", tone: "neutral", tab: "" });
    expect(w.delivery).toEqual({ word: "Not yet", tone: "neutral", tab: "" });
    expect(w.documents).toEqual({ word: "1 of 5 papers", tone: "neutral", tab: "1 of 5" });
  });

  it("in production: deposit in, PO sent, ready 5 Dec, booked", () => {
    const w = stageWords(
      fresh({
        depositIn: true,
        depositOn: "2026-11-16",
        due: "128940.00",
        factoryOrderedOn: "2026-11-16",
        factories: [{ name: "Jiangsu", currency: "CNY", owed: "950000.00", paid: "380000.00", toPay: "570000.00" }],
        readyOn: "2026-12-05",
        shipments: [ship({ status: "booked", forwarder: "Sino-Africa Logistics", bookingNo: "SAL-88213" })],
        documents: [{ kind: "packing_list", status: "ready", number: "PL-0412", issuedOn: null }],
      }),
      TODAY,
    );
    expect(w.payment.word).toBe("Deposit in");
    expect(w.factory).toEqual({ word: "PO sent", tone: "ok", tab: "PO sent" });
    expect(w.production).toEqual({ word: "Ready 5 Dec", tone: "warn", tab: "ready 5 Dec" });
    expect(w.shipping).toEqual({ word: "Booked", tone: "info", tab: "booked" });
    expect(w.documents.tab).toBe("2 of 5");
  });

  it("the ready date passed and the goods not in: the word turns red", () => {
    expect(stageWords(fresh({ readyOn: "2026-11-20" }), TODAY).production.tone).toBe("bad");
    expect(stageWords(fresh({ readyOn: "2026-11-20", goods: { lines: 4, received: 4 } }), TODAY).production).toEqual({ word: "Received", tone: "ok", tab: "received" });
  });

  it("sailed, then arrived only when every shipment is in", () => {
    const one = ship({ status: "departed", departedOn: "2026-12-14" });
    expect(stageWords(fresh({ shipments: [one] }), TODAY).shipping).toEqual({ word: "Sailed 14 Dec", tone: "info", tab: "sailed" });
    const two = [ship({ status: "arrived", departedOn: "2026-12-14", arrivedOn: "2027-01-19" }), ship({ status: "departed", departedOn: "2026-12-20" })];
    expect(stageWords(fresh({ shipments: two }), TODAY).shipping.tab).toBe("sailed");
    const all = two.map((s) => ({ ...s, status: "cleared" as const, arrivedOn: s.arrivedOn ?? "2027-01-25" }));
    expect(stageWords(fresh({ shipments: all }), TODAY).shipping).toEqual({ word: "Arrived 25 Jan", tone: "ok", tab: "arrived" });
    expect(stageWords(fresh({ shipMode: "air", shipments: [{ ...one, mode: "air" }] }), TODAY).shipping.tab).toBe("left");
  });

  it("paid in full, factory paid, delivered, SAT signed", () => {
    const w = stageWords(
      fresh({
        depositIn: true,
        due: "0.00",
        paidInFullOn: "2026-12-10",
        factoryOrderedOn: "2026-11-16",
        factories: [{ name: "Jiangsu", currency: "CNY", owed: "950000.00", paid: "950000.00", toPay: "0.00" }],
        deliveredOn: "2027-01-26",
      }),
      TODAY,
    );
    expect(w.payment).toEqual({ word: "Paid in full", tone: "ok", tab: "paid in full" });
    expect(w.factory).toEqual({ word: "Paid", tone: "ok", tab: "paid" });
    expect(w.delivery).toEqual({ word: "Delivered 26 Jan", tone: "ok", tab: "delivered" });
    expect(stageWords(fresh({ deliveredOn: "2027-01-26", satDoneOn: "2027-02-04" }), TODAY).delivery).toEqual({ word: "SAT signed 4 Feb", tone: "ok", tab: "signed off" });
  });

  it("a person who may not see factory money still reads PO sent", () => {
    expect(stageWords(fresh({ factoryOrderedOn: "2026-11-16", factories: null }), TODAY).factory.word).toBe("PO sent");
  });

  it("by LC: the open LC is the word until the money is in; the papers are seven", () => {
    const lc = fresh({
      route: "letter_of_credit",
      depositIn: true,
      due: "128940.00",
      bankContract: { status: "opened", number: "LC-LG-2026-00781", amount: "128940.00", currency: "USD", openedOn: "2026-11-18" },
    });
    expect(stageWords(lc, TODAY).payment).toEqual({ word: "LC open", tone: "info", tab: "LC open" });
    expect(stageWords(lc, TODAY).documents.tab).toBe("1 of 7");
    const contract = { ...lc, route: "bank_contract" as const };
    expect(stageWords(contract, TODAY).payment.tab).toBe("contract open");
    expect(stageWords(contract, TODAY).documents.tab).toBe("1 of 6");
    expect(stageWords({ ...lc, due: "0.00", paidInFullOn: "2027-01-05" }, TODAY).payment.word).toBe("Paid in full");
  });

  it("a paper the company switched off is not counted, unless it was made anyway; a paper added by hand is", () => {
    const off = fresh({ papersOff: ["packing-list"] });
    expect(stageWords(off, TODAY).documents.tab).toBe("1 of 4");
    expect(stageWords({ ...off, documents: [{ kind: "packing_list", status: "ready", number: null, issuedOn: null }] }, TODAY).documents.tab).toBe("2 of 5");
    const extra = fresh({ documents: [{ kind: "other", status: "ready", number: null, issuedOn: null }] });
    expect(stageWords(extra, TODAY).documents.tab).toBe("2 of 6");
  });
});

describe("the Overview's lines", () => {
  const line = (f: SectionFacts, stage: string) => stageStands(f, TODAY).find((s) => s.stage === stage)!;

  it("come in the tabs' order with their label and word", () => {
    const all = stageStands(fresh(), TODAY);
    expect(all.map((s) => s.label)).toEqual(["Payment", "Factory order", "Production", "Shipping", "Delivery & SAT", "Documents"]);
    expect(all[0]).toMatchObject({ word: "Nothing in", tone: "warn", fact: "Bank transfer (T/T) · deposit 30% USD 55,260 to come", missing: "" });
    expect(all[1]!.fact).toBe("Jiangsu Filling Machinery · CNY 950,000");
    expect(all[2]!.fact).toBe("No ready date yet");
    expect(line(fresh({ shipBy: "2026-12-12" }), "shipping").fact).toBe("Ship by 12 Dec");
    expect(all[4]!.fact).toBe("After arrival");
    expect(all[5]).toMatchObject({ fact: "Proforma ready", missing: "4 to come" });
  });

  it("say what happened, and what is still empty", () => {
    const f = fresh({
      depositIn: true,
      depositOn: "2026-11-16",
      due: "128940.00",
      factoryOrderedOn: "2026-11-16",
      factoryOrderNo: "JF-26-1107",
      factories: [{ name: "Jiangsu Filling Machinery", currency: "CNY", owed: "950000.00", paid: "380000.00", toPay: "570000.00" }],
      readyOn: "2026-12-05",
      fat: [{ factory: null, plannedOn: "2026-12-03", doneOn: null, result: null }],
      shipments: [ship({ status: "booked", forwarder: "Sino-Africa Logistics", bookingNo: "SAL-88213", etd: "2026-12-14", eta: "2027-01-18" })],
      documents: [{ kind: "packing_list", status: "ready", number: "PL-0412", issuedOn: null }],
    });
    expect(line(f, "payment").fact).toBe("Bank transfer (T/T) · 30% USD 55,260 in on 16 Nov · balance USD 128,940");
    expect(line(f, "factory").fact).toBe("Jiangsu Filling Machinery · ordered 16 Nov · their no. JF-26-1107 · CNY 380,000 paid of CNY 950,000");
    expect(line(f, "production")).toMatchObject({ fact: "10 days left · factory test planned 3 Dec", missing: "" });
    expect(line(f, "shipping")).toMatchObject({ fact: "Sino-Africa Logistics · SAL-88213 · sails 14 Dec · arrives 18 Jan", missing: "container, B/L empty" });
    expect(line(f, "documents")).toMatchObject({ fact: "Proforma and packing list ready", missing: "B/L, invoice, origin to come" });
  });

  it("a finished order reads as a record", () => {
    const f = fresh({
      depositIn: true,
      depositOn: "2026-11-16",
      due: "0.00",
      paidInFullOn: "2026-12-10",
      factoryOrderedOn: "2026-11-16",
      factories: [{ name: "Jiangsu", currency: "CNY", owed: "950000.00", paid: "950000.00", toPay: "0.00" }],
      readyOn: "2026-12-05",
      goods: { lines: 4, received: 4 },
      fat: [{ factory: null, plannedOn: "2026-12-03", doneOn: "2026-12-03", result: "passed" }],
      shipments: [ship({ status: "cleared", forwarder: "Sino-Africa Logistics", vessel: "MSC Aurora", blNo: "MEDUSH887120", containerNo: "MSCU 448120 7", departedOn: "2026-12-14", arrivedOn: "2027-01-19" })],
      deliveredOn: "2027-01-26",
      satDoneOn: "2027-02-04",
      satSignedBy: "Mr Ade Bello",
      claims: { open: 0, total: 1 },
    });
    expect(line(f, "payment").fact).toBe("Deposit 16 Nov · paid in full 10 Dec");
    expect(line(f, "factory").fact).toBe("Jiangsu · ordered 16 Nov · CNY 950,000 paid");
    expect(line(f, "production").fact).toBe("Ready 5 Dec · factory test passed 3 Dec · 4 of 4 lines received");
    expect(line(f, "shipping")).toMatchObject({ fact: "Sino-Africa Logistics · MSC Aurora · B/L MEDUSH887120 · sailed 14 Dec · arrived 19 Jan", missing: "" });
    expect(line(f, "delivery")).toMatchObject({ fact: "Delivered 26 Jan · SAT signed 4 Feb by Mr Ade Bello · 1 claim settled", missing: "" });
  });

  it("the ready date passed without the goods, and a delivery without its SAT, are named", () => {
    expect(line(fresh({ readyOn: "2026-11-20" }), "production")).toMatchObject({ fact: "5 days late", missing: "goods not received" });
    expect(line(fresh({ deliveredOn: "2026-11-24" }), "delivery").missing).toBe("SAT not signed");
  });
});

describe("what the sections say is late", () => {
  it("nothing on a new order", () => {
    expect(sectionReminders(fresh({ shipBy: "2026-12-12" }), TODAY)).toEqual([]);
  });

  it("the ready date passed and the goods are not all in", () => {
    const r = sectionReminders(fresh({ readyOn: "2026-11-20", goods: { lines: 4, received: 1 } }), TODAY);
    expect(r).toEqual([{ key: "goods_late", tab: "production", due: "2026-11-20", text: "Goods were to be ready 20 Nov: 1 of 4 received" }]);
    expect(sectionReminders(fresh({ readyOn: "2026-11-20", goods: { lines: 4, received: 4 } }), TODAY)).toEqual([]);
  });

  it("a factory test planned and not done", () => {
    const r = sectionReminders(fresh({ fat: [{ factory: "Jiangsu", plannedOn: "2026-11-22", doneOn: null, result: null }] }), TODAY);
    expect(r.map((x) => x.key)).toEqual(["fat_late"]);
    expect(r[0]!.text).toBe("Factory test planned 22 Nov at Jiangsu: no result yet");
    expect(sectionReminders(fresh({ fat: [{ factory: null, plannedOn: "2026-11-22", doneOn: "2026-11-22", result: "passed" }] }), TODAY)).toEqual([]);
    expect(sectionReminders(fresh({ fat: [{ factory: null, plannedOn: "2026-12-03", doneOn: null, result: null }] }), TODAY)).toEqual([]);
  });

  it("our ship-by date passed and nothing has left", () => {
    expect(sectionReminders(fresh({ shipBy: "2026-11-24" }), TODAY).map((x) => x.key)).toEqual(["ship_late"]);
    expect(sectionReminders(fresh({ shipBy: "2026-11-24", shipments: [ship({ status: "departed", departedOn: "2026-11-23" })] }), TODAY)).toEqual([]);
  });

  it("a closed order reminds of nothing", () => {
    expect(sectionReminders(fresh({ readyOn: "2026-11-20", shipBy: "2026-11-24", closedOn: "2026-11-24" }), TODAY)).toEqual([]);
  });
});

describe("the stages an order has, and the stage of a change", () => {
  it("has the five core stages, and Delivery & SAT with its module", () => {
    expect(orderSteps(null)).toEqual(["payment", "factory", "production", "shipping", "documents", "delivery"]);
    expect(orderSteps(["shipping"])).toEqual(["payment", "factory", "production", "shipping", "documents"]);
    expect(orderSteps(["delivery_sat"])).toContain("delivery");
  });

  it("files a change in the history under its stage; the order as a whole otherwise", () => {
    expect(STEP_OF_ACTION("flow.route")).toBe("payment");
    expect(STEP_OF_ACTION("payment_out")).toBe("factory");
    expect(STEP_OF_ACTION("payment_in")).toBe("payment");
    expect(STEP_OF_ACTION("flow.production")).toBe("production");
    expect(STEP_OF_ACTION("goods_received")).toBe("production");
    expect(STEP_OF_ACTION("flow.shipment")).toBe("shipping");
    expect(STEP_OF_ACTION("flow.bank_step")).toBe("documents");
    expect(STEP_OF_ACTION("flow.claim")).toBe("delivery");
    // A paper, a file or an expense says its stage itself.
    expect(STEP_OF_ACTION("paper.final", { step: "shipping" })).toBe("shipping");
    expect(STEP_OF_ACTION("file.upload", { step: "nowhere" })).toBeNull();
    expect(STEP_OF_ACTION("expense", { step: "delivery" })).toBe("delivery");
    // A card's edit: by the card.
    expect(STEP_OF_ACTION("card.edit", { card: "shipment:1b3d" })).toBe("shipping");
    expect(STEP_OF_ACTION("card.edit", { card: "lines.received" })).toBe("production");
    expect(editCardLabel("lines.received")).toBe("Lines from the factory");
    expect(STEP_OF_ACTION("update", { readyOn: "2026-12-03" })).toBe("production");
    expect(STEP_OF_ACTION("stage")).toBeNull();
    // What was ticked on the old checklist keeps its stage in the history.
    expect(STEP_OF_ACTION("checklist.tick", { step: "shipping" })).toBe("shipping");
  });
});
