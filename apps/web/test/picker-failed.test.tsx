import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Picker } from "@/components/common/picker";
import type { Failed } from "@/lib/failed";

type Row = { id: string; name: string };
const failed: Failed = { failed: true, what: "the customers" };

const picker = (search: (q: string) => Promise<Row[] | Failed>) =>
  render(
    <Picker<Row>
      inputId="who"
      placeholder="Search customers"
      listLabel="Customers"
      icon={null}
      chosen={null}
      onClear={() => undefined}
      onPick={() => undefined}
      search={search}
      line={() => ({})}
      newLabel="New customer"
      onNew={() => undefined}
      empty={(typed) => `No customer matches “${typed}”`}
    />,
  );

afterEach(() => vi.useRealTimers());

/** The one picker (components/common/picker.tsx): a search that could not be read says so, never "none found". */
describe("a picker whose search failed", () => {
  it("says it could not load them, and offers no '+ New' (a second of one that exists)", async () => {
    picker(async () => failed);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Medi" } });
    expect(await screen.findByText("Could not load the customers. Type again to try once more.", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(/No customer matches/)).toBeNull();
    expect(screen.queryByRole("option", { name: /New customer/ })).toBeNull();
  });

  it("a dropped connection (the call rejects) is said the same way, and logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    picker(() => Promise.reject(new Error("Failed to fetch")));
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Medi" } });
    expect(await screen.findByText("Could not load the customers. Type again to try once more.", {}, { timeout: 2000 })).toBeTruthy();
    expect(warn.mock.calls[0]?.[0]).toBe("[failed] could not load the customers: Failed to fetch");
  });

  it("nothing found is still 'none', with '+ New'", async () => {
    picker(async () => []);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Medi" } });
    expect(await screen.findByText("No customer matches “Medi”", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByRole("option", { name: /New customer/ })).toBeTruthy();
  });
});

describe("the keys on an empty list", () => {
  it("↓ and Enter after a failed search do nothing (they crashed the page: no row -1)", async () => {
    picker(async () => failed);
    const box = screen.getByRole("combobox");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Medi" } });
    await screen.findByText("Could not load the customers. Type again to try once more.", {}, { timeout: 2000 });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.getAttribute("aria-activedescendant")).toBeNull();
    expect(screen.getByText("Could not load the customers. Type again to try once more.")).toBeTruthy();
  });
});
