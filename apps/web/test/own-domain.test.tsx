import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Company settings › Company address › Your own domain: not connected, waiting for the record, connected, lost.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/settings/address", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/app/(app)/settings/address/actions", () => ({ connectDomainAction: vi.fn(), checkDomainAction: vi.fn(), removeDomainAction: vi.fn() }));

const { DomainCard } = await import("@/app/(app)/settings/address/domain-card");
type View = Parameters<typeof DomainCard>[0]["view"];

const base: NonNullable<View> = {
  enabled: true,
  canChange: true,
  ours: "acme.rfq.test",
  domain: null,
  status: null,
  problem: null,
  checkedAt: null,
  since: null,
  lostAt: null,
  record: null,
};
const record = { type: "CNAME" as const, name: "erp", value: "connect.rfq.test", zone: "acme.com" };
const show = async (view: View) => render(await DomainCard({ view }));

describe("your own domain", () => {
  it("is not shown where the server does not offer it", async () => {
    const { container } = await show({ ...base, enabled: false });
    expect(container.textContent).toBe("");
  });

  it("not connected: the team uses our address; Connect a domain opens the window", async () => {
    await show(base);
    expect(screen.getByText("Not connected. Your team uses acme.rfq.test.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("button", { name: /Connect a domain/ })).toBeTruthy();
  });

  it("waiting: the one record to add, with Copy, and Check now", async () => {
    await show({ ...base, domain: "erp.acme.com", status: "waiting", problem: "no_record", checkedAt: new Date(Date.now() - 2 * 60_000).toISOString(), record });
    expect(screen.getByText("Waiting for the record")).toBeTruthy();
    expect(screen.getByText("Add this record where acme.com is managed")).toBeTruthy();
    expect(screen.getByText("CNAME")).toBeTruthy();
    expect(screen.getByText("connect.rfq.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy connect.rfq.test" })).toBeTruthy();
    expect(screen.getByText(/Checked 2 minutes ago: not found yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Check now/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("connected: the domain is the address; Remove asks first", async () => {
    await show({ ...base, domain: "erp.acme.com", status: "connected", since: "2026-11-14T10:00:00Z", record });
    expect(screen.getByRole("link", { name: "erp.acme.com" }).getAttribute("href")).toBe("https://erp.acme.com");
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText(/Since 14 Nov 2026 · your team signs in here/)).toBeTruthy();
    expect(screen.queryByText("CNAME")).toBeNull();
    expect(screen.queryByRole("button", { name: /Check now/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("alertdialog", { name: "Remove erp.acme.com?" }).textContent).toMatch(/goes back to acme\.rfq\.test/);
  });

  it("lost: the record again, and where the team works until it is back", async () => {
    await show({ ...base, domain: "erp.acme.com", status: "lost", since: "2026-11-14T10:00:00Z", lostAt: "2026-11-20T09:00:00Z", record });
    expect(screen.getByText("Record not found")).toBeTruthy();
    expect(screen.getByText("The record was there until 20 Nov 2026 and is gone. Your team uses acme.rfq.test until it is back.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Check now/ })).toBeTruthy();
  });

  it("someone who may not change it only reads it", async () => {
    await show({ ...base, canChange: false, domain: "erp.acme.com", status: "connected", record });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Connect a domain/ })).toBeNull();
  });
});
