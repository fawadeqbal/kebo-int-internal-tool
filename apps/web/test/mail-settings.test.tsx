import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MailAccountView, MailSettingsView } from "@kebo/shared";

// Admin settings › Email accounts: Gmail, an SMTP server or Resend; the password or key is never shown.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { AccountForm, TestForm, UsesForm } = await import("@/app/(app)/settings/mail/cards");

const sales: MailAccountView = {
  id: "a1",
  provider: "resend",
  fromName: "Kebo Sales",
  fromEmail: "sales@kebo.test",
  host: "",
  port: null,
  username: "",
  hasSecret: true,
};
const accounts: MailAccountView = {
  id: "a2",
  provider: "gmail",
  fromName: "",
  fromEmail: "accounts@kebo.test",
  host: "",
  port: null,
  username: "",
  hasSecret: true,
};
const none: MailSettingsView = { accounts: [], defaultId: null, uses: {}, choose: true, serverDefault: false, enabled: false };
const two: MailSettingsView = {
  accounts: [sales, accounts],
  defaultId: "a1",
  uses: { customers: "a1", staff: null },
  choose: true,
  serverDefault: false,
  enabled: true,
};
const noop = async () => ({ ok: true });
const field = (id: string) => document.getElementById(id) as HTMLInputElement | null;

describe("connecting an email", () => {
  it("starts on Gmail with only what Gmail needs", () => {
    render(<AccountForm action={noop} />);
    expect(screen.getByText("Connect an email")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Gmail/ }) as HTMLInputElement).checked).toBe(true);
    expect(field("mail-host")).toBeNull();
    expect(screen.getByText("App password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("shows the fields of the way that is chosen", () => {
    render(<AccountForm action={noop} />);
    fireEvent.click(screen.getByRole("radio", { name: /SMTP server/ }));
    expect(field("mail-host")).toBeTruthy();
    expect(field("mail-port")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Resend/ }));
    expect(field("mail-host")).toBeNull();
    expect(field("mail-user")).toBeNull();
    expect(screen.getByText("API key")).toBeTruthy();
  });

  it("changes one without its key, which is asked again only for another way", () => {
    render(<AccountForm account={sales} action={noop} />);
    expect(screen.getByText("Change sales@kebo.test")).toBeTruthy();
    expect(field("mail-from")!.value).toBe("sales@kebo.test");
    expect(field("mail-secret")!.value).toBe("");
    expect(screen.getByText(/Leave empty to keep it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Gmail/ }));
    expect(screen.queryByText(/Leave empty to keep it/)).toBeNull();
  });
});

describe("which email sends what", () => {
  it("offers each connected address for each kind, the default, and the choice when sending", () => {
    render(<UsesForm view={two} action={noop} />);
    const customers = screen.getByLabelText(/Quotations and documents to customers/) as HTMLSelectElement;
    expect(customers.value).toBe("a1");
    expect([...customers.options].map((o) => o.text)).toEqual([
      "The default address",
      "Kebo Sales · sales@kebo.test",
      "accounts@kebo.test",
    ]);
    expect((screen.getByLabelText(/Sign-in codes/) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(/^The default address/) as HTMLSelectElement).value).toBe("a1");
    expect((screen.getByRole("checkbox", { name: /choose the address when sending/ }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("the test email", () => {
  it("cannot be sent before an email is connected, and goes to the person signed in", () => {
    render(<TestForm view={none} me="admin@kebo.test" action={noop} />);
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true);
    expect(field("mail-test-to")!.value).toBe("admin@kebo.test");
  });

  it("asks which address to send from when there are several", () => {
    render(<TestForm view={two} me="admin@kebo.test" action={noop} />);
    expect((field("mail-test-from") as unknown as HTMLSelectElement).value).toBe("a1");
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
