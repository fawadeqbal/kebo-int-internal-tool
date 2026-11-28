import { DataRow, EmptyState, PhoneList, PhoneRow, RefCode, StatusBadge, Td, Th, THead } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { TabList } from "@/components/lists/tab-list";
import { supplierOf, supplierPayablesOf } from "@/lib/party-data";
import { date, whole } from "@/lib/format";
import { DataTable } from "@/components/common/data-table";
import { supplierTitle } from "@/lib/titles";
import { dataOf, failedWhat } from "@/lib/part";
import { CouldNotLoad } from "@/components/common/could-not-load";

export const generateMetadata = supplierTitle("Orders");

/**
 * The supplier's Orders tab (in the board's table style): what it is making for us, with the day it should be
 * ready, and every order we still owe it money on, with what is left to pay.
 */
export default async function SupplierOrders({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [f, payablesPart] = await Promise.all([supplierOf(id), supplierPayablesOf(id)]);
  // Not read: the orders still show, without what we owe on each, and the tab says so.
  const failed = failedWhat(payablesPart);
  const owed = new Map(
    (dataOf(payablesPart) ?? []).flatMap((p) => p.orders.filter((o) => Number(o.toPay) > 0.005).map((o) => [o.id, { ...o, currency: p.currency }] as const)),
  );
  // Every order it made for us, the latest first (review 24 Nov, O-38: only the ones in production were listed).
  const all = f.record.orders ?? f.record.openOrders.map((o) => ({ ...o, status: "open" as const, stage: "in_production" }));
  const listed = new Set(all.map((o) => o.id));
  const rows = [
    ...all.map((o) => ({ id: o.id, refNo: o.refNo, customer: o.customer, readyOn: o.status === "open" ? o.readyOn : null, status: o.status, stage: o.stage })),
    ...[...owed.values()]
      .filter((o) => !listed.has(o.id))
      .map((o) => ({ id: o.id, refNo: o.refNo, customer: o.customer, readyOn: null, status: "open" as const, stage: "shipped" })),
  ];
  const state = (o: (typeof rows)[number]) =>
    o.status !== "open" ? (
      <StatusBadge meaning="ok">Done</StatusBadge>
    ) : o.stage === "confirmed" || o.stage === "in_production" ? (
      <StatusBadge meaning="info">Making</StatusBadge>
    ) : (
      <StatusBadge meaning="info">Shipped</StatusBadge>
    );
  const toPay = (id: string) => {
    const p = owed.get(id);
    return p ? <span className={p.next?.status === "late" ? "font-semibold text-bad" : undefined}>{whole(p.toPay, p.currency)}</span> : "—";
  };

  return (
    // A list tab as every record's (a customer's Orders): its title and count, then the rows or the empty state.
    <TabList title="In production" summary={`${rows.length} order${rows.length === 1 ? "" : "s"}`}>
      {failed && <CouldNotLoad what={failed} />}
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing in production here"
          description="An order shows here while it has items from this supplier, with the day it should be ready."
        />
      ) : (
        <>
          <PhoneList label="Orders">
            {rows.map((o) => (
              <PhoneRow
                key={o.id}
                href={`/orders/${o.id}/supplier`}
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
                <DataRow key={o.id} href={`/orders/${o.id}/supplier`}>
                  <Td>
                    <RefCode href={`/orders/${o.id}/supplier`}>{o.refNo}</RefCode>
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
    </TabList>
  );
}
