import { describe, expect, it } from "vitest";
import {
  autoChecklist,
  checklistAutoInput,
  checklistItemInput,
  checklistTemplateInput,
  DEFAULT_CHECKLIST,
  doNow,
  orderSteps,
  STEP_OF_ACTION,
  stepOfKey,
  stepProgress,
  stepState,
  stepStates,
  type ChecklistFacts,
} from "../src";

const facts = (over: Partial<ChecklistFacts> = {}): ChecklistFacts => ({
  currency: "USD",
  route: null,
  shipMode: null,
  bankContract: null,
  depositPercent: 30,
  depositIn: false,
  depositOn: null,
  deposit: "18900.00",
  due: "63000.00",
  paidInFullOn: null,
  factoryOrderedOn: null,
  factories: null,
  readyOn: null,
  goods: { lines: 3, received: 0 },
  packedAt: null,
  packing: null,
  shipments: [],
  shippedOn: null,
  blNo: null,
  proforma: null,
  documents: [],
  bankSteps: [],
  deliveredOn: null,
  satDoneOn: null,
  satSignedBy: null,
  claims: { open: 0, total: 0 },
  closedOn: null,
  ...over,
});
const keys = (f: ChecklistFacts, features: string[] | null = null) => autoChecklist(f, features).map((i) => `${i.step}:${i.key}`);
const item = (f: ChecklistFacts, key: string, features: string[] | null = null) => autoChecklist(f, features).find((i) => i.key === key);

describe("automatic checklist items", () => {
  it("every module on, no route yet: the informal set", () => {
    expect(keys(facts())).toEqual([
      "payment:route",
      "payment:deposit_in",
      "factory:factory_ordered",
      "production:ready_date",
      "production:goods_received",
      "shipping:booked",
      "shipping:packing_list",
      "shipping:loaded",
      "shipping:sailed",
      "shipping:arrived",
      "shipping:balance_in",
      "documents:doc:bill_of_lading",
      "documents:doc:packing_list",
      "documents:doc:commercial_invoice",
      "documents:doc:certificate_of_origin",
      "documents:bank:copies_to_customer",
      "delivery:delivered",
      "delivery:sat_done",
      "delivery:claims_closed",
      "delivery:closed",
    ]);
  });

  it("tick themselves from the data", () => {
    expect(item(facts(), "deposit_in")).toMatchObject({ done: false, needs: "USD 18,900.00 (30%)" });
    const paid = item(facts({ depositIn: true, depositOn: "2026-11-06" }), "deposit_in");
    expect(paid).toMatchObject({
      done: true,
      doneOn: "2026-11-06",
      data: [
        ["Amount", "USD 18,900.00"],
        ["On", "2026-11-06"],
      ],
    });
    expect(item(facts({ readyOn: "2027-01-07" }), "ready_date")).toMatchObject({ done: true, data: [["Ready", "2027-01-07"]] });
    expect(item(facts({ goods: { lines: 3, received: 3 } }), "goods_received")?.done).toBe(true);
    const sailed = facts({
      shipments: [
        {
          status: "departed",
          mode: "sea",
          forwarder: "Sino Trans",
          bookingNo: "NGB-1",
          containerNo: "MSKU 1",
          vessel: "MSC Aurora",
          blNo: "MEDU1",
          etd: null,
          eta: "2027-02-06",
          departedOn: "2027-01-14",
          arrivedOn: null,
          portOfDischarge: "Karachi",
        },
      ],
    });
    expect(item(sailed, "sailed")).toMatchObject({
      done: true,
      data: [
        ["Vessel", "MSC Aurora"],
        ["B/L", "MEDU1"],
        ["Sailed", "2027-01-14"],
      ],
    });
    expect(item(sailed, "arrived")).toMatchObject({ title: "Arrived at Karachi", done: false, data: [["ETA", "2027-02-06"]] });
    expect(item(facts({ due: "0.00", paidInFullOn: "2027-02-10" }), "balance_in")?.done).toBe(true);
  });

  it("the route decides the bank items, papers and bank steps", () => {
    const lc = facts({
      route: "letter_of_credit",
      bankContract: { status: "opened", number: "LC/1", amount: "44100", currency: "USD", openedOn: "2026-10-25" },
    });
    expect(item(lc, "contract")).toMatchObject({
      title: "LC opened",
      done: true,
      data: [
        ["LC", "LC/1"],
        ["Amount", "USD 44,100.00"],
      ],
    });
    // The balance comes through the banks: not a Shipping item.
    expect(keys(lc)).not.toContain("shipping:balance_in");
    expect(keys(lc).filter((k) => k.startsWith("documents:bank:"))).toHaveLength(5);
    expect(keys(lc)).toContain("documents:doc:insurance");
    expect(item(facts({ route: "letter_of_credit" }), "contract")?.done).toBe(false);
  });

  it("modules switched off take their items away", () => {
    const k = keys(facts(), ["production"]);
    expect(k).not.toContain("payment:route");
    expect(k.filter((x) => /booked|loaded|sailed|arrived/.test(x))).toEqual([]);
    expect(k).toContain("shipping:shipped");
    expect(k.filter((x) => x.startsWith("documents:"))).toEqual([]);
    expect(k.filter((x) => x.startsWith("delivery:"))).toEqual([]);
    // Without delivery, closing the order is the last item of Shipping.
    expect(k.at(-1)).toBe("shipping:closed");
    expect(orderSteps(["production"])).toEqual(["payment", "factory", "production", "shipping", "documents"]);
    expect(orderSteps(null)).toHaveLength(6);
  });

  it("factory money only for people who see it", () => {
    expect(keys(facts())).not.toContain("factory:factory_advance");
    const f = facts({ factories: [{ name: "Wenzhou", currency: "CNY", owed: "367363.00", paid: "110209.00", toPay: "257154.00" }] });
    expect(item(f, "factory_advance")).toMatchObject({ done: true, data: [["Paid", "CNY 110,209.00"]] });
    expect(item(f, "factory_paid")).toMatchObject({ done: false, data: [["To pay", "CNY 257,154.00"]] });
  });

  it("knows the step of a key", () => {
    expect(stepOfKey("deposit_in")).toBe("payment");
    expect(stepOfKey("doc:insurance")).toBe("documents");
    expect(stepOfKey("bank:bank_paid_us")).toBe("documents");
    expect(stepOfKey("nope")).toBeNull();
  });
});

