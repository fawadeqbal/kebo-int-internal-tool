import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { QuoteOffers, RevisionDraft } from "@/lib/types-deals";

// Design "RFQ Desk — terms that travel" (16 Nov 2026), step 1: the quotation's form in the groups every offer and
// order uses (Delivery · Payment · Warranty · Conditions); each option's lead time beside what its supplier gives;
// the payment as parts, the order's plan; where we promise more than the supplier gives, it says so.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { RevisionEditor, withFacts, fromDraft, payload } = await import("@/components/deals/revision-editor");

const offers: QuoteOffers = {
  currency: "USD",
  defaultMargin: 15,
  mainCurrency: "USD",
  rates: { USD: 1, CNY: 7.1 },
  offers: [
    {
      supplierQuoteId: "J",
      supplier: { id: "fj", name: "Jinan Pharma Machinery" },
      currency: "CNY",
      basis: "FOB",
      basisPlace: "Qingdao",
      receivedOn: "2026-11-12",
      validUntil: null,
      leadTime: "30 days after the deposit",
      leadDays: 30,
      leadFrom: "after_payment",
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
      coverage: { covered: ["1"], missing: [] },
      missingRate: false,
      totalCost: "26197.18",
      lines: [{ id: "j1", no: "1", parentId: null, requestedItemId: "i1", answersNo: "1", description: "Blister packing machine", model: "DPP-260", quantity: "1", unit: "set", unitCost: "26197.18" }],
    },
  ],
  items: [{ id: "i1", no: "1", parentId: null, description: "Blister packing machine", model: null, quantity: "1", unit: "set" }],
};

const draft = (extra: Partial<RevisionDraft> = {}): RevisionDraft => ({
  number: 1,
  currency: "USD",
  incoterm: "FOB",
  incotermPlace: "Qingdao",
  depositPercent: 30,
  balanceTerms: "before_shipment",
  validUntil: "2026-11-28",
  paymentTerms: null,
  deliveryTerms: null,
  warranty: "parts and service",
  warrantyMonths: 12,
  warrantyFrom: "sat",
  notes: null,
  options: [{ supplierQuoteId: "J", discount: 0, leadTime: null, leadDays: 45, leadFrom: "after_payment", charges: [], costs: [], prices: [{ lineId: "j1", unitPrice: 30125 }] }],
  ...extra,
});

const show = (d = draft()) =>
  render(<RevisionEditor action={async () => ({ ok: true })} number={1} initial={d} offers={offers} showCosts submitLabel="Save draft" onCancel={() => {}} />);
const sent = () => JSON.parse((document.querySelector('input[name="payload"]') as HTMLInputElement).value);

describe("the quotation's form, in the four groups", () => {
  it("has the groups in their order, each option's lead time beside the supplier's, and the warranty checked", () => {
    show();
    const legends = [...document.querySelectorAll("legend")].map((l) => l.firstChild?.textContent);
    expect(legends.filter((t) => ["Options: which offers to quote", "The quotation", "Delivery", "Payment", "Warranty", "Conditions"].includes(t ?? ""))).toEqual([
      "Options: which offers to quote",
      "The quotation",
      "Delivery",
      "Payment",
      "Warranty",
      "Conditions",
    ]);
    const leads = screen.getByRole("table", { name: "Lead time of each option" });
    expect(within(leads).getByLabelText("Option A lead time")).toHaveProperty("value", "45");
    expect(within(leads).getAllByText(/Jinan Pharma gives 30 days after the deposit · 15 days to spare/).length).toBeGreaterThan(0);
    // 12 months from the site test against 12 from shipment: the last 2 are not the supplier's.
    expect(screen.getByText(/the last 2 months of ours are not covered by the supplier: ask Jinan Pharma for 14 months/)).toBeTruthy();
    // The payment covers what Jinan asks before the goods leave.
    expect(screen.getByText(/^Covered: the customer pays USD 9,037.50 with the order/)).toBeTruthy();
  });

  it("a usual payment in one tap; the parts are what is sent, with the deposit and balance worked out", () => {
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "Apply template" }), { target: { value: "30 · 60 · 10 after the site test" } });
    expect(screen.getAllByLabelText("Percentage").map((x) => (x as HTMLInputElement).value)).toEqual(["30", "60", "10"]);
    const p = sent();
    expect(p.paymentParts.map((x: { percent: string; rule: string }) => `${x.percent} ${x.rule}`)).toEqual(["30 on_order", "60 before_shipment", "10 after_sat"]);
    expect(p).toMatchObject({ depositPercent: 30, balanceTerms: "before_shipment", paymentRoute: null, warrantyMonths: "12", warrantyFrom: "sat" });
    expect(p.options[0]).toMatchObject({ leadDays: "45", leadFrom: "after_payment", leadTime: null });
    // How they pay: chosen here, or left for the order.
    fireEvent.click(screen.getByRole("radio", { name: /Bank contract/ }));
    expect(sent().paymentRoute).toBe("bank_contract");
  });

  it("parts that do not add up stop the save and say why", () => {
    show();
    const [, balance] = screen.getAllByLabelText("Percentage");
    fireEvent.change(balance!, { target: { value: "60" } });
    // The quotation's total is known: the remainder is said as money, as on the order.
    expect(screen.getAllByRole("status").some((x) => /not allocated/.test(x.textContent ?? ""))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    expect(screen.getByText("The installments must add up to 100%: 10% not allocated.")).toBeTruthy();
  });
});

describe("an older quotation opened in the form", () => {
  it("reads its lead time and warranty words for days and months where they say them, and keeps the others", () => {
    const d = draft({
      warranty: "Warranty: 12 months from the site acceptance test (SAT), parts and service.",
      warrantyMonths: null,
      warrantyFrom: null,
      options: [{ supplierQuoteId: "J", discount: 0, leadTime: "60 days", charges: [], costs: [], prices: [{ lineId: "j1", unitPrice: 30125 }] }],
    });
    const opened = withFacts(fromDraft(d));
    expect(opened.state.options[0]).toMatchObject({ leadDays: "60", leadFrom: "after_payment", leadTime: "" });
    expect(opened.leadWords[opened.state.options[0]!.key]).toBe("60 days");
    expect(opened.state).toMatchObject({ warrantyMonths: "12", warrantyFrom: "sat", warranty: "parts and service" });
    // Words that do not say them stay words, and are sent back as they were.
    const odd = withFacts(fromDraft({ ...d, options: [{ ...d.options[0]!, leadTime: "6-8 working weeks" }] }));
    expect(odd.state.options[0]).toMatchObject({ leadDays: "", leadTime: "6-8 working weeks" });
    expect(payload(odd.state, offers).options[0]).toMatchObject({ leadDays: null, leadTime: "6-8 working weeks" });
  });

  it("the price editor sends its terms back as they were (nothing read into them)", () => {
    const d = draft({ options: [{ supplierQuoteId: "J", discount: 0, leadTime: "60 days", charges: [], costs: [], prices: [{ lineId: "j1", unitPrice: 30125 }] }] });
    const p = payload(fromDraft(d), offers);
    expect(p.options[0]).toMatchObject({ leadDays: null, leadTime: "60 days" });
    expect(p.paymentParts.map((x) => `${x.percent} ${x.rule}`)).toEqual(["30 on_order", "70 before_shipment"]);
  });
});
