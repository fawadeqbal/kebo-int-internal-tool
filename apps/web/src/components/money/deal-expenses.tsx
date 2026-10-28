import Link from "next/link";
import { type InquiryStage } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { ExpenseList, ExpenseTargets } from "@/lib/types-money";
import { expenseAction } from "@/app/(app)/money/actions";
import { NewExpense } from "./forms";
import { ExpenseRecord } from "./expense-record";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

/**
 * What was spent on this deal (trips to check products, samples, visits),
 * managers only. Won: it comes off the order's profit. Lost: it is what the
 * lost deal cost us.
 */
export async function DealExpensesCard({
  deal,
}: {
  deal: { id: string; refNo: string; title: string; stage: InquiryStage; customer: { id: string; name: string }; order: { id: string; refNo: string } | null };
}) {
  const today = todayIn(TZ);
  const [list, targets, people, settings] = await Promise.all([
    api.get<ExpenseList>("/expenses", { inquiryId: deal.id }),
    api.get<ExpenseTargets>("/expenses/targets"),
    api.get<Person[]>("/users/people"),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  const c = list.currency;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const choices = {
    ...targets,
    customers: [deal.customer],
    deals: [{ id: deal.id, refNo: deal.refNo, title: deal.title, stage: deal.stage, customerId: deal.customer.id, customer: deal.customer.name }],
    orders: targets.orders.filter((o) => o.dealId === deal.id),
    customerId: deal.customer.id,
    dealId: deal.id,
  };
  // An order's own costs show on the order; here the ones before it.
  const rows = list.rows.filter((e) => !e.order);
  const total = rows.filter((e) => !e.voided).reduce((t, e) => t + Number(e.inMain), 0);
  return (
    <Card>
      <CardHeader
        title="Spent on this inquiry"
        description={
          deal.stage === "lost"
            ? "Managers only. What this lost inquiry cost us: trips, samples, visits to factories."
            : deal.order
              ? `Managers only. Spent before the order; it comes off ${deal.order.refNo}'s profit.`
              : "Managers only. Trips to check products, samples, visits to factories. Won: it comes off the order's profit."
        }
        actions={<span className="text-sm font-semibold tabular">{money(total, c)}</span>}
      />
      <CardBody className="flex flex-col gap-3">
        {rows.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Spent on this inquiry">
            {rows.map((e) => (
              <ExpenseRecord key={e.id} e={e} mainCurrency={c} people={people} fx={fx} today={today} choices={choices} showFor={false} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing spent on this inquiry yet.</p>
        )}
        {deal.order && (
          <Link href={`/orders/${deal.order.id}/money`} className="text-sm text-primary hover:underline">
            The order&apos;s own costs and profit
          </Link>
        )}
        <NewExpense action={expenseAction.bind(null, null, null)} people={people} mainCurrency={c} fx={fx} today={today} choices={choices} label="Add an expense for this inquiry" />
      </CardBody>
    </Card>
  );
}
