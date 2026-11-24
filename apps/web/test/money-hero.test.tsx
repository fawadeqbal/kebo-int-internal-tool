import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyHero } from "@/components/money/money-hero";

// Every payment page opens with its amount: signed by which way the money went, and in the main currency too when foreign.
describe("the amount on a payment page", () => {
  it("money in is plus and money out is minus, with the currency and two decimals", () => {
    const { rerender } = render(
      <MoneyHero kind="Payment received" direction="in" amount="845.1" currency="USD" line="Received 24 Nov 2026" />,
    );
    expect(screen.getByRole("region", { name: "Payment received: +USD 845.10" })).toBeTruthy();
    rerender(<MoneyHero kind="Expense" direction="out" amount="350" currency="USD" line="Paid 24 Nov 2026" />);
    expect(screen.getByRole("region", { name: "Expense: −USD 350.00" })).toBeTruthy();
  });

  it("a foreign amount says what it is in the main currency and at what rate", () => {
    render(
      <MoneyHero
        kind="Payment made"
        direction="out"
        amount="6800"
        currency="CNY"
        inMain={{ amount: "957.75", currency: "USD", rate: "7.1" }}
        line="Paid"
        party={{ label: "To", value: "Shenjing" }}
      />,
    );
    expect(screen.getByText("≈ USD 957.75 at 7.1 CNY per USD")).toBeTruthy();
    expect(screen.getByText("Shenjing")).toBeTruthy();
  });
});
