import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ISODate } from "@kebo/utils";
import type { CompanyDetail } from "@/lib/types-platform";
import { attention, headline, paidShare, paidState, sectionHref, sectionOf, storage } from "@/app/platform/(admin)/companies/[id]/model";
import {
  BillingSection,
  DetailsSection,
  OverviewSection,
  PeopleSection,
  PlanSection,
} from "@/app/platform/(admin)/companies/[id]/sections";

const today = "2026-11-04" as ISODate;
const noop = async () => ({ ok: true });

/** A client company on a plan, paid up, two people (one tenant admin without two-step). */
function company(over: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    id: "c1",
    slug: "kebo",
    name: "Kebo International",
    kind: "client",
    status: "active",
    statusReason: null,
    statusManual: false,
    plan: {
      id: "p1",
      name: "Pro",
      maxUsers: 10,
      maxStorageMb: 5120,
      features: ["excel", "shipping", "delivery_sat"],
      priceMinor: 49000,
      currency: "USD",
      period: "month",
    },
    startsOn: "2026-08-14",
    renewsOn: "2026-11-30",
    endsAt: null,
    billing: "active",
    contactName: "Fawad Iqbal",
    contactEmail: "fawad@example.com",
    contactPhone: null,
    notes: null,
    lastActiveAt: "2026-11-04T06:20:00Z",
    createdAt: "2026-08-14T00:00:00Z",
    deletedAt: null,
    previousSlug: null,
    usage: { users: 2, storageMb: 1200 },
    warnings: [],
    address: "https://kebo.rfq.test",
    profile: {
      legalName: "Shandong Kebo International Trade Co., Ltd.",
      address: "Jinan",
      taxNo: null,
      phone: null,
      email: null,
      website: null,
    },
    modulesOff: [{ feature: "delivery_sat", at: "2026-10-28T00:00:00Z", by: "Fawad" }],
    logCount: 3,
    planFeatures: ["excel", "shipping", "delivery_sat"],
    featuresOff: ["delivery_sat"],
    activity: {
      signInsLast30Days: 14,
      signedInThisWeek: 2,
      lastSignIn: { at: "2026-11-04T06:20:00Z", email: "sana@kebo.test", name: "Sana" },
      inquiries: 212,
      inquiriesLast30Days: 18,
      orders: 64,
      openOrders: 5,
      customers: 119,
      factories: 125,
      twoStepOff: 1,
      people: [
        {
          id: "u1",
          name: "Fawad Iqbal",
          email: "fawad@kebo.test",
          active: true,
          lastLoginAt: "2026-11-04T06:02:00Z",
          role: "Super Admin",
          tenantAdmin: true,
          twoStep: false,
          locked: false,
        },
        {
          id: "u2",
          name: "Sana",
          email: "sana@kebo.test",
          active: true,
          lastLoginAt: "2026-11-04T05:40:00Z",
          role: "Manager",
          tenantAdmin: false,
          twoStep: true,
          locked: false,
        },
      ],
    },
    payments: [
      {
        id: "pay1",
        amountMinor: 49000,
        currency: "USD",
        paidOn: "2026-11-01",
        paidUntil: "2026-11-30",
        note: "Bank transfer",
        createdAt: "2026-11-01T00:00:00Z",
      },
    ],
    log: [
      {
        id: "l1",
        adminName: "Fawad",
        action: "payment",
        companyId: "c1",
        leadId: null,
        summary: "Kebo paid USD 490.00",
        at: "2026-11-01T00:00:00Z",
      },
    ],
    leads: [],
    ...over,
  };
}
const demo = (over: Partial<CompanyDetail> = {}) =>
  company({
    kind: "demo",
    renewsOn: null,
    endsAt: new Date(Date.now() + 20 * 3_600_000).toISOString(),
    billing: "trial",
    payments: [],
    ...over,
  });
const deleted = () => company({ status: "deleted", activity: null, profile: null, usage: null, deletedAt: "2026-11-02T00:00:00Z" });

/** Primary (purple) buttons, not switches: the page's one primary is in its header, so a section has none. */
const primaries = (el: HTMLElement) =>
  [...el.querySelectorAll("a.bg-primary-solid, button.bg-primary-solid")].filter((b) => b.getAttribute("role") !== "switch");

// ⋯ menus ask whether this is a phone.
// Wide tables fade at their scrolled edge.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
window.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia;

describe("company page: sections in the URL", () => {
  it("?section= picks a section; anything else is the Overview", () => {
    expect(sectionOf("people")).toBe("people");
    expect(sectionOf("billing")).toBe("billing");
    expect(sectionOf(undefined)).toBe("overview");
    expect(sectionOf("nope")).toBe("overview");
    expect(sectionOf(["history", "x"])).toBe("history");
    expect(sectionHref("c1", "overview")).toBe("/platform/companies/c1");
    expect(sectionHref("c1", "plan")).toBe("/platform/companies/c1?section=plan");
    expect(sectionHref("c1", "overview", { panel: "status", id: "active" })).toBe("/platform/companies/c1?panel=status&id=active");
  });
});

