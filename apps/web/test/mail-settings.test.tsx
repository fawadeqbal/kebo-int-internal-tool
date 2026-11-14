import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MailSettingsView } from "@kebo/shared";

// Admin settings › Email sending: Gmail, an SMTP server or Resend; the password or key is never shown.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { MailCards } = await import("@/app/(app)/settings/mail/cards");

const none: MailSettingsView = { provider: null, fromName: "", fromEmail: "", host: "", port: null, username: "", hasSecret: false, serverDefault: false, enabled: false };
const noop = async () => ({ ok: true });
const show = (view: MailSettingsView) => render(<MailCards view={view} me="admin@kebo.test" saveAction={noop} removeAction={noop} testAction={noop} />);
const field = (id: string) => document.getElementById(id) as HTMLInputElement | null;

describe("the email sending page", () => {
  it("starts on Gmail with only what Gmail needs, and cannot test before anything is saved", () => {
    show(none);
    expect(screen.getByText("Not set: no email is sent")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Gmail/ }) as HTMLInputElement).checked).toBe(true);
    expect(field("mail-host")).toBeNull();
    expect(screen.getByText("App password")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Remove this setting" })).toBeNull();
  });

  it("shows the fields of the way that is chosen", () => {
    show(none);
    fireEvent.click(screen.getByRole("radio", { name: /SMTP server/ }));
    expect(field("mail-host")).toBeTruthy();
    expect(field("mail-port")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Resend/ }));
    expect(field("mail-host")).toBeNull();
    expect(field("mail-user")).toBeNull();
    expect(screen.getByText("API key")).toBeTruthy();
  });

  it("shows what is saved without the key, which is asked again only for another way", () => {
    show({ provider: "resend", fromName: "Kebo", fromEmail: "sales@kebo.test", host: "", port: null, username: "", hasSecret: true, serverDefault: true, enabled: true });
    expect(screen.getByText("Resend · from sales@kebo.test")).toBeTruthy();
    expect(field("mail-from")!.value).toBe("sales@kebo.test");
    expect(field("mail-secret")!.value).toBe("");
    expect(screen.getByText(/Leave empty to keep it/)).toBeTruthy();
    // The test goes to the person signed in unless they type another address.
    expect(field("mail-test-to")!.value).toBe("admin@kebo.test");
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Remove this setting" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Gmail/ }));
    expect(screen.queryByText(/Leave empty to keep it/)).toBeNull();
  });

  it("says when the server's own email is used", () => {
    show({ ...none, serverDefault: true, enabled: true });
    expect(screen.getByText("Not set: sent through the server's own email")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
