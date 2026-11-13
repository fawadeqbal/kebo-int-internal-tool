import { api } from "@/lib/api";
import { PlanOff } from "@/components/common/plan-off";
import { requirePermission, hasFeature } from "@/lib/session";
import type { DealDetail } from "@/lib/types";
import { CustomerHistoryNote } from "@/components/money/customer-account";
import { DealExpensesCard } from "@/components/money/deal-expenses";
import { WithSide } from "../side";

export const metadata = { title: "Inquiry costs" };

/** Managers: what was spent on this deal (trips, samples, factory visits), and the customer's history. */
export default async function DealCosts({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cost?: string }> }) {
  const { id } = await params;
  const { cost } = await searchParams;
  const me = await requirePermission("expenses.manage");
  if (!(await hasFeature("expenses"))) return <PlanOff title="Costs" what="Expenses" />;
  const d = await api.get<DealDetail>(`/inquiries/${id}`);
  const order = d.orders.find((o) => o.status !== "cancelled") ?? null;
  return (
    <WithSide id={id}>
      <CustomerHistoryNote customerId={d.customer.id} dealId={d.id} />
      <DealExpensesCard
        deal={{ id: d.id, refNo: d.refNo, title: d.title, stage: d.stage, customer: { id: d.customer.id, name: d.customer.name }, order: order && { id: order.id, refNo: order.refNo } }}
        me={me.id}
        open={cost}
      />
    </WithSide>
  );
}
