import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "@/components/common/dialog";
import { PanelActions, PanelBody, SidePanel, useClosePanel } from "@/components/common/panel";

function Form({ onSubmit }: { onSubmit: () => void }) {
  const close = useClosePanel();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <PanelBody>
        <label htmlFor="name">Name</label>
        <input id="name" />
        <label htmlFor="city">City</label>
        <input id="city" />
        <PanelActions>
          <button type="submit">Save</button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </PanelActions>
      </PanelBody>
    </form>
  );
}

function Harness({ onClose = vi.fn(), onSubmit = vi.fn() }: { onClose?: () => void; onSubmit?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>New customer</button>
      {open && (
        <SidePanel
          title="New customer"
          description="The rest can be added later."
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <Form onSubmit={onSubmit} />
        </SidePanel>
      )}
    </>
  );
}

const openPanel = () => {
  const opener = screen.getByRole("button", { name: "New customer" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
};

describe("SidePanel", () => {
  it("is a modal dialog named by its title, and focus starts on the first field", () => {
    render(<Harness />);
    openPanel();
    const dialog = screen.getByRole("dialog", { name: "New customer" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  it("keeps Tab inside the panel (focus trap)", () => {
    render(<Harness />);
    openPanel();
    const dialog = screen.getByRole("dialog");
    // From the last control, Tab goes round to the first (✕ in the header).
    screen.getByRole("button", { name: "Cancel" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close the panel" }));
    // And Shift+Tab from the first goes to the last.
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    // Focus that lands outside is brought back.
    act(() => screen.getByRole("button", { name: "New customer", hidden: true }).focus());
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes with Escape when nothing was typed, and gives focus back to the opener", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = openPanel();
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('asks "Discard changes?" when something was typed; Keep editing stays, Discard closes', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openPanel();
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Lahore Pharma" } });
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "Discard changes?" });
    // The safe way is focused first.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep editing" }));
    expect(confirm).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Cancel asks too.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape in the confirm only closes the confirm", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openPanel();
    fireEvent.input(screen.getByLabelText("City"), { target: { value: "Lahore" } });
    fireEvent.click(screen.getByRole("button", { name: "Close the panel" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Keep editing" }), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves with Ctrl+Enter (and ⌘+Enter)", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    openPanel();
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText("City"), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    // A plain Enter does not.
    fireEvent.keyDown(screen.getByLabelText("City"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("a saved form closes it without asking", () => {
    const onClose = vi.fn();
    function Saver() {
      const close = useClosePanel();
      return <button onClick={() => close({ ok: true })}>Pretend saved</button>;
    }
    render(
      <SidePanel title="Edit customer · Lahore Pharma" onClose={onClose}>
        <PanelBody>
          <input aria-label="Name" />
          <Saver />
        </PanelBody>
      </SidePanel>,
    );
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Pretend saved" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  describe("knows whether something was changed", () => {
    /** A window on a record that has values, a tick, a choice kept in a hidden field, and a field that announces itself. */
    function Editor({ late }: { late?: boolean }) {
      const [unit, setUnit] = useState("set");
      const [city, setCity] = useState("");
      const hidden = useRef<HTMLInputElement>(null);
      // Like the logo field: it tells the form about itself when it appears.
      useEffect(() => {
        hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
      }, []);
      // A value that arrives a moment after the window opens.
      useEffect(() => {
        if (!late) return;
        const t = setTimeout(() => setCity("Lahore"), 10);
        return () => clearTimeout(t);
      }, [late]);
      return (
        <PanelBody>
          <input aria-label="Name" name="name" defaultValue="Lahore Pharma" />
          <input aria-label="City" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
          <input aria-label="Active" name="active" type="checkbox" defaultChecked />
          <input ref={hidden} type="hidden" name="unit" value={unit} />
          <button type="button" onClick={() => setUnit(unit === "set" ? "pcs" : "set")}>
            Unit: {unit}
          </button>
        </PanelBody>
      );
    }
    const show = (late?: boolean) => {
      const onClose = vi.fn();
      render(
        <SidePanel title="Edit customer · Lahore Pharma" onClose={onClose}>
          <Editor late={late} />
        </SidePanel>,
      );
      return onClose;
    };
    /** As a person types: the key first, then the field changes. */
    const type = (el: HTMLElement, value: string) => {
      fireEvent.keyDown(el, { key: value.slice(-1) || "Backspace" });
      fireEvent.input(el, { target: { value } });
    };
    const close = () => fireEvent.click(screen.getByRole("button", { name: "Close the panel" }));
    const asks = () => screen.queryByRole("alertdialog", { name: "Discard changes?" }) !== null;

    it("opened and closed with nothing touched: closes at once (a field that announces itself is not a change)", () => {
      const onClose = show();
      fireEvent.pointerDown(screen.getByLabelText("Name"));
      close();
      expect(asks()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("typed and put back as it was: nothing changed", () => {
      const onClose = show();
      type(screen.getByLabelText("Name"), "Lahore Pharma Ltd");
      close();
      expect(asks()).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      type(screen.getByLabelText("Name"), "Lahore Pharma");
      close();
      expect(asks()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a tick or a choice with no typing is a change; put back, it is not", () => {
      const onClose = show();
      fireEvent.pointerDown(screen.getByLabelText("Active"));
      fireEvent.click(screen.getByLabelText("Active"));
      close();
      expect(asks()).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      fireEvent.click(screen.getByLabelText("Active"));
      // The choice kept in a hidden field.
      fireEvent.pointerDown(screen.getByRole("button", { name: "Unit: set" }));
      fireEvent.click(screen.getByRole("button", { name: "Unit: set" }));
      close();
      expect(asks()).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      fireEvent.click(screen.getByRole("button", { name: "Unit: pcs" }));
      close();
      expect(asks()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("what the form fills in by itself after it opens is not a change", async () => {
      const onClose = show(true);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Lahore");
      fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
      expect(asks()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("the small window follows the same rule", () => {
      const onClose = vi.fn();
      render(
        <Modal title="Cancel the order?" onClose={onClose}>
          <input aria-label="Reason" name="reason" />
        </Modal>,
      );
      // Untouched: Escape closes it.
      fireEvent.keyDown(screen.getByLabelText("Reason"), { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      // Something typed: it asks; Discard closes.
      type(screen.getByLabelText("Reason"), "Customer changed their mind");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(asks()).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
