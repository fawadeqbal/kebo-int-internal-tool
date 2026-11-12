import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { factoryOf, factoryPayablesOf } from "@/lib/party-data";
import { ArrowRight } from "lucide-react";
import { ButtonLink, Card, CardBody, CardHeader, RefCode, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, money, plural } from "@/lib/format";
import { getPeople } from "@/lib/loaders";
import type { Person } from "@/lib/types";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { saveFactoryAction } from "../actions";
import { FactoryPanel } from "../factory-form";

export const metadata = { title: "Supplier" };

/** Old ?tab= links, ?offers=all and the history panel → the tab that has them now. */
const TAB_OF: Record<string, string> = { prices: "offers", costs: "costs", making: "orders", history: "notes" };

/**
 * The supplier's Overview tab: Performance (Insights) and Details with ✎ Edit (the side panel), its main
 * contact among them. What it makes, its prices, costs and notes each have their own tab.
 */
export default async function FactoryOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const old = sp.tab ? TAB_OF[sp.tab] : sp.offers === "all" ? "offers" : sp.panel === "history" ? "notes" : undefined;
  if (old) redirect(`/factories/${id}/${old}`);
  const me = await requirePermission("sourcing.manage");
  const editing = sp.panel === "edit-factory";
  const [f, people, payables] = await Promise.all([
    factoryOf(id),
    editing ? getPeople().catch(() => [] as Person[]) : ([] as Person[]),
    factoryPayablesOf(id),
  ]);
  const r = f.record;
  const toPay = payables.filter((p) => Number(p.toPay) > 0.005);
  const answered = r.asked ? Math.round((r.answered / r.asked) * 100) : null;

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
          { label: "Email", value: f.email && <a href={`mailto:${f.email}`} className="break-all">{f.email}</a> },
          { label: "Owner", value: f.owner?.name },
          { label: "Address", value: f.address && <span className="whitespace-pre-line">{f.address}</span> },
          { label: "Bank details", value: f.bankDetails && <span className="whitespace-pre-line">{f.bankDetails}</span>, wide: true },
          { label: "Notes", value: f.notes && <span className="whitespace-pre-line">{f.notes}</span>, wide: true },
        ]}
        />
          {/* Making for us now (board: purchase orders): the open orders with this factory and their ready dates. */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Making for us now"
              actions={
                <ButtonLink href={`/factories/${f.id}/orders`} variant="link" size="sm">
                  All <ArrowRight aria-hidden />
                </ButtonLink>
              }
            />
            {r.openOrders.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Order</Th>
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
                      <Td className="font-semibold">{o.customer}</Td>
                      <Td className="whitespace-nowrap">{o.readyOn ? date(o.readyOn) : <StatusBadge meaning="neutral">Not given</StatusBadge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <CardBody>
                <p className="text-sm text-muted">Nothing in production with this factory now.</p>
              </CardBody>
            )}
          </Card>
        </div>

        <aside aria-label="At a glance" className="flex min-w-0 flex-col gap-4">
          {/* Money (board): what we still owe them, per currency. */}
          <Card>
            <CardHeader
              title="Money"
              actions={
                <ButtonLink href={`/factories/${f.id}/costs`} variant="link" size="sm">
                  Statement
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {toPay.length ? (
                toPay.map((p) => (
                  <div key={p.currency} className="flex justify-between gap-3">
                    <span className="text-muted">We owe ({plural(p.orders.length, "order")})</span>
                    <strong className="tabular">{money(p.toPay, p.currency)}</strong>
                  </div>
                ))
              ) : (
                <p className="text-muted">Nothing to pay.</p>
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
                  ["Asked for prices", String(r.asked)],
                  ["Answered", answered === null ? "—" : `${answered}%`],
                  ["Declined", String(r.declined)],
                  ["No reply", String(r.noReply)],
                  ["Avg. reply", r.avgDaysToAnswer === null ? "—" : `${r.avgDaysToAnswer} days`],
                  ["Late production steps", String(r.lateSteps)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span>{k}</span>
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