describe("steps and do now", () => {
  it("a step is done, late, now or later", () => {
    expect(stepState([{ done: true }, { done: false, skipped: true }], false)).toBe("done");
    expect(stepState([{ done: true }, { done: false }], true)).toBe("now");
    expect(stepState([{ done: false }], false)).toBe("todo");
    expect(stepState([{ done: false, late: true }], false)).toBe("late");
    expect(stepProgress([{ done: true }, { done: false, skipped: true }, { done: false }])).toEqual({ done: 2, total: 3 });
  });

  it("the first open item of the current step, a late one first", () => {
    const steps = [
      { key: "payment" as const, items: [{ done: true, title: "a" }] },
      {
        key: "factory" as const,
        items: [
          { done: false, title: "b" },
          { done: false, late: true, title: "c" },
        ],
      },
      { key: "production" as const, items: [{ done: false, title: "d" }] },
    ];
    expect(stepStates(steps)).toEqual(["done", "late", "todo"]);
    expect(doNow(steps)).toEqual({ step: "factory", item: { done: false, late: true, title: "c" } });
    expect(doNow(steps, true)).toBeNull();
    expect(doNow([{ key: "payment", items: [{ done: true }] }])).toBeNull();
  });
});

describe("history per step", () => {
  it("files each change under its step", () => {
    expect(STEP_OF_ACTION("payment_in")).toBe("payment");
    expect(STEP_OF_ACTION("payment_plan")).toBe("payment");
    expect(STEP_OF_ACTION("payment_out")).toBe("factory");
    expect(STEP_OF_ACTION("flow.factory_order")).toBe("factory");
    expect(STEP_OF_ACTION("goods_received")).toBe("production");
    expect(STEP_OF_ACTION("checklist.tick", { step: "production" })).toBe("production");
    expect(STEP_OF_ACTION("packing_list")).toBe("shipping");
    expect(STEP_OF_ACTION("flow.bank_step")).toBe("documents");
    expect(STEP_OF_ACTION("flow.claim")).toBe("delivery");
    expect(STEP_OF_ACTION("update", { readyOn: "2027-01-07" })).toBe("production");
    expect(STEP_OF_ACTION("expense", {})).toBeNull();
    expect(STEP_OF_ACTION("stage_change", { stage: "shipped" })).toBeNull();
  });
});

describe("checklist inputs", () => {
  it("an item needs a title and known fields", () => {
    expect(checklistItemInput.safeParse({ step: "production", title: "" }).success).toBe(false);
    const ok = checklistItemInput.parse({
      step: "production",
      title: "FAT",
      tool: "fill",
      fields: [{ key: "date", label: "Date", type: "date" }],
      route: "",
    });
    expect(ok).toMatchObject({ route: null, dueOn: null, fields: [{ key: "date" }] });
    expect(
      checklistItemInput.safeParse({
        step: "production",
        title: "x",
        fields: [
          { key: "a", label: "A" },
          { key: "a", label: "B" },
        ],
      }).success,
    ).toBe(false);
  });

  it("skipping an automatic item needs a reason", () => {
    expect(checklistAutoInput.safeParse({ skipped: true }).success).toBe(false);
    expect(checklistAutoInput.parse({ skipped: "true", skipReason: "Customer collects" })).toMatchObject({ skipped: true });
  });

  it("the company list takes only known automatic keys to hide", () => {
    expect(checklistTemplateInput.safeParse({ items: [], hidden: ["booked"] }).success).toBe(true);
    expect(checklistTemplateInput.safeParse({ items: [], hidden: ["closed"] }).success).toBe(false);
    expect(DEFAULT_CHECKLIST.every((i) => checklistTemplateInput.shape.items.element.safeParse({ ...i, dueDays: null }).success)).toBe(
      true,
    );
  });
});
