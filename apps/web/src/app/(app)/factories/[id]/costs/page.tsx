import { notFound } from "next/navigation";
import { can, EXPENSE_CATEGORY_LABEL } from "@kebo/shared";
import { api } from "@/lib/api";
import { requirePermission, hasFeature } from "@/lib/session";
import { factoryOf } from "@/lib/party-data";
import { date, money } from "@/lib/format";
import type { ExpenseList } from "@/lib/types-money";
import { RecordEmpty, RecordListCard, RecordRow } from "@/components/common/record";

export const metadata = { title: "Supplier visits and costs" };

/** The supplier's Costs tab (managers): expenses that name it, such as trips and inspections. */
export default async function FactoryCosts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("sourcing.manage");
  if (!(can(me, "expenses.manage") && (await hasFeature("expenses")))) notFound();
  const [f, costs] = await Promise.all([factoryOf(id), api.get<ExpenseList>("/expenses", { factoryId: id }).catch(() => null)]);
  const rows = costs?.rows ?? [];
  return (
    <RecordListCard
      title="Visits and costs"
      count={rows.length}
      description={`Managers only · expenses that name ${f.name}: trips, inspections${rows.length && costs ? ` · ${money(costs.total, costs.currency)} in all` : ""}`}
      empty={<RecordEmpty title="Nothing spent here yet">When adding an expense, choose this supplier under Factory visited, and it shows here.</RecordEmpty>}
    >
      {rows.map((e) => (
        <RecordRow
          key={e.id}
          href={e.deal ? `/inquiries/${e.deal.id}` : e.order ? `/orders/${e.order.id}/payment` : undefined}
          muted={!!e.voided}
          title={<span className={e.voided ? "line-through" : undefined}>{e.description}</span>}
          sub={[EXPENSE_CATEGORY_LABEL[e.category], date(e.spentOn), e.deal?.refNo ?? e.order?.refNo, e.customer?.name].filter(Boolean).join(" · ")}
          figure={money(e.amount, e.currency)}
        />
      ))}
    </RecordListCard>
  );
}
