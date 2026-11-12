import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Dashboard } from "@/lib/types-platform";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect ${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/platform/plans",
}));
// The shell's Sign out is a server action; not called here.
vi.mock("@/app/platform/actions", () => ({ platformLogoutAction: vi.fn() }));

const where = async (run: () => unknown) => {
  try {
    await run();
  } catch (e) {
    return (e as Error).message.replace(/^redirect /, "");
  }
  return null;
};

describe("old platform URLs land in Platform settings", () => {
  it("/platform/website → Settings › Website", async () => {
    const { default: Page } = await import("@/app/platform/(admin)/website/page");
    expect(await where(() => Page())).toBe("/platform/settings?section=website");
  });
  it("/platform/account → Settings › My account, with the password panel when it was asked for", async () => {
    const { default: Page } = await import("@/app/platform/(admin)/account/page");
    expect(await where(() => Page({ searchParams: Promise.resolve({}) }))).toBe("/platform/settings?section=account");
    expect(await where(() => Page({ searchParams: Promise.resolve({ panel: "password" }) }))).toBe(
      "/platform/settings?section=account&panel=password",
    );
  });
});

const dash = (over: Partial<Dashboard> = {}): Dashboard => ({
  paying: 14,
  payingNewThisMonth: 2,
  incomeThisMonth: [{ currency: "USD", amountMinor: 588000 }],
  incomeLastMonth: [{ currency: "USD", amountMinor: 525000 }],
  renewals: 6,
  renewalsDue: [{ currency: "USD", amountMinor: 245000 }],
  trials: 8,
  trialsEndingThisWeek: 3,
  newLeads: 4,
  newLeadsDemoRequests: 2,
  leadsThisWeek: 4,
  serverWarnings: [],
  watch: [],
  overdue: [],
  ending: [],
  ...over,
});

describe("platform overview", () => {
  it("money in words, and this month against last", async () => {
    const { moneyText, versus } = await import("@/app/platform/(admin)/overview");
    expect(moneyText([{ currency: "USD", amountMinor: 588000 }])).toBe("USD 5,880");
    expect(moneyText([])).toBe("USD 0");
    expect(versus(dash().incomeThisMonth, dash().incomeLastMonth, "October")).toBe("▲ 12% vs October");
    expect(versus([], [], "October")).toBeNull();
  });

  it("needs attention: overdue, demos ending, server warnings, new inquiries, follow-ups; each with where to go", async () => {
    const { overviewAttention } = await import("@/app/platform/(admin)/overview");
    const items = overviewAttention(
      dash({
        overdue: [
          { id: "g", name: "Gulf Traders", days: 9 },
          { id: "l", name: "Lahore Machines", days: 3 },
        ],
        ending: [{ id: "a", name: "Accra Oils", endsAt: null }],
        serverWarnings: [
          { id: "w", title: "The last good backup is more than a day old", detail: "Last good: 26 hours ago", at: "2026-11-04T00:00:00Z" },
        ],
      }),
      [{ id: "lead1", name: "Kofi", companyName: "Accra Oils", status: "demo", followUpOn: "2026-11-04" }],
    );
    expect(items.map((i) => [i.key, i.meaning, i.link])).toEqual([
      ["overdue", "bad", "Companies"],
      ["ending", "warn", "Plan"],
      ["server-w", "warn", "Backups"],
      ["leads", "info", "Client inquiries"],
      ["follow-ups", "info", "Client inquiries"],
    ]);
    expect(items[0]).toMatchObject({ title: "2 companies are overdue", sub: "Gulf Traders 9 days, Lahore Machines 3 days" });
    expect(items[1]).toMatchObject({ href: "/platform/companies/a?section=plan" });
    expect(items[3]).toMatchObject({ title: "4 new client inquiries", sub: "2 asked for a demo", href: "/platform/leads?status=new" });
    expect(overviewAttention(dash({ newLeads: 0 }), [])).toEqual([]);
  });
});

describe("platform menu", () => {
  it("down the left, with counts; the page you are on is marked", async () => {
    const { PlatformShell } = await import("@/components/platform/shell");
    render(
      <PlatformShell admin={{ name: "Fawad Iqbal", email: "f@example.com" }} counts={{ companies: 24, newLeads: 7, plans: 3 }}>
        <p>page</p>
      </PlatformShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Platform" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/platform",
      "/platform/companies",
      "/platform/leads",
      "/platform/plans",
      "/platform/log",
      "/platform/settings",
    ]);
    expect(within(nav).getByRole("link", { name: /Plans/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /Client inquiries/ }).textContent).toContain("7 new");
    expect(within(nav).getByRole("link", { name: /Companies/ }).textContent).toContain("24");
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
  });
});

describe("client inquiry: progress", () => {
  it("New → Contacted → Demo given → Client, or Lost: passed steps ticked, the current one marked, Lost asks why", async () => {
    const { ProgressSteps } = await import("@/app/platform/(admin)/leads/[id]/panels");
    render(<ProgressSteps status="demo" action={async () => ({ ok: true })} />);
    const steps = within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual(["New", "Contacted", "Demo given", "Client", "Lost…"]);
    expect(within(steps[2]!).getByText("Demo given").getAttribute("aria-current")).toBe("step");
    expect(within(steps[0]!).getByRole("button", { name: "Move to New" }).getAttribute("value")).toBe("new");
    expect(within(steps[3]!).getByRole("button", { name: "Move to Client" })).toBeTruthy();
    expect(within(steps[4]!).getByRole("button", { name: "Lost…" }).getAttribute("aria-haspopup")).toBe("dialog");
    // No step is a primary button: the page's one primary is in its header.
    expect(document.querySelectorAll("button.bg-action-solid")).toHaveLength(0);
  });
});
