import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PageHeader, PhoneList, PhoneRow, StatusBadge } from "@kebo/ui";

describe("list frame on a phone", () => {
  it("draws a record as name, one line, status and the key number, the whole row a link", () => {
    const { getByRole, getByText } = render(
      <PhoneList label="Orders">
        <PhoneRow href="/orders/1" title="Lahore Pharma" line="SO-2026-0043 · Get the balance" status={<StatusBadge meaning="bad">Late</StatusBadge>} figure="USD 24,200.00" />
      </PhoneList>,
    );
    const list = getByRole("list", { name: "Orders" });
    expect(list.className).toContain("sm:hidden");
    const link = getByRole("link");
    expect(link.getAttribute("href")).toBe("/orders/1");
    expect(link.textContent).toContain("Lahore Pharma");
    expect(link.textContent).toContain("SO-2026-0043 · Get the balance");
    expect(link.textContent).toContain("Late");
    expect(getByText("USD 24,200.00")).toBeTruthy();
  });

  it("is plain without a page to open, and keeps extra content outside the link", () => {
    const { queryByRole, getByText } = render(
      <PhoneList label="Audit log">
        <PhoneRow title="Changed company settings" line="Super Admin · Settings" figure="3m ago" extra={<button>Show 1 change</button>} />
      </PhoneList>,
    );
    expect(queryByRole("link")).toBeNull();
    expect(getByText("Show 1 change").closest("a")).toBeNull();
  });
});

describe("PageHeader views", () => {
  it("puts the view switch before the one primary", () => {
    const { container, getByRole } = render(
      <PageHeader
        title="Orders"
        summary="70 open orders"
        views={
          <nav aria-label="View">
            <a href="/orders" aria-current="page">
              List
            </a>
            <a href="/orders?view=board">Board</a>
          </nav>
        }
      />,
    );
    expect(getByRole("navigation", { name: "View" })).toBeTruthy();
    expect(getByRole("link", { name: "List" }).getAttribute("aria-current")).toBe("page");
    expect(container.querySelectorAll("[data-slot=primary]")).toHaveLength(0);
  });
});
