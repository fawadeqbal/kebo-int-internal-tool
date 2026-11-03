import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
});
