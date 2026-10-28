import { api } from "@/lib/api";
import { PlanOff } from "@/components/common/plan-off";
import { requirePermission, hasFeature } from "@/lib/session";
import type { DealDetail } from "@/lib/types";
import { CustomerHistoryNote } from "@/components/money/customer-account";
import { DealExpensesCard } from "@/components/money/deal-expenses";

export const metadata = { title: "Inquiry costs" };

/** Managers: what was spent on this deal (trips, samples, factory visits), and the customer's history. */
export default async function DealCosts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("expenses.manage");
  if (!(await hasFeature("expenses"))) return <PlanOff title="Costs" what="Expenses" />;
  const d = await api.get<DealDetail>(`/inquiries/${id}`);
  const order = d.orders.find((o) => o.status !== "cancelled") ?? null;
  return (
    <div className="flex flex-col gap-5">
      <CustomerHistoryNote customerId={d.customer.id} dealId={d.id} />
      <DealExpensesCard
        deal={{ id: d.id, refNo: d.refNo, title: d.title, stage: d.stage, customer: { id: d.customer.id, name: d.customer.name }, order: order && { id: order.id, refNo: order.refNo } }}
      />
    </div>
  );
}
