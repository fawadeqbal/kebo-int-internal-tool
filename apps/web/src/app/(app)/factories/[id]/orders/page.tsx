import { StatusBadge } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { factoryOf, factoryPayablesOf } from "@/lib/party-data";
import { date, money } from "@/lib/format";
import { RowMenu } from "@/components/common/more-menu";
import { RecordEmpty, RecordListCard, RecordRow } from "@/components/common/record";

export const metadata = { title: "Supplier orders" };

/**
 * The supplier's Orders tab: what it is making for us (with the day it should be ready), and every order we
 * still owe it money on, with what is left to pay (Finance › Payables gives the figure).
 */
export default async function FactoryOrders({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [f, payables] = await Promise.all([factoryOf(id), factoryPayablesOf(id)]);
  const owed = new Map(payables.flatMap((p) => p.orders.filter((o) => Number(o.toPay) > 0.005).map((o) => [o.id, { ...o, currency: p.currency }] as const)));
  const making = new Map(f.record.openOrders.map((o) => [o.id, o]));
  const rows = [
    ...f.record.openOrders.map((o) => ({ id: o.id, refNo: o.refNo, customer: o.customer, readyOn: o.readyOn, making: true })),
    ...[...owed.values()].filter((o) => !making.has(o.id)).map((o) => ({ id: o.id, refNo: o.refNo, customer: o.customer, readyOn: null, making: false })),
  ];

  return (
    <RecordListCard
      title="Orders"
      count={rows.length}
      description={rows.length ? "Open orders with lines from this supplier, and orders we still owe it on" : undefined}
      empty={<RecordEmpty title="Nothing in production here">An order shows here while it has lines from this supplier, with the day it should be ready.</RecordEmpty>}
    >
      {rows.map((o) => {
        const pay = owed.get(o.id);
        return (
          <RecordRow
            key={o.id}
            href={`/orders/${o.id}/factory`}
            title={o.refNo}
            sub={[o.customer, o.making ? (o.readyOn ? `ready ${date(o.readyOn)}` : "no ready date") : "made"].join(" · ")}
            status={pay ? <StatusBadge meaning={pay.next?.status === "late" ? "bad" : "info"}>{money(pay.toPay, pay.currency)} to pay</StatusBadge> : undefined}
            menu={
              <RowMenu
                label={`Actions for ${o.refNo}`}
                items={[
                  { label: "Open", href: `/orders/${o.id}/factory` },
                  { label: "Production", href: `/orders/${o.id}/production` },
                  { label: "Copy link", copy: `/orders/${o.id}` },
                ]}
              />
            }
          />
        );
      })}
    </RecordListCard>
  );
}
