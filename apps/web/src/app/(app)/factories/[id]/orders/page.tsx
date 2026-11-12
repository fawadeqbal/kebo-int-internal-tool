import { Card, DataRow, EmptyState, PhoneList, PhoneRow, RefCode, StatusBadge, Td, Th, THead } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { factoryOf, factoryPayablesOf } from "@/lib/party-data";
import { date, whole } from "@/lib/format";
import { DataTable } from "@/components/common/data-table";

export const metadata = { title: "Supplier orders" };

/**
 * The supplier's Orders tab (in the board's table style): what it is making for us, with the day it should be
 * ready, and every order we still owe it money on, with what is left to pay.
 */
export default async function FactoryOrders({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [f, payables] = await Promise.all([factoryOf(id), factoryPayablesOf(id)]);
  const owed = new Map(
    payables.flatMap((p) => p.orders.filter((o) => Number(o.toPay) > 0.005).map((o) => [o.id, { ...o, currency: p.currency }] as const)),
  );
  const making = new Map(f.record.openOrders.map((o) => [o.id, o]));
  const rows = [
    ...f.record.openOrders.map((o) => ({ id: o.id, refNo: o.refNo, customer: o.customer, readyOn: o.readyOn, making: true })),
    ...[...owed.values()]
      .filter((o) => !making.has(o.id))
      .map((o) => ({ id: o.id, refNo: o.refNo, customer: o.customer, readyOn: null, making: false })),
  ];
  const state = (o: (typeof rows)[number]) =>
    o.making ? <StatusBadge meaning="info">Making</StatusBadge> : <StatusBadge meaning="ok">Made</StatusBadge>;
  const toPay = (id: string) => {
    const p = owed.get(id);
    return p ? <span className={p.next?.status === "late" ? "font-semibold text-bad" : undefined}>{whole(p.toPay, p.currency)}</span> : "—";
  };

  return (
    <Card className="overflow-clip p-0">
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing in production here"
          description="An order shows here while it has lines from this supplier, with the day it should be ready."
        />
      ) : (
        <>
          <PhoneList label="Orders">
            {rows.map((o) => (
              <PhoneRow
                key={o.id}
                href={`/orders/${o.id}/factory`}
                title={o.refNo}
                line={[o.customer, o.readyOn ? `ready ${date(o.readyOn)}` : null].filter(Boolean).join(" · ")}
                status={state(o)}
                figure={toPay(o.id)}
              />
            ))}
          </PhoneList>
          <DataTable label="Orders" className="max-sm:hidden">
            <THead>
              <tr>
                <Th>Sales order</Th>
                <Th>Customer</Th>
                <Th>Ready</Th>
                <Th className="text-right">We owe</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((o) => (
                <DataRow key={o.id} href={`/orders/${o.id}/factory`}>
                  <Td>
                    <RefCode href={`/orders/${o.id}/factory`}>{o.refNo}</RefCode>
                  </Td>
                  <Td>{o.customer}</Td>
                  <Td className="whitespace-nowrap">{o.readyOn ? date(o.readyOn) : "—"}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{toPay(o.id)}</Td>
                  <Td>{state(o)}</Td>
                </DataRow>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </Card>
  );
}
