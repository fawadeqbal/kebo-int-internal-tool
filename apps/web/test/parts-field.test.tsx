import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

// The quotation's and the offer's payment: with a known total, an amount can be typed on each installment, as on the order.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { PartsField } = await import("@/components/deals/terms-fields");
import type { PartRow } from "@/components/deals/terms-fields";

let last: PartRow[] = [];
function Host({ total }: { total: number | null }) {
  const [rows, setRows] = useState<PartRow[]>([
    { key: "a", label: "Deposit", share: "30", rule: "on_order", days: "" },
    { key: "b", label: "Balance", share: "70", rule: "on_order", days: "" },
  ]);
  last = rows;
  return <PartsField idPrefix="t" side="customer" rows={rows} onChange={setRows} presets={[]} totalMinor={total} currency="USD" />;
}

describe("the quotation's payment installments", () => {
  it("show the amount beside the percentage, and take an amount typed in", () => {
    render(<Host total={300000} />);
    const amounts = () => screen.getAllByRole("textbox", { name: "Amount" }) as HTMLInputElement[];
    expect(amounts().map((i) => i.value)).toEqual(["900.00", "2100.00"]);
    fireEvent.change(amounts()[0]!, { target: { value: "1200" } });
    expect(last[0]!.share).toBe("40");
    fireEvent.change(amounts()[1]!, { target: { value: "1800" } });
    expect(last.map((r) => r.share)).toEqual(["40", "60"]);
    expect(screen.getByRole("status").textContent).toContain("Fully allocated");
  });

  it("save shares that add up to 100% when the amounts add up to the total", () => {
    render(<Host total={100000} />);
    const amounts = () => screen.getAllByRole("textbox", { name: "Amount" }) as HTMLInputElement[];
    fireEvent.change(amounts()[0]!, { target: { value: "333.33" } });
    fireEvent.change(amounts()[1]!, { target: { value: "666.67" } });
    expect(last.reduce((t, r) => t + Number(r.share), 0)).toBeCloseTo(100, 6);
  });

  it("stay in percentages when no total is known yet", () => {
    render(<Host total={null} />);
    expect(screen.queryAllByRole("textbox", { name: "Amount" })).toHaveLength(0);
  });
});
