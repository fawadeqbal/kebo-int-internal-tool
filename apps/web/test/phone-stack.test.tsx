import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactsLine, Table, Td, Th, THead } from "@kebo/ui";

/**
 * A phone (review 26 Nov): a table whose columns do not fit becomes one card per row, each cell named by its column;
 * the facts line breaks after a "·" instead of running off the screen.
 */
function screenIs(phone: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: phone && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} }));
}

const sizes = { table: 640, box: 358 };
beforeEach(() => {
  // jsdom draws nothing: the table is as wide as its columns (640 px), its box as wide as a phone's card (358 px).
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "TABLE" ? sizes.table : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "TABLE" ? sizes.table : sizes.box;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const customers = () => (
  <Table aria-label="Customers">
    <THead>
      <tr>
        <Th>Customer</Th>
        <Th>Orders</Th>
        <Th>Sales USD ▼</Th>
      </tr>
    </THead>
    <tbody>
      <tr>
        <Td>Steady Pharma</Td>
        <Td>8</Td>
        <Td>265,120</Td>
      </tr>
      <tr>
        <Td colSpan={2}>Total</Td>
        <Td>265,120</Td>
      </tr>
    </tbody>
  </Table>
);

describe("a table on a phone", () => {
  it("does not fit: one card per row, each cell named by its column (a cell across columns has no name)", () => {
    screenIs(true);
    render(customers());
    const table = screen.getByRole("table", { name: "Customers" });
    expect(table.hasAttribute("data-stack")).toBe(true);
    expect(screen.getByText("8").getAttribute("data-label")).toBe("Orders");
    expect(screen.getAllByText("265,120").map((c) => c.getAttribute("data-label"))).toEqual(["Sales USD", "Sales USD"]);
    expect(screen.getByText("Total").getAttribute("data-label")).toBe("");
  });

  it("fits: stays a table", () => {
    screenIs(true);
    sizes.table = 300;
    render(customers());
    expect(screen.getByRole("table", { name: "Customers" }).hasAttribute("data-stack")).toBe(false);
    sizes.table = 640;
  });

  it("on a laptop: always a table", () => {
    screenIs(false);
    render(customers());
    expect(screen.getByRole("table", { name: "Customers" }).hasAttribute("data-stack")).toBe(false);
  });
});

describe("the facts line on a phone", () => {
  it("can break after each '·': no dot is kept inside a fact that never breaks", () => {
    const { container } = render(
      <FactsLine
        facts={[
          { label: "Customers", value: "512" },
          { label: "They owe you", value: "USD 10.72M", tone: "bad" },
          { label: "Sold this year", value: "USD 11.83M" },
        ]}
      />,
    );
    const line = container.querySelector("[data-phone-facts]")!;
    const facts = [...line.querySelectorAll(".whitespace-nowrap")];
    expect(facts.map((f) => f.textContent)).toEqual(["Customers 512", "They owe you USD 10.72M", "Sold this year USD 11.83M"]);
    expect(facts.some((f) => f.textContent?.includes("·"))).toBe(false);
    expect(line.textContent).toBe("Customers 512 · They owe you USD 10.72M · Sold this year USD 11.83M");
  });
});
