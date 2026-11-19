import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Canvas board "One edit window" (19 Nov 2026): a window of saved values counts what differs as it is typed —
// "No changes" (nothing to save), "Save 1 change" — and a changed field says what it was.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/o1/production",
  useSearchParams: () => new URLSearchParams(),
}));

const { FieldsWindow } = await import("@/components/order-sections/fields-window");

const ready = (props: { save?: string; plain?: boolean } = {}) => (
  <FieldsWindow
    button={{ label: "Edit" }}
    title="Ready date"
    action={async () => ({ ok: true })}
    fields={[
      { name: "readyOn", label: "Supplier says ready on", type: "date", value: "2026-11-14" },
      { name: "readyNote", label: "Note", type: "textarea", value: "" },
    ]}
    {...props}
  />
);

describe("a window of saved values", () => {
  it("says No changes until something differs, then counts it, and the field says what it was", () => {
    render(ready());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "No changes" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/Supplier says ready on/), { target: { value: "2026-12-05" } });
    expect(screen.getByRole("button", { name: "Save 1 change" })).toHaveProperty("disabled", false);
    expect(screen.getByText(/Changed · was/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "By WeChat" } });
    expect(screen.getByRole("button", { name: "Save 2 changes" })).toHaveProperty("disabled", false);
    // Typed back as it was: nothing to save again.
    fireEvent.change(screen.getByLabelText(/Supplier says ready on/), { target: { value: "2026-11-14" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "No changes" })).toHaveProperty("disabled", true);
  });

  it("keeps the words of a window that names its button, or adds something new", () => {
    const { unmount } = render(ready({ save: "Add the shipment" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Add the shipment" })).toHaveProperty("disabled", false);
    unmount();
    render(ready({ plain: true }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  });
});
