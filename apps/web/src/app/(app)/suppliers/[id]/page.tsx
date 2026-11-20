import { redirect } from "next/navigation";
import { can, ORDER_WORD_TONE } from "@kebo/shared";
import { hasFeature, requirePermission } from "@/lib/session";
import { api } from "@/lib/api";
import type { FactoryOrders } from "@/lib/types-facts";
import { DataTable } from "@/components/common/data-table";
import { factoryOf } from "@/lib/party-data";
import { ArrowRight } from "lucide-react";
import { ButtonLink, Card, CardHeader, RefCode, StatusBadge, Table, Td, Th, THead, Tr, type StatusMeaning, EmptyLine } from "@kebo/ui";
import { date, whole, companyToday } from "@/lib/format";
import { getPeople } from "@/lib/loaders";
import type { Person } from "@/lib/types";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { saveFactoryAction } from "../actions";
import { FactoryPanel } from "../factory-form";
import { supplierTitle } from "@/lib/titles";

export const generateMetadata = supplierTitle();

/** Where an order with the factory is: ready date passed, else the order's stage; closed or cancelled. */
function poState(o: FactoryOrders["rows"][number], today: string): { label: string; meaning: StatusMeaning } {
  const word = o.word ?? (o.status === "closed" ? "Done" : o.status === "cancelled" ? "Cancelled" : "Confirmed");
  if (!o.ready && o.readyOn && o.readyOn < today && (word === "Confirmed" || word === "In production")) return { label: "Ready date passed", meaning: "bad" };
  return { label: word, meaning: ORDER_WORD_TONE[word] };
}

/** Old ?tab= links, ?offers=all and the history panel → the tab that has them now. */
const TAB_OF: Record<string, string> = { prices: "offers", costs: "costs", making: "orders", history: "notes" };

/**
 * The supplier's Overview tab: Performance (Insights) and Details with ✎ Edit (the side panel), its main
 * contact among them. What it makes, its prices, costs and notes each have their own tab.
 */
export default async function FactoryOverview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const old = sp.tab ? TAB_OF[sp.tab] : sp.offers === "all" ? "offers" : sp.panel === "history" ? "notes" : undefined;
  if (old) redirect(`/suppliers/${id}/${old}`);
  const me = await requirePermission("sourcing.manage");
  const editing = sp.panel === "edit-factory";
  const money = can(me, "expenses.manage") && can(me, "reports.view") && (await hasFeature("insights"));
  const [f, people, pos] = await Promise.all([
    factoryOf(id),
    editing ? getPeople().catch(() => [] as Person[]) : ([] as Person[]),
    money ? api.get<FactoryOrders>("/insights/facts/factory-orders", { factoryId: id }).catch(() => null) : null,
  ]);
  const r = f.record;
  const today = companyToday();

  return (
    <div className="flex flex-col gap-4">
      <RecordLanding />
          <DetailsCard
            flash={sp.saved === f.id}
            edit={{ panel: "edit-factory", id: f.id, label: `Edit ${f.name}` }}
            items={[
              { label: "Contact person", value: f.contactPerson },
              { label: "Phone", value: f.phone && <a href={`tel:${f.phone}`}>{f.phone}</a> },
              { label: "WeChat", value: f.wechat },
              {
                label: "Email",
                value: f.email && (
                  <a href={`mailto:${f.email}`} className="break-all">
                    {f.email}
                  </a>
                ),
              },
              { label: "Responsible person", value: f.owner?.name },
              { label: "Address", value: f.address && <span className="whitespace-pre-line">{f.address}</span> },
              { label: "Bank details", value: f.bankDetails && <span className="whitespace-pre-line">{f.bankDetails}</span>, wide: true },
              { label: "Notes", value: f.notes && <span className="whitespace-pre-line">{f.notes}</span>, wide: true },
            ]}
          />
          {/* Purchase orders (board): what each order with this factory costs us, what we paid, ready, where it is. */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Purchase orders"
              actions={
                <ButtonLink href={`/suppliers/${f.id}/orders`} variant="link" size="sm">
                  <ArrowRight aria-hidden /> All
                </ButtonLink>
              }
            />
            {pos ? (
              pos.rows.length ? (
                <DataTable label="Purchase orders">
                    <THead>
                      <tr>
                        <Th>Sales order</Th>
                        <Th className="text-right">Total</Th>
                        <Th className="text-right">Paid</Th>
                        <Th>Ready</Th>
                        <Th>Status</Th>
                      </tr>
                    </THead>
                    <tbody>
                      {pos.rows.slice(0, 5).map((o) => {
                        const st = poState(o, today);
                        return (
                          <Tr key={o.orderId} href={`/orders/${o.orderId}`}>
                            <Td>
                              <RefCode href={`/orders/${o.orderId}`}>{o.refNo}</RefCode>
                            </Td>
                            <Td className="text-right whitespace-nowrap tabular">{whole(o.owed, o.currency)}</Td>
                            <Td className="text-right whitespace-nowrap tabular">{whole(o.paid, o.currency)}</Td>
                            <Td className="whitespace-nowrap">{o.readyOn ? date(o.readyOn) : "—"}</Td>
                            <Td>
                              <StatusBadge meaning={st.meaning}>{st.label}</StatusBadge>
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                </DataTable>
              ) : (
                <EmptyLine inset>No purchase orders yet. When an order buys from this supplier, it shows here with what we owe and paid.</EmptyLine>
              )
            ) : r.openOrders.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Sales order</Th>
                    <Th>Customer</Th>
                    <Th>Ready</Th>
                  </tr>
                </THead>
                <tbody>
                  {r.openOrders.map((o) => (
                    <Tr key={o.id} href={`/orders/${o.id}`}>
                      <Td>
                        <RefCode href={`/orders/${o.id}`}>{o.refNo}</RefCode>
                      </Td>
                      <Td>{o.customer}</Td>
                      <Td className="whitespace-nowrap">{o.readyOn ? date(o.readyOn) : "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyLine inset>Nothing in production. Orders this supplier makes for us show here.</EmptyLine>
            )}
          </Card>
      {editing && <FactoryPanel action={saveFactoryAction.bind(null, f.id, f.updatedAt)} factory={f} people={people} meId={me.id} onRecord />}
    </div>
  );
}
