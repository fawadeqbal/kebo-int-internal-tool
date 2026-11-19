import Link from "next/link";
import { LOST_REASON_LABEL, type InquiryStage, type LostReason } from "@kebo/shared";
import { Badge, EmptyLine } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, money, companyToday } from "@/lib/format";
import type { CostSheetRow, ExpenseList } from "@/lib/types-money";
import { getSettings, getPeople } from "@/lib/loaders";
import { Section } from "@/components/order-sections/section";
import { PayCostWindow, RepayWindow } from "@/components/order-sections/costs-windows";
import { CostSheetTable, OwedBack, owedOf, paidHow, sheetRowOf } from "@/components/orders/cost-sheet";
import { costState } from "@/components/orders/cost-words";
import { ExportLink } from "@/components/sheets/export-link";
import { AddCost, ChangeCost, type CostSetup } from "./cost-window";

/**
 * An inquiry's Costs tab (design "spending", board InquiryCosts), managers only: what was spent on it (trips to
 * check products, samples, visits) in the same table as an order's Costs, and who is owed back. Won: the costs
 * show on the order as spent before it. Lost: a note says what losing it cost. Every row opens the one cost window.
 */
export async function DealExpensesCard({
  deal,
}: {
  deal: {
    id: string;
    refNo: string;
    stage: InquiryStage;
    customer: { id: string; name: string };
    order: { id: string; refNo: string } | null;
    closedAt: string | null;
    lostReason: LostReason | null;
    assignee: { name: string } | null;
  };
}) {
  const today = companyToday();
  const [list, people, settings] = await Promise.all([api.get<ExpenseList>("/expenses", { inquiryId: deal.id, pageSize: 200 }), getPeople(), getSettings()]);
  const main = list.currency;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const setup: CostSetup = {
    mainCurrency: settings.sales.currency,
    fx,
    today,
    people,
    for: { place: "deal", id: deal.id, customerId: deal.customer.id, label: `Inquiry ${deal.refNo}${deal.stage === "lost" ? " (lost)" : ""} · ${deal.customer.name}` },
  };
  // An order's own costs show on the order; here the ones before it.
  const rows = list.rows.filter((e) => !e.order);
  const live = rows.filter((e) => !e.voided);
  const removed = rows.filter((e) => e.voided);
  const byId = new Map(live.map((e) => [e.id, e]));
  const sheet = live.map(sheetRowOf);
  const sum = (k: "inOrder" | "paidInOrder" | "toPayInOrder") => sheet.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const total = sum("inOrder");
  const toPay = sum("toPayInOrder");
  const owed = owedOf(live);

  const action = (r: CostSheetRow) => {
    const e = byId.get(r.expenseId ?? "");
    if (!e) return null;
    return (
      <span className="flex items-center justify-end gap-2">
        {r.state === "to_pay" ? (
          <PayCostWindow orderId={null} id={e.id} currency={e.currency} sub={[r.owedTo, e.description, money(e.amount, e.currency)].filter(Boolean).join(" · ")} today={today} from={e.spentOn} canFiles={false} />
        ) : r.state === "to_repay" ? (
          <RepayWindow orderId={null} ids={[e.id]} currency={e.currency} name={e.paidBy?.name ?? "them"} amount={money(e.amount, e.currency)} today={today} canFiles={false} />
        ) : (
          <Badge tone="ok">{costState(r)}</Badge>
        )}
        <ChangeCost setup={setup} expense={e} iconOnly />
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {deal.stage === "lost" && (
        <p className="rounded-xl border border-line bg-surface-2 px-[18px] py-3 text-md text-text-2">
          <strong className="text-text">
            Lost{deal.closedAt ? ` on ${date(deal.closedAt)}` : ""}
            {deal.lostReason ? `, ${LOST_REASON_LABEL[deal.lostReason].toLowerCase()}` : ""}.
          </strong>{" "}
          {live.length ? (
            <>
              What it cost us to try: <strong className="text-text tabular">{money(total, main)}</strong>. It counts for {deal.customer.name}
              {deal.assignee ? `, for ${deal.assignee.name}` : ""} and under lost inquiries in Reports.
            </>
          ) : (
            "Nothing was spent on it."
          )}
        </p>
      )}

      <Section
        title="Spent on this inquiry"
        state={toPay > 0 ? `${money(toPay, main)} to pay` : live.length ? "All paid" : null}
        tone={toPay > 0 ? "warn" : "ok"}
        actions={
          <>
            {live.length > 0 && <ExportLink what="expenses" query={{ inquiry: deal.id }} />}
            <AddCost setup={setup} />
          </>
        }
      >
        {live.length ? (
          <CostSheetTable
            rows={sheet}
            currency={main}
            totals={{ costs: total.toFixed(2), paid: sum("paidInOrder").toFixed(2), toPay: toPay.toFixed(2) }}
            action={action}
            receiptOf={(r) => byId.get(r.expenseId ?? "")?.receipt ?? null}
            howOf={(r) => {
              const e = byId.get(r.expenseId ?? "");
              return e ? paidHow(e) : null;
            }}
          />
        ) : (
          <EmptyLine className="border-t border-line px-[18px] py-3.5">Nothing spent on this inquiry yet.</EmptyLine>
        )}
        {deal.order && live.length > 0 && (
          <p className="border-t border-line px-[18px] py-2.5 text-xs text-text-2">
            Won: these show on{" "}
            <Link href={`/orders/${deal.order.id}/costs`} className="font-medium text-primary hover:underline">
              order {deal.order.refNo}
            </Link>{" "}
            as spent before the order.
          </p>
        )}
        {removed.length > 0 && (
          <p className="border-t border-line px-[18px] py-2.5 text-xs text-text-2">
            Removed:{" "}
            {removed.map((e, i) => (
              <span key={e.id}>
                {i > 0 && " · "}
                <span className="line-through">
                  {e.description} {money(e.amount, e.currency)}
                </span>
                {e.voided?.reason ? ` (${e.voided.reason})` : ""}
              </span>
            ))}
          </p>
        )}
      </Section>

      <OwedBack owed={owed} where="on this inquiry" orderId={null} today={today} canPay />
    </div>
  );
}
