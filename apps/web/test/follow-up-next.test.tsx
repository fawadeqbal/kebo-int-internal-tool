import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// Finishing the last open follow-up of an open inquiry: the next one is set in the same window.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { FollowUpDoneNext } = await import("@/components/notes/note-forms");

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("done, and the next follow-up", () => {
  it("opens a window instead of finishing at once, with the next day and the same words filled in", () => {
    const action = vi.fn(async () => ({ ok: true }));
    render(<FollowUpDoneNext action={action} title="Reply to the customer" what="Reply to the customer" inquiryHref="/inquiries/abc" />);
    expect(screen.queryByText("Done, and the next follow-up")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark done: Reply to the customer" }));
    expect(screen.getByText("Done, and the next follow-up")).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
    // Three days on to start with; the day is required.
    expect(field("nextDueOn")!.value).toBe(iso(new Date(Date.now() + 3 * 86_400_000)));
    expect(field("nextDueOn")!.required).toBe(true);
    expect(field("nextTitle")!.value).toBe("Reply to the customer");
    expect(field("note")!.value).toBe("");
    // The other way out is on the inquiry itself.
    expect(screen.getByRole("link", { name: "Or mark the inquiry won or lost" }).getAttribute("href")).toBe("/inquiries/abc");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Done, and the next follow-up")).toBeNull();
  });

  it("sends what happened and the next follow-up in one save", async () => {
    let sent: Record<string, string> = {};
    const action = vi.fn(async (_prev: unknown, form: FormData) => {
      sent = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
      return { ok: true };
    });
    render(<FollowUpDoneNext action={action} title="Reply to the customer" what="Reply to the customer" inquiryHref="/inquiries/abc" as="check" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark done: Reply to the customer" }));
    fireEvent.change(field("note")!, { target: { value: "Called, no answer" } });
    fireEvent.change(field("nextDueOn")!, { target: { value: "2030-01-15" } });
    fireEvent.change(field("nextTitle")!, { target: { value: "Call again" } });
    await act(async () => {
      fireEvent.submit(field("note")!.closest("form")!);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(sent).toMatchObject({ note: "Called, no answer", nextDueOn: "2030-01-15", nextTitle: "Call again" });
  });
});
