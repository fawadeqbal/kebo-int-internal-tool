import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The note after an action (design "knowing what happened"): one sentence naming the thing, the facts under
// it, the next step, Undo where safe; its kind said in words; it waits while held. And a form's mistake: what to
// fix at the top, each a way to its field, the cursor on the first; no connection keeps what was typed.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
}));

const { Toaster, toast, NOTE_MS } = await import("@kebo/ui/client");
const { ActionForm } = await import("@/components/common/action-form");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  if (vi.isFakeTimers()) act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
});

const note = () => document.querySelector<HTMLElement>("[data-note]");

describe("the note", () => {
  it("names the thing, says the facts and the next step, and its kind in words", () => {
    render(<Toaster />);
    act(() =>
      toast({
        message: "Payment RC-2026-0042 recorded",
        detail: "USD 2,000 from Gulf Foods Trading · 4,724.20 still to come",
        actions: [{ label: "Receipt", href: "/print/receipt/1" }],
      }),
    );
    expect(note()?.getAttribute("role")).toBe("status");
    expect(note()?.textContent).toContain("Done: ");
    expect(note()?.textContent).toContain("Payment RC-2026-0042 recorded");
    expect(note()?.textContent).toContain("4,724.20 still to come");
    expect(screen.getByRole("link", { name: "Receipt" }).getAttribute("href")).toBe("/print/receipt/1");
    act(() => vi.advanceTimersByTime(NOTE_MS.plain + 10));
    expect(note()).toBeNull();
  });

  it("waits while held, goes on with the time it had left, and says what was undone", async () => {
    const undo = vi.fn(async () => {});
    render(<Toaster />);
    act(() => toast({ message: "Follow-up done: Call Ali about the price", undo }));
    act(() => vi.advanceTimersByTime(NOTE_MS.undo - 1000));
    expect(note()).not.toBeNull();
    // Its time line runs out with it.
    expect(note()!.querySelector("[data-note-time]")).not.toBeNull();
    fireEvent.mouseEnter(note()!);
    act(() => vi.advanceTimersByTime(NOTE_MS.undo * 2));
    expect(note()).not.toBeNull();
    fireEvent.mouseLeave(note()!);
    act(() => vi.advanceTimersByTime(500));
    expect(note()).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(note()?.textContent).toContain("Undone");
    expect(note()?.textContent).toContain("Call Ali about the price");
  });

  it("bad news is said at once, and goes after five seconds too", () => {
    render(<Toaster />);
    act(() => toast({ kind: "fail", message: "Not saved: no connection" }));
    expect(note()?.getAttribute("role")).toBe("alert");
    expect(note()?.textContent).toContain("Not done: ");
    act(() => vi.advanceTimersByTime(NOTE_MS.fail - 100));
    expect(note()).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(note()).toBeNull();
    expect(NOTE_MS.fail).toBe(5000);
  });

  it("waiting for someone is blue and says so", () => {
    render(<Toaster />);
    act(() => toast({ kind: "wait", message: "Sent to a manager to verify" }));
    expect(note()?.dataset.note).toBe("wait");
    expect(note()?.textContent).toContain("Waiting: ");
  });
});

describe("a form's mistake", () => {
  const Form = ({ action }: { action: () => Promise<object> }) => (
    <>
      <Toaster />
      <ActionForm action={action}>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" />
        <label htmlFor="country">Country</label>
        <select id="country" name="country">
          <option value="">Choose</option>
        </select>
        <button>Save customer</button>
      </ActionForm>
    </>
  );
  const save = () =>
    act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });

  it("lists what to fix at the top, marks the fields, and puts the cursor in the first", async () => {
    vi.useRealTimers();
    render(
      <Form
        action={async () => ({ ok: false, message: "Enter the company or person's name", errors: { name: ["Enter the company or person's name"], country: ["Choose a country"] } })}
      />,
    );
    await save();
    const box = screen.getByRole("alert");
    expect(box.textContent).toContain("Two things to fix before saving");
    // Marked a tick later (a steps window first goes to the step that holds the field).
    await waitFor(() => expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByLabelText("Country").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    fireEvent.click(screen.getByRole("button", { name: "Choose a country" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Country")));
  });

  it("no connection: says so with Try again, and keeps what was typed", async () => {
    vi.useRealTimers();
    const action = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<Form action={action} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kabul Medical Supplies" } });
    await save();
    expect(note()?.textContent).toContain("Not saved: no connection");
    expect(note()?.getAttribute("role")).toBe("alert");
    expect(screen.getByText("Not saved: no connection. What you typed is still here.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(action).toHaveBeenCalledTimes(2);
  });
});
