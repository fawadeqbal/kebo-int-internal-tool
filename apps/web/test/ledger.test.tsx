import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { buildModules } from "@/lib/nav";
import { AgeingTiles, asRecorded, entryCells, periodOf, span } from "@/components/ledger/ledger-parts";
import { EntryBody, sourceHref } from "@/components/ledger/entry-body";
import type { LedgerEntry, LedgerListRow } from "@/lib/types-ledger";

// Finance › Ledger (approved page 34): the sidebar item, the period, one line of All entries (removed struck
// through, corrections saying what they reverse), the entry's side panel, ageing, the statement and the Excel.

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api", () => ({ api, ApiError: class ApiError extends Error {} }));

const row = (over: Partial<LedgerListRow> = {}): LedgerListRow => ({
  id: "r1",
  entryNo: 12,
  groupId: "g1",
  date: "2026-11-04",
  postedAt: "2026-11-04T09:14:00Z",
  type: "money_in",
  typeLabel: "Money in",
  source: { type: "payment", id: "p1" },
  ref: "RC-2026-0447-2",
  account: "money:a1",
  accountLabel: "Bank Alfalah USD",
  debit: "24202.72",
  credit: "0.00",
  currency: "USD",
  rate: 1,
  debitBase: "24202.72",
  creditBase: "0.00",
  with: { kind: "customer", id: "c1", name: "Lahore Pharma" },
  order: { id: "o1", refNo: "SO-2026-0447" },
  memo: "Balance for SO-2026-0447",
  reason: null,
  reversesId: null,
  correction: false,
  side: "debit",
  counter: { account: "customer:c1", label: "Lahore Pharma" },
  removed: null,
  ...over,
});

function Line({ r }: { r: LedgerListRow }) {
  const c = entryCells(r, "USD", "2026-11-04", "/finance/ledger?panel=entry&id=g1");
  return (
    <table>
      <tbody>
        <tr>
          <td>{c.day}</td>
          <td>{c.type}</td>
          <td>{c.ref}</td>
          <td>{c.with}</td>
          <td>{c.order}</td>
          <td>{c.what}</td>
          <td>{c.base}</td>
          <td>{c.recorded}</td>
        </tr>
      </tbody>
    </table>
  );
}

describe("the sidebar", () => {
  it("has Ledger after To receive, for those with ledger.view only", () => {
    const pages = (can: (p: string) => boolean) =>
      buildModules({ can, feature: () => true, approvals: null, approves: false, unread: 0, companyAddresses: false })
        .find((m) => m.key === "finance")
        ?.pages.map((p) => p.label);
    expect(pages(() => true)?.slice(0, 3)).toEqual(["To receive", "Ledger", "Cash book"]);
    expect(pages((p) => p === "ledger.view")).toEqual(["Ledger"]);
    expect(pages((p) => p !== "ledger.view")).not.toContain("Ledger");
  });
});

