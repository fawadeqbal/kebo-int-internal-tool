import { redirect } from "next/navigation";
import { can, ORDER_WORD_TONE } from "@kebo/shared";
import { todayIn } from "@kebo/utils";
import { hasFeature, requirePermission } from "@/lib/session";
import { api } from "@/lib/api";
import type { FactoryGroups, FactoryOrders } from "@/lib/types-facts";
import { DataTable } from "@/components/common/data-table";
import { ConfirmAction } from "@/components/people/confirm-action";
import { factoryOf, factoryPayablesOf } from "@/lib/party-data";
import { ArrowRight, FileText } from "lucide-react";
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  RefCode,
  StatusBadge,
  Table,
  Td,
  Th,
  THead,
  Tr,
  type StatusMeaning,
} from "@kebo/ui";
import { date, plural, TZ, whole } from "@/lib/format";
import { getPeople } from "@/lib/loaders";
import type { Person } from "@/lib/types";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { removeFactoryAction, saveFactoryAction } from "../actions";
import { FactoryPanel } from "../factory-form";

export const metadata = { title: "Supplier" };

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
  if (old) redirect(`/factories/${id}/${old}`);
  const me = await requirePermission("sourcing.manage");
  const editing = sp.panel === "edit-factory";
  const money = can(me, "expenses.manage") && can(me, "reports.view") && (await hasFeature("insights"));
  const [f, people, payables, pos, groups] = await Promise.all([
    factoryOf(id),
    editing ? getPeople().catch(() => [] as Person[]) : ([] as Person[]),
    factoryPayablesOf(id),
    money ? api.get<FactoryOrders>("/insights/facts/factory-orders", { factoryId: id }).catch(() => null) : null,
    money
      ? api.get<FactoryGroups>("/insights/facts/factories/groups", { period: "all", by: "factory", factoryId: id }).catch(() => null)
      : null,
  ]);
  const r = f.record;
  const toPay = payables.filter((p) => Number(p.toPay) > 0.005);
  const today = todayIn(TZ);
  const perf = groups?.rows[0] ?? null;
  // Bought, paid and owed, per currency, from its orders.
  const sums = [...new Set((pos?.rows ?? []).map((o) => o.currency))].map((cur) => {
    const of = (pos?.rows ?? []).filter((o) => o.currency === cur);
    const add = (k: "owed" | "paid" | "toPay") => of.reduce((t, o) => t + Number(o[k]), 0);
    return { cur, orders: of.length, owed: add("owed"), paid: add("paid"), toPay: add("toPay") };
  });
  const canRemove = can(me, "inquiries.updateAny");

  return (
    <div className="flex flex-col gap-4">
      <RecordLanding />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
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
              { label: "Owner", value: f.owner?.name },
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
                <ButtonLink href={`/factories/${f.id}/orders`} variant="link" size="sm">
                  <ArrowRight aria-hidden /> All
                </ButtonLink>
              }
            />
            {pos ? (
              pos.rows.length ? (
                <DataTable label="Purchase orders">
                  <table className="w-full min-w-[640px] text-[13px]">
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
                          <Tr key={o.orderId}>
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
                  </table>
                </DataTable>
              ) : (
                <EmptyState
                  title="No purchase orders yet"
                  description="When an order buys from this factory, it shows here with what we owe and paid."
                />
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
                    <Tr key={o.id}>
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
              <EmptyState title="Nothing in production" description="Orders this factory makes for us show here." />
            )}
          </Card>
          {canRemove && (
            <div className="flex justify-end">
              <ConfirmAction
                action={removeFactoryAction.bind(null, f.id)}
                confirm={`Remove ${f.name}? It will no longer appear in lists and pickers. Its past prices stay on their inquiries.`}
                label="Remove this supplier"
                pendingText="Removing…"
                variant="danger-ghost"
                size="sm"
              />
            </div>
          )}
        </div>

        <aside aria-label="At a glance" className="flex min-w-0 flex-col gap-4">
          {/* Money (board): bought, paid, what we owe. */}
          <Card>
            <CardHeader
              title="Money"
              actions={
                <ButtonLink href={`/factories/${f.id}/costs`} variant="link" size="sm">
                  <FileText aria-hidden /> Statement
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {sums.length ? (
                sums.map((t) => (
                  <div key={t.cur} className="flex flex-col gap-2.5">
                    {[
                      [`Bought (${plural(t.orders, "order")})`, whole(t.owed, t.cur)],
                      ["Paid", whole(t.paid, t.cur)],
                      ["We owe", whole(t.toPay, t.cur)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <span className="text-text-2">{k}</span>
                        <strong className="tabular">{v}</strong>
                      </div>
                    ))}
                  </div>
                ))
              ) : toPay.length ? (
                toPay.map((p) => (
                  <div key={p.currency} className="flex justify-between gap-3">
                    <span className="text-text-2">We owe ({plural(p.orders.length, "order")})</span>
                    <strong className="tabular">{whole(p.toPay, p.currency)}</strong>
                  </div>
                ))
              ) : (
                <p className="text-muted">Nothing bought or owed yet.</p>
              )}
            </CardBody>
          </Card>

          {/* How they perform (board). */}
          <Card>
            <CardHeader title="How they perform" />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {(
                [
                  ["Offers sent", String(f.quotes.length)],
                  ["Chosen in a quotation", String(f.quotes.filter((q) => q.usedIn).length)],
                  ...(perf ? ([["Won by customer", String(perf.offersWon)]] as const) : []),
                  ["Avg. reply", r.avgDaysToAnswer === null ? "—" : `${r.avgDaysToAnswer} days`],
                  ...(perf ? ([["On-time ready", perf.ready.known ? `${perf.ready.onTime} of ${perf.ready.known}` : "—"]] as const) : []),
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-text-2">{k}</span>
                  <strong className="tabular">{v}</strong>
                </div>
              ))}
            </CardBody>
          </Card>
        </aside>
      </div>
      {editing && <FactoryPanel action={saveFactoryAction.bind(null, f.id)} factory={f} people={people} meId={me.id} onRecord />}
    </div>
  );
}
