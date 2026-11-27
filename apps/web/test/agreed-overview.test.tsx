import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OrderView } from "@/lib/types-orders";
import type { OrderMoney } from "@/lib/types-money";

// Design "RFQ Desk — terms that travel" (16 Nov 2026), step 2: the order's Overview has what was agreed with the
// customer (copied from the quotation when it was accepted, changed in one window that asks why), and the customer
// beside the supplier: what we promised against what the supplier gives, green or amber with what to do.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { sideBySide, shipByNote } = await import("@/components/order-sections/agreed");
const { AgreedWindow } = await import("@/components/order-sections/overview-windows");
const { SupplierAgreedWindow } = await import("@/components/order-sections/supplier-windows");

const agreed = (a: Partial<NonNullable<OrderView["agreed"]>> = {}): NonNullable<OrderView["agreed"]> => ({
  copied: true,
  portOfDischarge: "Karachi",
  leadDays: 45,
  leadFrom: "after_payment",
  leadTime: "45 days after the deposit",
  warrantyMonths: 12,
  warrantyFrom: "sat",
  warranty: "parts and service",
  deliveryConditions: "Export wooden cases.",
  paymentConditions: "Bank charges outside China are for the buyer.",
  notes: null,
  warrantyLine: "12 months from the site acceptance test (SAT), parts and service.",
  shipByTyped: false,
  shipByFrom: { by: "deposit", on: "2026-11-16" },
  changes: 0,
  quoted: {
    portOfDischarge: null,
    leadDays: 45,
    leadFrom: "after_payment",
    leadTime: "45 days after the deposit",
    warrantyMonths: 12,
    warrantyFrom: "sat",
    warranty: "parts and service",
    deliveryConditions: "Export wooden cases.",
    paymentConditions: "Bank charges outside China are for the buyer.",
    notes: null,
    warrantyLine: null,
  },
  ...a,
});

const supplierTerms = (t: Partial<NonNullable<OrderView["supplierTerms"]>[number]> = {}): NonNullable<OrderView["supplierTerms"]>[number] => ({
  factory: { id: "fj", name: "Jinan Pharma Machinery" },
  offer: { id: "q1", reference: "JP-2611-08", receivedOn: "2026-11-12" },
  basis: "FOB",
  basisPlace: "Qingdao",
  terms: {
    leadDays: 30,
    leadFrom: "after_payment",
    parts: [
      { label: "Deposit 30%", percent: 30, rule: "on_order", days: null },
      { label: "Balance 70%", percent: 70, rule: "on_ready", days: null },
    ],
    warrantyMonths: 12,
    warrantyFrom: "shipment",
  },
  costMinor: 2_619_718,
  readyOn: "2026-12-17",
  ...t,
});

const order = (o: Partial<OrderView> = {}) =>
  ({
    id: "o1",
    refNo: "SO-2026-0612",
    currency: "USD",
    total: "30125.00",
    incoterm: "FOB",
    incotermPlace: "Qingdao",
    shipBy: "2026-12-31",
    agreed: agreed(),
    supplierTerms: [supplierTerms()],
    ...o,
  }) as OrderView;

type Item = OrderMoney["plan"]["items"][number];
const item = (label: string, amount: string, part: string | null, dueRule: Item["dueRule"], dueDays: number | null = null, dueOn: string | null = null) =>
  ({ id: label, label, amount, part, dueRule, dueDays, dueOn, status: "open", paid: "0", open: amount, request: { receipts: [] } }) as unknown as Item;
const money = (items: Item[]) => ({ route: { route: "informal", summary: null }, plan: { items } }) as unknown as OrderMoney;
const THREE = money([item("Deposit 30%", "9037.50", "deposit", "fixed", null, "2026-11-20"), item("Before shipment 60%", "18075.00", null, "on_ready"), item("After the site test 10%", "3012.50", null, "after_sat", 15)]);

