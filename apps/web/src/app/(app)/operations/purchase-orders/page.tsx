import Link from "next/link";
import { Card, cn, EmptyState, PageHeader, Segmented, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { crumbsFor, labelFor } from "@/lib/nav";
import { date, money } from "@/lib/format";

export const metadata = { title: "Purchase orders" };

type PurchaseOrderRow = {
  key: string;
  order: { id: string; refNo: string; stage: string; closed: boolean };
  customer: { id: string; name: string };
  supplier: { id: string; name: string };
  orderedOn: string | null;
  supplierRef: string | null;
  readyOn: string | null;
  late: boolean;
  currency: string;
  owed: string;
  paid: string;
  toPay: string;
};

/**
 * Operations & trading › Purchase orders: one per supplier on each order (what we bought from them), with when
 * we ordered, their order number, their ready date and what we owe and paid them. Changed on the order's
 * Purchase tab.
 */
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requirePermission("sourcing.manage");
  const all = (await searchParams).all === "1";
  const rows = await api.get<PurchaseOrderRow[]>("/operations/purchase-orders", { all: all ? "true" : undefined });
  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/operations/purchase-orders")}
        title={labelFor("/operations/purchase-orders")}
        description="One per supplier on each order."
      />
      <Segmented
        label="Which purchase orders"
        className="mb-4"
        options={[
          { href: "/operations/purchase-orders", label: "Open", active: !all },
          { href: "/operations/purchase-orders?all=1", label: "All", active: all },
        ]}
      />
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No purchase orders" description="Orders with lines from a supplier show here." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Order</Th>
                  <Th>Ordered · their no.</Th>
                  <Th>Ready</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">To pay</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.key} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/factories/${r.supplier.id}`} className="font-medium hover:text-primary">
                        {r.supplier.name}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/orders/${r.order.id}/factory`} className="font-medium hover:text-primary">
                        {r.order.refNo}
                      </Link>
                      <span className="block text-xs text-muted">{r.customer.name}</span>
                    </Td>
                    <Td className="text-sm">
                      {r.orderedOn ? date(r.orderedOn) : <span className="text-muted">Not ordered yet</span>}
                      {r.supplierRef && <span className="block text-xs text-muted">{r.supplierRef}</span>}
                    </Td>
                    <Td className={cn("text-sm whitespace-nowrap", r.late && "font-medium text-bad")}>
                      {r.readyOn ? date(r.readyOn) : <span className="text-muted">Not given</span>}
                      {r.late && <span className="block text-xs">late</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {money(r.paid, r.currency)}
                      <span className="block text-xs text-muted">of {money(r.owed, r.currency)}</span>
                    </Td>
                    <Td className={cn("text-right font-semibold whitespace-nowrap tabular", Number(r.toPay) <= 0 && "text-muted")}>
                      {money(r.toPay, r.currency)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