describe("the period", () => {
  it("defaults to since the first of last month, with its words", () => {
    expect(periodOf({}, "2026-11-04")).toEqual({ key: "recent", from: "2026-10-01", to: "2026-11-04", label: "1 Oct – 4 Nov 2026" });
    expect(periodOf({ period: "last-month" }, "2026-11-04")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodOf({ period: "year" }, "2026-01-15")).toMatchObject({ from: "2026-01-01", to: "2026-01-15" });
    expect(periodOf({ period: "last-year" }, "2026-03-01")).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(periodOf({ period: "all" }, "2026-11-04")).toMatchObject({ from: "2000-01-01", label: "All time" });
    // Typed days win; bad ones are ignored.
    expect(periodOf({ from: "2026-02-01", to: "2026-02-28" }, "2026-11-04")).toMatchObject({
      key: "custom",
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(periodOf({ from: "nonsense" }, "2026-11-04").key).toBe("recent");
    expect(span("2025-12-01", "2026-01-31")).toBe("1 Dec 2025 – 31 Jan 2026");
  });
});

describe("one line of All entries", () => {
  it("says the day, the type, the reference (opening the entry), who, the order, debit → credit and the amount", () => {
    render(<Line r={row()} />);
    expect(screen.getByText("04 Nov")).toBeTruthy();
    expect(screen.getByText("Money in")).toBeTruthy();
    expect(screen.getByRole("link", { name: "RC-2026-0447-2" }).getAttribute("href")).toBe("/finance/ledger?panel=entry&id=g1");
    expect(screen.getByText("Lahore Pharma")).toBeTruthy();
    expect(screen.getByRole("link", { name: "SO-2026-0447" }).getAttribute("href")).toBe("/orders/o1");
    expect(screen.getByText("Bank Alfalah USD → Lahore Pharma")).toBeTruthy();
    expect(screen.getByText("24,202.72")).toBeTruthy();
  });

  it("strikes a removed one through and says when; a correction says what it reverses and why, as a minus", () => {
    const { container } = render(<Line r={row({ removed: { on: "2026-10-30", reason: "wrong order" } })} />);
    expect(container.querySelectorAll("s").length).toBeGreaterThan(0);
    expect(screen.getByText("removed 30 Oct")).toBeTruthy();
    render(
      <Line
        r={row({
          id: "r2",
          type: "correction",
          typeLabel: "Correction",
          reversesId: "r1",
          side: "credit",
          debit: "0.00",
          credit: "1000.00",
          debitBase: "0.00",
          creditBase: "1000.00",
          reason: "Fawad: wrong order",
        })}
      />,
    );
    expect(screen.getByText("Correction")).toBeTruthy();
    expect(screen.getByText("Reverses RC-2026-0447-2 · Fawad: wrong order")).toBeTruthy();
    expect(screen.getByText("−1,000.00")).toBeTruthy();
    expect(screen.getByLabelText("(correction)")).toBeTruthy();
  });

  it("shows what was recorded in another currency with its rate", () => {
    expect(asRecorded({ currency: "CNY", debit: "62715.00", credit: "0", rate: 7.1 }, "USD")).toBe("CNY 62,715.00 @ 7.1");
    expect(asRecorded({ currency: "USD", debit: "5", credit: "0", rate: 1 }, "USD")).toBe("USD");
  });
});

describe("the entry in the side panel", () => {
  const entry: LedgerEntry = {
    groupId: "g1",
    entryNo: 12,
    date: "2026-11-04",
    postedAt: "2026-11-04T09:14:00Z",
    type: "money_in",
    typeLabel: "Money in",
    ref: "RC-2026-0447-2",
    memo: "Balance for SO-2026-0447",
    reason: null,
    postedBy: { id: "u1", name: "Fawad" },
    rows: [
      { ...row(), id: "a" },
      { ...row(), id: "b", account: "bank_charges", accountLabel: "Bank charges", debit: "45.00", debitBase: "45.00" },
      {
        ...row(),
        id: "c",
        account: "customer:c1",
        accountLabel: "Lahore Pharma",
        debit: "0.00",
        credit: "24247.72",
        debitBase: "0.00",
        creditBase: "24247.72",
      },
    ],
    totals: { debit: "24247.72", credit: "24247.72" },
    reversedBy: [],
    reverses: null,
    related: [],
    source: {
      type: "payment",
      id: "p1",
      orderId: "o1",
      customerId: "c1",
      factoryId: null,
      userId: null,
      label: "Payment on SO-2026-0447",
      file: { kind: "payment", id: "p1", name: "bank-slip-0447.jpg" },
      recordedBy: "Bilal · sent for approval 2026-11-03",
      approvedBy: "Fawad",
      settles: "Balance (plan row 2) on SO-2026-0447 · now paid",
      removed: null,
    },
  };

  it("shows both sides balanced, what it settles, who, the file, and the way to the payment", () => {
    render(<EntryBody e={entry} main="USD" back="/finance/ledger" />);
    const table = within(screen.getByRole("table", { name: "Entry 12: both sides" }));
    expect(table.getByText("Bank charges")).toBeTruthy();
    expect(table.getAllByText("24,247.72")).toHaveLength(3);
    expect(screen.getByText("Balance (plan row 2) on SO-2026-0447 · now paid")).toBeTruthy();
    expect(screen.getByText("Bilal · sent for approval 2026-11-03")).toBeTruthy();
    expect(screen.getByRole("link", { name: "bank-slip-0447.jpg" }).getAttribute("href")).toBe("/files/payments/p1");
    expect(screen.getByRole("link", { name: "Open the payment" }).getAttribute("href")).toBe("/orders/o1/payment");
    expect(screen.getByRole("link", { name: "Receipt PDF" }).getAttribute("href")).toContain("/print/orders/o1/payment-receipt?ref=p1");
    expect(screen.getByText(/can.t be edited/)).toBeTruthy();
  });

  it("knows where every kind of document is", () => {
    const s = entry.source;
    expect(sourceHref({ ...s, type: "expense", orderId: null })?.href).toBe("/finance/expenses");
    expect(sourceHref({ ...s, type: "transfer" })?.href).toBe("/finance/cash-book");
    expect(sourceHref({ ...s, type: "purchase_order" })?.href).toBe("/orders/o1/factory");
    expect(sourceHref({ ...s, type: "credit" })?.href).toBe("/customers/c1");
  });
});

describe("ageing", () => {
  it("five tiles, the late ones coloured, each with what is in it", () => {
    render(
      <AgeingTiles
        currency="USD"
        buckets={[
          {
            bucket: "not_due",
            label: "Not due yet",
            base: "10391.88",
            items: [
              {
                orderId: "o",
                refNo: "SO-2026-0461",
                label: "Deposit",
                dueOn: "2026-11-15",
                currency: "USD",
                amount: "10391.88",
                base: "10391.88",
              },
            ],
          },
          { bucket: "d1_30", label: "1–30 days late", base: "62.00", items: [] },
          { bucket: "d31_60", label: "31–60 days", base: "0", items: [] },
          { bucket: "d61_90", label: "61–90 days", base: "10391.88", items: [] },
          { bucket: "d90_plus", label: "90+ days", base: "0", items: [] },
        ]}
      />,
    );
    const tiles = within(screen.getByRole("region", { name: "Ageing" }));
    expect(tiles.getByText("SO-2026-0461 · Deposit")).toBeTruthy();
    expect(tiles.getByText("USD 62.00").className).toContain("text-warn");
    expect(tiles.getAllByText("USD 10,391.88")[1]!.className).toContain("text-bad");
    expect(tiles.getAllByText("USD 0.00")).toHaveLength(2);
  });
});

describe("Excel", () => {
  it("the ledger: both sides of every entry the filters keep, in its currency and the main one", async () => {
    api.get.mockResolvedValueOnce({
      rows: [
        row(),
        row({
          id: "r2",
          side: "credit",
          account: "customer:c1",
          accountLabel: "Lahore Pharma",
          debit: "0.00",
          credit: "24202.72",
          debitBase: "0",
          creditBase: "24202.72",
        }),
      ],
      total: 2,
    });
    const { EXPORTS } = await import("@/lib/exports");
    const spec = (await EXPORTS.ledger({ from: "2026-10-01", to: "2026-11-04", cur: "USD", removed: "0", order: "bad" })) as {
      columns: { header: string }[];
      rows: unknown[][];
    };
    expect(api.get).toHaveBeenCalledWith(
      "/ledger/entries",
      expect.objectContaining({
        from: "2026-10-01",
        to: "2026-11-04",
        currency: "USD",
        removed: "false",
        orderId: undefined,
        page: 1,
        pageSize: 100,
      }),
    );
    expect(spec.columns.map((c) => c.header)).toEqual(
      expect.arrayContaining(["Entry", "Account", "Debit", "Credit", "Debit (main)", "Credit (main)"]),
    );
    expect(spec.rows).toHaveLength(2);
    expect(spec.rows[1]![4]).toBe("Lahore Pharma");
  });

  it("a party's ledger: opening, rows with the balance, closing; a bad party is not found", async () => {
    api.get.mockResolvedValueOnce({
      party: { kind: "customer", id: "c1", name: "Lahore Pharma", country: "PK" },
      from: "2026-10-01",
      to: "2026-11-04",
      currencies: [{ currency: "USD", opening: "10391.88", closing: "20845.76" }],
      rows: [{ ...row(), balance: "34639.60" }],
    });
    const { EXPORTS, ExportNotFound } = await import("@/lib/exports");
    const spec = (await EXPORTS["ledger-party"]({ kind: "customer", id: "0b6c7a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b" })) as { rows: unknown[][] };
    expect(spec.rows.map((r) => r[1])).toEqual(["Opening balance", "Balance for SO-2026-0447", "Closing balance"]);
    await expect(EXPORTS["ledger-party"]({ kind: "nobody", id: "x" })).rejects.toBeInstanceOf(ExportNotFound);
  });
});

describe("the statement", () => {
  it("is given its number and answers where it prints, downloads and what to say; bad input makes none", async () => {
    api.post.mockResolvedValueOnce({ no: 12, number: "ST-F-2026-0012" });
    api.get.mockResolvedValueOnce({ share: { fileName: "Statement ST-F-2026-0012 Henan Pack", message: "Dear Henan Pack…" } });
    const { issueStatementAction } = await import("@/app/(app)/finance/ledger/actions");
    const id = "0b6c7a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const s = await issueStatementAction("factory", id, {
      from: "2026-10-01",
      to: "2026-11-04",
      cur: "CNY",
      back: "/finance/ledger/factories/x",
    });
    expect(api.post).toHaveBeenCalledWith(`/ledger/parties/factory/${id}/statement`, { year: 2026 });
    expect(s).toMatchObject({
      ok: true,
      number: "ST-F-2026-0012",
      pdf: `/pdf/ledger-factory/${id}?from=2026-10-01&to=2026-11-04&cur=CNY&no=12`,
    });
    expect(s.view).toContain(`/print/ledger/factory/${id}?from=2026-10-01&to=2026-11-04&cur=CNY&no=12&back=`);
    expect((await issueStatementAction("factory", "not-an-id", { from: "2026-10-01", to: "2026-11-04" })).ok).toBe(false);
    expect((await issueStatementAction("nobody" as never, id, { from: "2026-10-01", to: "2026-11-04" })).ok).toBe(false);
  });
});