describe("company page: where it stands", () => {
  it("one word in the header badge, by meaning", () => {
    expect(headline(company())).toEqual({ label: "Active", meaning: "ok" });
    expect(headline(company({ billing: "overdue" }))).toEqual({ label: "Overdue", meaning: "bad" });
    expect(headline(company({ status: "off" }))).toEqual({ label: "Off", meaning: "bad" });
    expect(headline(company({ status: "read_only" }))).toEqual({ label: "Read-only", meaning: "warn" });
    expect(headline(demo())).toEqual({ label: "Demo", meaning: "info" });
    expect(headline(demo({ kind: "trial", endsAt: "2026-01-01T00:00:00Z" }))).toEqual({ label: "Trial ended", meaning: "warn" });
    expect(headline(deleted())).toEqual({ label: "Deleted", meaning: "neutral" });
  });

  it("paid until: state, and how far into the paid period", () => {
    expect(paidState(company(), today)).toMatchObject({ label: "Paid", meaning: "ok", sub: "renews in 26 days" });
    expect(paidState(company({ renewsOn: "2026-11-08" }), today)).toMatchObject({ label: "Due soon", meaning: "warn" });
    expect(paidState(company({ renewsOn: "2026-10-26" }), today)).toMatchObject({
      label: "Overdue",
      meaning: "bad",
      sub: "overdue by 9 days",
    });
    expect(paidState(demo(), today)).toBeNull();
    expect(paidShare(company(), today)).toBe(10);
    expect(storage(640)).toBe("640 MB");
    expect(storage(1229)).toBe("1.2 GB");
  });

  it("needs attention: renewal, two-step off, limits, a demo ending; each says where to deal with it", () => {
    const items = attention(company({ renewsOn: "2026-11-20", usage: { users: 9, storageMb: 100 } }), today);
    expect(items.map((i) => [i.key, i.link])).toEqual([
      ["renewal", "Billing"],
      ["two-step", "People"],
      ["people-limit", "Plan"],
    ]);
    expect(items[0]).toMatchObject({ title: "Renewal in 16 days", href: "/platform/companies/c1?section=billing" });
    expect(items[0]!.sub).toContain("USD 490 a month");
    expect(items[1]!.title).toBe("Two-step sign-in is off for 1 person");
    expect(attention(company({ renewsOn: "2026-10-30" }), today)[0]).toMatchObject({ meaning: "bad", title: "Payment overdue by 5 days" });
    expect(attention(demo(), today)[0]).toMatchObject({ key: "ends", link: "Plan" });
    const off = attention(company({ status: "off", statusManual: true, statusReason: "Asked to pause" }), today)[0]!;
    expect(off).toMatchObject({ meaning: "bad", link: "Switch on", href: "/platform/companies/c1?panel=status&id=active" });
    expect(attention(deleted(), today)).toEqual([]);
  });
});

describe("company page: each element only where it can be used", () => {
  it("Overview: tiles, needs attention with its links, what they do, recent history; no primary of its own", () => {
    const { container } = render(<OverviewSection c={company()} today={today} />);
    expect(screen.getByText("2 of 10")).toBeTruthy();
    expect(screen.getByText("1.2 GB of 5 GB")).toBeTruthy();
    expect(screen.getByText("30 Nov 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: /People/ }).getAttribute("href")).toBe("/platform/companies/c1?section=people");
    expect(screen.getByText("64 · 5 open")).toBeTruthy();
    expect(screen.getByText("119 · 125")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All history" }).getAttribute("href")).toBe("/platform/companies/c1?section=history");
    expect(primaries(container)).toHaveLength(0);
  });

  it("People: two-step and sign-in for each; ⋯ (set-password link) only on a tenant admin, and not once deleted", () => {
    const { container, unmount } = render(<PeopleSection c={company()} />);
    const rows = within(container.querySelector("tbody")!).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("button", { name: "Actions for Fawad Iqbal" })).toBeTruthy();
    expect(within(rows[1]!).queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: "People · 2 of 10" })).toBeTruthy();
    unmount();
    render(<PeopleSection c={deleted()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Plan & modules: Change plan; the module switched off says when and by whom; a demo gets its card", () => {
    const { container, unmount } = render(<PlanSection c={company()} modules={noop} />);
    expect(screen.getByRole("button", { name: "Change plan" })).toBeTruthy();
    expect(screen.getByText(/Switched off for this company on 28 Oct 2026 by Fawad/)).toBeTruthy();
    expect(screen.getAllByText("not in plan").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Demo" })).toBeNull();
    expect(primaries(container)).toHaveLength(0);
    unmount();
    render(<PlanSection c={demo()} modules={noop} />);
    expect(screen.getByRole("heading", { name: "Demo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Extend…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make it a client" })).toBeTruthy();
  });

  it("Billing: + Record payment and ⋯ Remove for a client; a demo has no payments to record; deleted: read-only", () => {
    const { unmount } = render(<BillingSection c={company()} today={today} removePayment={{ pay1: noop }} />);
    expect(screen.getByRole("button", { name: /Record payment/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Actions for the payment/ })).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    unmount();
    const d = render(<BillingSection c={demo()} today={today} removePayment={{}} />);
    expect(screen.queryByRole("button", { name: /Record payment/ })).toBeNull();
    expect(screen.getByText("A demo has no payments")).toBeTruthy();
    d.unmount();
    render(<BillingSection c={{ ...deleted(), payments: company().payments }} today={today} removePayment={{ pay1: noop }} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("Details: ✎ Edit on the groups the platform changes; their own papers and the limits are read-only; nothing once deleted", () => {
    const { unmount } = render(<DetailsSection c={company()} />);
    for (const name of ["Edit company", "Edit main contact", "Edit web address", "Edit notes"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit address and papers|Edit limits/ })).toBeNull();
    // Missing and editable: + Add in place.
    expect(screen.getByRole("button", { name: "Add phone / whatsapp" })).toBeTruthy();
    expect(screen.getByText("Shandong Kebo International Trade Co., Ltd.")).toBeTruthy();
    expect(screen.getByText(/From their Settings → Company/)).toBeTruthy();
    unmount();
    render(<DetailsSection c={deleted()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
