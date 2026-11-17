import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// A phone's Back while a form is open goes to the form, not the page under it: a form that is not in the
// address closes; one with something typed asks "Discard your change?" first. (The browser's Navigation
// API is drawn here: jsdom has none.)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
}));

const { Modal } = await import("@/components/common/dialog");
const { SidePanel } = await import("@/components/common/panel");

class FakeNavigation extends EventTarget {
  currentEntry = { index: 3 };
}
let nav: FakeNavigation;
beforeEach(() => {
  nav = new FakeNavigation();
  (window as unknown as { navigation?: FakeNavigation }).navigation = nav;
});
afterEach(() => {
  delete (window as unknown as { navigation?: FakeNavigation }).navigation;
});

/** The browser asking to go to another entry of the history: Back is one step down. */
function press(to: number, { user = true } = {}) {
  const e = Object.assign(new Event("navigate", { cancelable: true }), { navigationType: "traverse", userInitiated: user, destination: { index: to } });
  act(() => {
    nav.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

/** As a person types: a tap in the field, then the words. */
const type = (text: string) => {
  const field = screen.getByLabelText("Reason");
  fireEvent.pointerDown(field);
  fireEvent.input(field, { target: { value: text } });
};
const asks = () => screen.queryByRole("alertdialog", { name: /^Discard your change/ }) !== null;

function form() {
  return (
    <>
      <label htmlFor="r">Reason</label>
      <input id="r" />
    </>
  );
}

describe("the phone's Back on a form", () => {
  it("closes a form that is not in the address, and asks first when something was typed", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="Cancel the order" onClose={onClose}>
        {form()}
      </Modal>,
    );
    expect(press(2)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const kept = vi.fn();
    render(
      <Modal title="Cancel the order" onClose={kept}>
        {form()}
      </Modal>,
    );
    type("Customer changed their mind");
    expect(press(2)).toBe(true);
    expect(kept).not.toHaveBeenCalled();
    expect(asks()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect((screen.getByLabelText("Reason") as HTMLInputElement).value).toBe("Customer changed their mind");
    expect(press(2)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("lets Forward, and steps the app takes itself, go by", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Cancel the order" onClose={onClose}>
        {form()}
      </Modal>,
    );
    expect(press(4)).toBe(false);
    expect(press(2, { user: false })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a form kept in the address closes by Back itself; it holds Back only to ask about typing", () => {
    const onClose = vi.fn();
    render(
      <SidePanel title="New customer" onClose={onClose}>
        {form()}
      </SidePanel>,
    );
    // Nothing typed: Back goes by (the address loses ?panel= and the form closes with it).
    expect(press(2)).toBe(false);
    type("Kabul Medical Supplies");
    expect(press(2)).toBe(true);
    expect(asks()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("on a phone the way out is ✕ at the top left: the same Close", () => {
    render(
      <Modal title="Cancel the order" onClose={vi.fn()}>
        {form()}
      </Modal>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("max-md:order-1");
    expect(close.querySelectorAll("svg")).toHaveLength(1);
  });
});