describe("the customer and the supplier, side by side", () => {
  it("the basis, the lead time, the payment and the warranty, each checked", () => {
    const [t] = sideBySide(order(), THREE);
    expect(t!.factory).toBe("Jinan Pharma");
    expect(t!.rows.map((r) => [r.key, r.ours, r.theirs, r.check?.ok, r.check?.word])).toEqual([
      ["basis", "FOB Qingdao", "FOB Qingdao", true, "The same"],
      ["lead", "45 days after the deposit", "30 days after the deposit", true, "15 days to spare"],
      ["payment", "30% with the order · 60% before shipment · 10% 15 days after the site acceptance test (SAT)", "30% when we order · 70% when ready", true, "Covered"],
      ["warranty", "12 months from the site test (SAT)", "12 months from shipment", false, "2 months not covered"],
    ]);
    expect(t!.rows[1]).toMatchObject({ oursSub: expect.stringContaining("ship by"), theirsSub: expect.stringContaining("ready by") });
    // What to do, only where there is something to look at.
    expect(t!.rows[3]!.check?.text).toContain("ask Jinan Pharma for 14 months");
    expect(t!.rows[1]!.check?.text).toBeUndefined();
    expect(t!.look).toBe(1);
  });

  it("the plan as it stands now: a balance after shipping means we may pay the supplier first", () => {
    const late = money([item("Deposit 30%", "9037.50", "deposit", "fixed", null, "2026-11-20"), item("Balance", "21087.50", "balance", "on_ship_plus_days", 14)]);
    const pay = sideBySide(order(), late)[0]!.rows.find((r) => r.key === "payment")!;
    expect(pay.check).toMatchObject({ ok: false, word: "We may pay first" });
    expect(pay.check?.text).toContain("we pay about");
  });

  it("another basis is worth knowing, not a problem; rows neither side says are left out", () => {
    const [t] = sideBySide(order({ incoterm: "CIF", incotermPlace: "Karachi" } as Partial<OrderView>), null);
    expect(t!.rows.find((r) => r.key === "basis")!.check).toMatchObject({ ok: null, word: "Different", text: "From FOB Qingdao to CIF Karachi is ours to arrange and pay." });
    // Without the plan (no money to see) the payment is the supplier's only, and not checked.
    expect(t!.rows.find((r) => r.key === "payment")).toMatchObject({ ours: null, check: null });
    const none = sideBySide(order({ agreed: agreed({ warrantyMonths: null, warranty: null }), supplierTerms: [supplierTerms({ terms: { ...supplierTerms().terms, warrantyMonths: null } })] }), THREE);
    expect(none[0]!.rows.map((r) => r.key)).not.toContain("warranty");
  });

  it("nothing for people who do not see the supplier's terms", () => {
    expect(sideBySide(order({ supplierTerms: [] }), THREE)).toEqual([]);
  });
});

describe("how ship by came about", () => {
  it("worked out from the deposit, from the order, typed, or waiting", () => {
    expect(shipByNote(agreed(), "2026-12-31")).toEqual({ ok: true, text: expect.stringContaining("worked out: the deposit came in") });
    expect(shipByNote(agreed({ shipByFrom: { by: "deposit", on: null } }), null)).toEqual({ ok: false, text: "worked out once the deposit is in" });
    expect(shipByNote(agreed({ leadDays: 50, shipByFrom: { by: "order", on: "2026-11-14" } }), "2027-01-03")?.text).toContain("50 days after the order");
    expect(shipByNote(agreed({ shipByFrom: { by: "typed" } }), "2027-01-10")).toEqual({ ok: false, text: "typed by hand" });
    expect(shipByNote(agreed({ shipByFrom: null }), "2027-01-10")).toBeNull();
  });
});

