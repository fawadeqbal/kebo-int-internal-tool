import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DetailsCard, RecordListCard, RecordRow } from "@/components/common/record";

// The old /new and /edit pages only send people on: the record or list with its side panel open.
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect ${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/customers/c1",
}));

const where = async (run: () => unknown) => {
  try {
    await run();
  } catch (e) {
    return (e as Error).message.replace(/^redirect /, "");
  }
  return null;
};

describe("old URLs open the side panel", () => {
  const id = { params: Promise.resolve({ id: "c1" }) };
  it("/customers/:id/edit → the customer with Edit open", async () => {
    const { default: Page } = await import("@/app/(app)/customers/[id]/edit/page");
    expect(await where(() => Page(id))).toBe("/customers/c1?panel=edit-customer&id=c1");
  });
  it("/customers/new → the list with New customer open", async () => {
    const { default: Page } = await import("@/app/(app)/customers/new/page");
    expect(await where(() => Page())).toBe("/customers?panel=new-customer");
  });
  it("/factories/new → the list with New factory open", async () => {
    const { default: Page } = await import("@/app/(app)/factories/new/page");
    expect(await where(() => Page())).toBe("/factories?panel=new-factory");
  });
  it("/factories/:id/edit → the factory with Edit open", async () => {
    const { default: Page } = await import("@/app/(app)/factories/[id]/edit/page");
    expect(await where(() => Page(id))).toBe("/factories/c1?panel=edit-factory&id=c1");
  });
  it("/users/new → the list with Add a person open", async () => {
    const { default: Page } = await import("@/app/(app)/users/new/page");
    expect(await where(() => Page())).toBe("/users?panel=new-user");
  });
});

describe("DetailsCard", () => {
  const items = [
    { label: "Contact", value: "Ali Raza" },
    { label: "Email", value: null },
    { label: "Notes", value: null, optional: true },
    { label: "Added", value: "03 Nov 2026", readOnly: true },
  ];

  it("shows the values as on the board, — when empty, and opens the edit window from ✎ Edit", () => {
    render(<DetailsCard items={items} edit={{ panel: "edit-customer", id: "c1", label: "Edit Lahore Pharma" }} />);
    const edit = screen.getByRole("link", { name: "Edit Lahore Pharma" });
    expect(edit.getAttribute("href")).toBe("/customers/c1?panel=edit-customer&id=c1");
    expect(edit.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.getByText("Ali Raza")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    // Optional and empty: not shown.
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("is read-only without the permission: no buttons, — for what is missing", () => {
    render(<DetailsCard items={items} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("RecordListCard", () => {
  it("shows its rows, each a link to the record with its ⋯ outside the link", () => {
    render(
      <RecordListCard title="Orders" count={1}>
        {[<RecordRow key="o" href="/orders/o1" title="SO-2026-0447" sub="ordered 03 Nov" figure="USD 34,640" menu={<button>⋯</button>} />]}
      </RecordListCard>,
    );
    expect(screen.getByRole("heading", { name: /^Orders\s*·\s*1$/ })).toBeTruthy();
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link", { name: "SO-2026-0447" }).getAttribute("href")).toBe("/orders/o1");
    expect(within(row).getByRole("link").contains(within(row).getByRole("button"))).toBe(false);
  });

  it("says what goes there when empty", () => {
    render(<RecordListCard title="Orders" count={0} empty={<p>No orders yet</p>} />);
    expect(screen.getByText("No orders yet")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
