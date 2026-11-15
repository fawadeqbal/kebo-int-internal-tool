import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { kindCount, kindOne, Marked, searchHref } from "@/components/shell/search-bits";

/** Search everything: the words found are marked; kinds are said with their counts. */
describe("search's small parts", () => {
  it("marks the words found, in any case, and reads characters as typed", () => {
    const { container } = render(<Marked text="Kabul Medical (KABUL) Supplies" q="kabul" />);
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Kabul", "KABUL"]);
    const odd = render(<Marked text="PO-2026-0017 (a+b)" q="(a+b)" />);
    expect(odd.container.querySelector("mark")?.textContent).toBe("(a+b)");
    // One letter is not marked.
    expect(render(<Marked text="Kabul" q="k" />).container.querySelector("mark")).toBeNull();
  });

  it("says a kind with its count, and one record of it", () => {
    expect(kindCount("inquiries", 1)).toBe("1 inquiry");
    expect(kindCount("purchase_orders", 4)).toBe("4 purchase orders");
    expect(kindOne("purchase_orders")).toBe("Purchase order");
    expect(searchHref("kabul medical", "orders")).toBe("/search?q=kabul+medical&kind=orders");
  });
});