describe("Change what we agreed with the customer", () => {
  const open = () => {
    render(
      <AgreedWindow
        title="What we agreed with Al-Shifa Pharma Ltd"
        sub="SO-2026-0612 · from QUO-2026-0531 R1, accepted 14 Nov 2026"
        action={async () => ({ ok: true })}
        values={{
          incoterm: "FOB",
          incotermPlace: "Qingdao",
          portOfDischarge: "Karachi",
          leadDays: 45,
          leadFrom: "after_payment",
          shipBy: "2026-12-31",
          warrantyMonths: 12,
          warrantyFrom: "sat",
          warranty: "parts and service",
          deliveryConditions: "Export wooden cases.",
          paymentConditions: null,
          notes: null,
        }}
        shipHint="Worked out: 45 days after the deposit of 16 Nov."
        payment="Informal · Deposit 30%, paid · Before shipment 60%"
        paymentHref="/orders/o1/payment"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Change/ }));
    return screen.getByRole("dialog");
  };
  const hidden = (name: string) => (document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement).value;

  it("Delivery, Payment (its plan, linked), Warranty and Conditions, filled with what the order keeps", () => {
    const d = open();
    expect(within(d).getByRole("heading", { name: "What we agreed with Al-Shifa Pharma Ltd" })).toBeTruthy();
    expect((within(d).getByLabelText("Incoterm") as HTMLInputElement).readOnly).toBe(true);
    expect((d.querySelector("#agr-place") as HTMLInputElement).value).toBe("Qingdao");
    expect((d.querySelector("#agr-pod") as HTMLInputElement).value).toBe("Karachi");
    expect((d.querySelector("#agr-shipBy") as HTMLInputElement).value).toBe("2026-12-31");
    expect(within(d).getByText("Worked out: 45 days after the deposit of 16 Nov.")).toBeTruthy();
    expect(within(d).getByRole("link", { name: "Open the payment plan" }).getAttribute("href")).toBe("/orders/o1/payment");
    expect(hidden("leadDays")).toBe("45");
    expect(hidden("leadFrom")).toBe("after_payment");
    expect(hidden("warrantyMonths")).toBe("12");
    expect(hidden("warrantyFrom")).toBe("sat");
    expect(within(d).getByText(/asks why when you save/)).toBeTruthy();
  });

  it("the lead time and the warranty are sent as typed; emptied, they are sent empty", () => {
    const d = open();
    fireEvent.change(d.querySelector("#agr-lead") as HTMLInputElement, { target: { value: "50" } });
    fireEvent.change(within(d).getByLabelText("What the days count from"), { target: { value: "after_order" } });
    expect(hidden("leadDays")).toBe("50");
    expect(hidden("leadFrom")).toBe("after_order");
    fireEvent.change(d.querySelector("#agr-warranty-months") as HTMLInputElement, { target: { value: "" } });
    expect(hidden("warrantyMonths")).toBe("");
    expect(hidden("warrantyFrom")).toBe("");
  });
});

describe("Change what we agreed with the supplier", () => {
  const open = (sent: boolean) => {
    render(
      <SupplierAgreedWindow
        title="What we agreed with Jinan Pharma Machinery"
        sub="PO-2026-0617 · from their offer JP-2611-08"
        action={async () => ({ ok: true })}
        sent={sent}
        values={{
          basis: "FOB",
          basisPlace: "Qingdao",
          leadDays: 30,
          leadFrom: "after_payment",
          warrantyMonths: 12,
          warrantyFrom: "shipment",
          warranty: "parts, not labour",
          paymentNote: "By T/T to their account in Jinan.",
          moq: "1 set",
          notes: null,
        }}
        payment="Deposit 30%, paid · Balance 70%"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit what we agreed with the supplier" }));
    return screen.getByRole("dialog");
  };
  const hidden = (name: string) => (document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement).value;

  it("Delivery, the payment's note, Warranty and Conditions, filled with what the purchase order keeps", () => {
    const d = open(true);
    expect((within(d).getByLabelText(/Incoterm/) as HTMLSelectElement).value).toBe("FOB");
    expect((d.querySelector("#fac-place") as HTMLInputElement).value).toBe("Qingdao");
    expect((d.querySelector("#fac-note") as HTMLTextAreaElement).value).toBe("By T/T to their account in Jinan.");
    expect((d.querySelector("#fac-moq") as HTMLInputElement).value).toBe("1 set");
    expect(within(d).getByText("Deposit 30%, paid · Balance 70%")).toBeTruthy();
    expect(hidden("leadDays")).toBe("30");
    expect(hidden("warrantyFrom")).toBe("shipment");
    fireEvent.change(d.querySelector("#fac-lead") as HTMLInputElement, { target: { value: "35" } });
    expect(hidden("leadDays")).toBe("35");
    expect(within(d).getByText(/differs from their offer asks why/)).toBeTruthy();
  });

  it("not sent yet: it says what goes to the supplier, and asks no why", () => {
    const d = open(false);
    expect(within(d).getByText(/Not sent yet/)).toBeTruthy();
    expect(within(d).queryByText(/asks why/)).toBeNull();
  });
});
