import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EmailPanel, ShareButton, type Outgoing } from "@/components/send/send";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const ci: Outgoing = { key: "commercial-invoice", name: "Commercial invoice CI-2026-0572.pdf", download: "/pdf/commercial-invoice/1", paper: "commercial-invoice" };
const pl: Outgoing = { key: "packing-list", name: "Packing list PL-2026-0572.pdf", download: "/pdf/packing-list/1", paper: "packing-list" };

/** Email and Share (design 26 Nov 2026): two buttons for everything that goes out, set by props. */
describe("Email and Share", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });

  it("Email: from the app, or I'll send it myself (my mail app, or I sent it already: how and when)", () => {
    const emailAction = vi.fn(async () => ({ ok: true }));
    const markAction = vi.fn(async () => ({ ok: true }));
    render(
      <EmailPanel
        title="Email the commercial invoice"
        onClose={() => {}}
        items={[ci, pl]}
        to={{ name: "Ayesha Khan", email: "ayesha@vp.test", cc: "boss@vp.test" }}
        subject={(chosen) => (chosen.length > 1 ? "Documents" : "Commercial invoice")}
        message="Dear Ayesha"
        emailAction={emailAction}
        markAction={markAction}
        today="2026-11-26"
      />,
    );
    const w = screen.getByRole("dialog", { name: "Email the commercial invoice" });
    // From the app: who to, the copy, the subject; the order's other document offered, not ticked.
    expect(within(w).getByLabelText(/^To/)).toHaveProperty("value", "ayesha@vp.test");
    expect(within(w).getByLabelText(/^Copy/)).toHaveProperty("value", "boss@vp.test");
    expect(within(w).getByLabelText("Subject")).toHaveProperty("value", "Commercial invoice");
    const also = within(w).getByRole("checkbox", { name: /Packing list/ });
    expect(also).toHaveProperty("checked", false);
    fireEvent.click(also);
    expect(within(w).getByLabelText("Subject")).toHaveProperty("value", "Documents");
    expect(within(w).getByRole("button", { name: /Send 2/ })).toBeTruthy();
    // Myself: the mail app first; or it went already, how and when.
    fireEvent.click(within(w).getByText("I'll send it myself"));
    expect(within(w).getByRole("button", { name: /Open my mail app/ })).toBeTruthy();
    fireEvent.click(within(w).getByText("I sent it already"));
    expect(within(w).getByLabelText("How")).toBeTruthy();
    expect(within(w).getByLabelText(/Sent on/)).toBeTruthy();
    expect(within(w).getByRole("button", { name: /Note 2 as sent/ })).toBeTruthy();
  });

  it("Email without a place to note it offers only the mail app among the ways to send it yourself", () => {
    render(
      <EmailPanel title="Email statement" onClose={() => {}} items={[ci]} to={null} subject="Statement" message="" emailAction={async () => ({ ok: true })} today="2026-11-26" />,
    );
    fireEvent.click(screen.getByText("I'll send it myself"));
    expect(screen.queryByText("I sent it already")).toBeNull();
    expect(screen.getByRole("button", { name: /Open my mail app/ })).toBeTruthy();
  });

  it("Share: WhatsApp opens with the message to their number, the PDF downloads, and it is noted", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const noteAction = vi.fn(async () => ({ ok: true }));
    render(<ShareButton items={[ci]} message="Dear Ayesha, attached." to={{ name: "Ayesha Khan", phone: "+92 300 555 1234" }} noteAction={noteAction} />);
    fireEvent.click(screen.getByRole("button", { name: /^Share$/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /WhatsApp/ }));
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0]![0]).toBe(`https://wa.me/923005551234?text=${encodeURIComponent("Dear Ayesha, attached.")}`);
    await vi.waitFor(() => expect(noteAction).toHaveBeenCalledWith("whatsapp"));
    open.mockRestore();
  });

  it("Share that marks something sent asks first", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const noteAction = vi.fn(async () => ({ ok: true }));
    render(<ShareButton items={[ci]} message="Hi" noteAction={noteAction} ask={{ question: "Mark R1 as sent {via}?", confirmLabel: "Mark R1 as sent" }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Share$/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /WhatsApp/ }));
    await vi.waitFor(() => expect(screen.getByText("Mark R1 as sent on WhatsApp?")).toBeTruthy());
    expect(noteAction).not.toHaveBeenCalled();
  });
});
