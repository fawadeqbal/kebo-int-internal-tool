import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "@kebo/ui";

// The one tile for a headline figure: dashboard, reports, records and the platform all draw this.
describe("StatTile", () => {
  it("shows the label, the value and one line of context", () => {
    render(<StatTile label="Receivable" value="USD 119,390.68" sub="USD 8,670.00 overdue" />);
    expect(screen.getByText("Receivable")).toBeTruthy();
    expect(screen.getByText("USD 119,390.68").getAttribute("title")).toBe("USD 119,390.68");
    expect(screen.getByText("USD 8,670.00 overdue")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is a link to the list behind the number when it has an address", () => {
    render(<StatTile label="Failed sign-ins" value={3} href="/access/sign-ins?failed=1" />);
    expect(screen.getByRole("link", { name: /Failed sign-ins/ }).getAttribute("href")).toBe("/access/sign-ins?failed=1");
  });

  it("colours the line under the value by meaning (board), and draws the bad share as a bar with words", () => {
    render(<StatTile label="Receivable" value="USD 100" sub="USD 40 late" tone="bad" meter={{ percent: 140, label: "USD 40 of it overdue" }} />);
    expect(screen.getByText("USD 100").className).not.toContain("text-bad");
    expect(screen.getByText("USD 40 late").className).toContain("text-bad");
    const bar = screen.getByRole("img", { name: "USD 40 of it overdue" });
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
  });

  it("is smaller in a row of five or inside a card", () => {
    render(<StatTile size="sm" label="Win rate" value="44%" />);
    expect(screen.getByText("44%").className).toContain("text-lg");
  });
});
