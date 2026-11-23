import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { PlanPart as Part } from "@/components/money/plan-editor";
// The one plan editor, for the customer's plan and each supplier's: set by amount, percentage or equal installments.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { PlanEditor } = await import("@/components/money/plan-editor");

const part = (key: string, label: string, amount: string, share: string, extra: Partial<Part> = {}): Part => ({
  key,
  id: null,
  label,
  share,
  amount,
  rule: "on_order",
  dueOn: "",
  dueDays: "",
  invoice: "",
  paidMinor: 0,
  locked: false,
  note: null,
  ...extra,
});
const rules = [
  { value: "on_order", label: "On order placement" },
  { value: "on_ready", label: "On goods ready" },
];
const show = (start: Part[]) =>
  render(
    <PlanEditor
      intro="Payable to Ningbo Pumps"
      totalMinor={300000}
      currency="USD"
      rules={rules}
      presets={[]}
      start={start}
      hint={() => null}
      action={async () => ({ ok: true })}
      toPayload={(p) => p}
      onDone={() => {}}
    />,
  );
const amounts = () => screen.getAllByRole("textbox", { name: "Amount" }).map((i) => (i as HTMLInputElement).value);

describe("the plan editor", () => {
  it("starts an empty plan as one installment holding the total, so it can be created", () => {
    show([]);
    expect(amounts()).toEqual(["3000.00"]);
  });

  it("splits into equal installments, the last one taking any cent over, and keeps the total", () => {
    show([part("a", "Advance", "3000.00", "100")]);
    fireEvent.click(screen.getByRole("button", { name: "Equal installments" }));
    fireEvent.click(screen.getByRole("button", { name: "More installments" }));
    expect(amounts()).toEqual(["1000.00", "1000.00", "1000.00"]);
    expect(screen.getByRole("status").textContent).toContain("Fully allocated");
  });

  it("says what is not allocated and puts it on the final installment in one click", () => {
    show([part("a", "Advance", "1200.00", "40"), part("b", "Balance", "1000.00", "33.33")]);
    expect(screen.getByRole("status").textContent).toContain("800.00");
    expect(screen.getByRole("status").textContent).toContain("not allocated");
    fireEvent.click(screen.getByRole("button", { name: "Add to final installment" }));
    expect(amounts()).toEqual(["1200.00", "1800.00"]);
    expect(screen.getByRole("status").textContent).toContain("Fully allocated");
  });

  it("adds the balance as a new installment, or an empty one", () => {
    show([part("a", "Advance", "1200.00", "40")]);
    fireEvent.click(screen.getByRole("button", { name: "Add balance as new installment" }));
    expect(amounts()).toEqual(["1200.00", "1800.00"]);
    fireEvent.click(screen.getByRole("button", { name: "Add installment" }));
    expect(amounts()).toEqual(["1200.00", "1800.00", ""]);
  });

  it("types one thing and shows the other: by percentage the amount follows and cannot be typed", () => {
    show([part("a", "Advance", "1200.00", "40"), part("b", "Balance", "1800.00", "60")]);
    fireEvent.click(screen.getByRole("button", { name: "Percentage" }));
    const first = screen.getAllByRole("textbox", { name: "Percentage" })[0] as HTMLInputElement;
    fireEvent.change(first, { target: { value: "30" } });
    expect((screen.getAllByRole("textbox", { name: "Amount" })[0] as HTMLInputElement).value).toBe("900.00");
    expect((screen.getAllByRole("textbox", { name: "Amount" })[0] as HTMLInputElement).readOnly).toBe(true);
    expect(within(screen.getByRole("group", { name: "Basis of the installments" })).getByRole("button", { name: "Percentage" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves a settled installment as it was paid when splitting", () => {
    show([part("a", "Advance", "900.00", "30", { locked: true, paidMinor: 90000 }), part("b", "Balance", "2100.00", "70")]);
    fireEvent.click(screen.getByRole("button", { name: "Equal installments" }));
    fireEvent.click(screen.getByRole("button", { name: "More installments" }));
    expect(amounts()).toEqual(["900.00", "1050.00", "1050.00"]);
  });
});
