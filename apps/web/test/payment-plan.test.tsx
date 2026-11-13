import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrderMoney } from "@/lib/types-money";
import { PaymentPlanTable } from "@/components/order-sections/payment-plan";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/orders/o1/payment", useSearchParams: () => new URLSearchParams() }));

type Item = OrderMoney["plan"]["items"][number];
const request = (over: Partial<Item["request"]> = {}): Item["request"] => ({ state: "not_sent", with: null, sentOn: null, sentBy: null, revision: null, proformaNo: null, through: "customer", changed: false, receipts: [], ...over });
const item = (over: Partial<Item>): Item => ({
  id: "i1",
  number: "PR-2026-0001-1",
  label: "Deposit 30%",
  amount: "300.00",
  dueOn: "2026-11-21",
  paid: "0.00",
  open: "300.00",
  status: "upcoming" as Item["status"],
  part: "deposit",
  how: "T/T",
  when: null,
  dueRule: "fixed" as Item["dueRule"],
  dueDays: null,
  rule: null,
  request: request(),
  late: 0,
  ...over,
});
const receipt = { id: "p1", number: "RC-2026-0001-1", amount: "300.00", paidOn: "2026-11-16", whole: "300.00", method: "bank_transfer", reference: "TT1", account: "Bank of China", recordedBy: "Sana", hasProof: true, entryId: "m1" };
const plan = (items: Item[], over: Partial<OrderMoney["plan"]> = {}): OrderMoney["plan"] => ({
  items,
  cancelled: [],
  canSend: true,
  dates: { readyOn: null, shippedOn: null, papersOn: null },
  matchesTotal: true,
  difference: "0.00",
  next: null,
  canEdit: true,
  ...over,
});
const action = async () => ({});
const pay = { action, customer: "Lagos Water", refNo: "SO-2026-0001", due: "1000.00", depositDue: "300.00", fx: { main: "USD", rates: {} }, today: "2026-11-14" };
const table = (p: OrderMoney["plan"], withPay = true) =>
  render(<PaymentPlanTable orderId="o1" plan={p} currency="USD" total="1000.00" received="0.00" due="1000.00" send={action} pay={withPay ? pay : null} />);
/** The desktop table (the phone list holds the same rows). */
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

describe("the order's payment plan", () => {
  it("offers Send request on every part not sent, and Record payment on the first open part only", () => {
    table(plan([item({}), item({ id: "i2", number: "PR-2026-0001-2", label: "Balance 70%", amount: "700.00", open: "700.00", part: "balance" })]));
    const [deposit, balance] = rows();
    expect(within(deposit!).getByRole("button", { name: "Send request" })).toBeTruthy();
    expect(within(deposit!).getByRole("button", { name: "Record payment" })).toBeTruthy();
    expect(within(balance!).getByRole("button", { name: "Send request" })).toBeTruthy();
    expect(within(balance!).queryByRole("button", { name: "Record payment" })).toBeNull();
  });

  it("a paid part shows when it was paid and its receipt; the next part takes Record payment", () => {
    table(
      plan([
        item({ paid: "300.00", open: "0.00", request: request({ state: "paid", with: "proforma", sentOn: "2026-11-12", receipts: [receipt] }) }),
        item({ id: "i2", number: "PR-2026-0001-2", label: "Balance 70%", amount: "700.00", open: "700.00", request: request({ state: "sent", with: "request", sentOn: "2026-12-03", revision: 1 }) }),
      ]),
    );
    const [deposit, balance] = rows();
    expect(within(deposit!).getByText("Paid 16 Nov")).toBeTruthy();
    expect(within(deposit!).getByRole("link", { name: "Receipt" }).getAttribute("href")).toBe("/print/orders/o1/payment-receipt?ref=p1&back=%2Forders%2Fo1%2Fpayment");
    expect(within(deposit!).queryByRole("button")).toBeNull();
    expect(within(balance!).getByText("Sent 3 Dec")).toBeTruthy();
    // Sent and not changed: nothing to send again; the kept copy opens from its number.
    expect(within(balance!).queryByRole("button", { name: /Send/ })).toBeNull();
    expect(within(balance!).getByRole("link", { name: "PR-2026-0001-2" }).getAttribute("href")).toBe("/print/orders/o1/payment-request?ref=i2&back=%2Forders%2Fo1%2Fpayment");
    expect(within(balance!).getByRole("button", { name: "Record payment" })).toBeTruthy();
  });

  it("nothing in the plan leaves the order for the Payments pages", () => {
    const { container } = table(
      plan(
        [item({ request: request({ state: "sent", with: "request", sentOn: "2026-11-12", revision: 2, changed: true }), late: 3 })],
        { cancelled: [{ paperId: "c1", ref: "old", number: "PR-2026-0001-3", revision: 1, sentOn: "2026-11-01", amount: "50.00", label: "Extra" }] },
      ),
    );
    for (const a of container.querySelectorAll("a")) expect(a.getAttribute("href")).not.toMatch(/^\/payments/);
    const [row] = rows();
    expect(within(row!).getByRole("button", { name: "Send again" })).toBeTruthy();
    expect(within(row!).getByText("3 days late")).toBeTruthy();
    expect(within(row!).getByText("Changed since it was sent")).toBeTruthy();
  });

  it("a bank route's balance points to the bank papers; without the right to record there is no payment button", () => {
    table(plan([item({ request: request({ through: "bank" }) })]), false);
    const [row] = rows();
    expect(within(row!).getByRole("link", { name: "Bank papers" }).getAttribute("href")).toBe("/orders/o1/documents");
    expect(within(row!).queryByRole("button")).toBeNull();
  });
});
