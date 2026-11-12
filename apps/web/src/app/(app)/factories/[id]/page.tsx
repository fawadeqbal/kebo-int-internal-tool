import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { factoryOf, factoryPayablesOf, partyNotesOf } from "@/lib/party-data";
import { ArrowRight, MessageSquareReply, Package, Tag, Wallet } from "lucide-react";
import { Avatar, ButtonLink, Card, CardBody, CardHeader, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, money, plural, timeAgo } from "@/lib/format";
import { getPeople } from "@/lib/loaders";
import type { Person } from "@/lib/types";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { PerformanceCard } from "@/components/insights/performance";
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
  const [f, people, payables, notes] = await Promise.all([
    factoryOf(id),
    editing ? getPeople().catch(() => [] as Person[]) : ([] as Person[]),
    factoryPayablesOf(id),
    partyNotesOf("factories", id),
  ]);
  const r = f.record;
  const toPay = payables.filter((p) => Number(p.toPay) > 0.005);
  const answered = r.asked ? Math.round((r.answered / r.asked) * 100) : null;

  return (
    <div className="flex flex-col gap-4">
      <RecordLanding />
      <StatRow>
        <StatTile
          icon={Wallet}
          iconColor={2}
          label="Payable"
          value={toPay.length ? toPay.map((p) => money(p.toPay, p.currency)).join(" · ") : "Nothing to pay"}
          sub={toPay.length ? `on ${plural(toPay.reduce((n, p) => n + p.orders.length, 0), "order")}` : "paid up"}
        />
        <StatTile
          icon={Package}
          iconColor={3}
          label="Making for us now"
          value={r.openOrders.length}
          sub={r.lateSteps ? `${plural(r.lateSteps, "production step")} late` : "open orders"}
          tone={r.lateSteps ? "bad" : undefined}
        />
        <StatTile
          icon={MessageSquareReply}
          iconColor={1}
          label="Answers when asked"
          value={answered === null ? "—" : `${answered}%`}
          sub={r.asked ? `${r.answered} of ${r.asked}${r.avgDaysToAnswer !== null ? ` · ${r.avgDaysToAnswer} days on average` : ""}` : "not asked yet"}
          tone={answered !== null && answered < 50 ? "bad" : undefined}
        />
        <StatTile icon={Tag} iconColor={4} label="Price offers" value={f.quotes.length} sub={f.quotes[0] ? `last ${date(f.quotes[0].receivedOn)}` : "none yet"} />
      </StatRow>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
        <DetailsCard
          flash={sp.saved === f.id}
          edit={{ panel: "edit-factory", id: f.id, label: `Edit ${f.name}` }}
          items={[
            { label: "Contact person", value: f.contactPerson },
            {
              label: "Phone",
              value: f.phone && (
                <a href={`tel:${f.phone}`} className="hover:text-primary hover:underline">
                  {f.phone}
                </a>
              ),
            },
            { label: "WeChat", value: f.wechat },
            {
              label: "Email",
              value: f.email && (
                <a href={`mailto:${f.email}`} className="break-all hover:text-primary hover:underline">
                  {f.email}
                </a>
              ),
            },
            { label: "Looked after by", value: f.owner?.name },
            { label: "Address", value: f.address && <span className="whitespace-pre-line">{f.address}</span> },
            { label: "Bank details", value: f.bankDetails && <span className="whitespace-pre-line">{f.bankDetails}</span>, wide: true },
            { label: "Notes", value: f.notes && <span className="whitespace-pre-line">{f.notes}</span>, wide: true, optional: true },
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
          <PerformanceCard kind="factory" id={f.id} me={me} balances={false} />
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

          <Card>
            <CardHeader
              title="Activity"
              actions={
                <ButtonLink href={`/factories/${f.id}/notes`} variant="link" size="sm">
                  Add a note
                </ButtonLink>
              }
            />
            <CardBody>
              {notes.length ? (
                <ol className="flex flex-col gap-3">
                  {notes.slice(0, 5).map((n) => (
                    <li key={n.id} className="flex gap-2.5">
                      <Avatar name={n.author.name} size={30} />
                      <span className="min-w-0 text-[13px]">
                        <span className="line-clamp-2">{n.body}</span>
                        <span className="block text-xs text-muted">
                          {n.author.name} · {timeAgo(n.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">No notes yet.</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
      {editing && <FactoryPanel action={saveFactoryAction.bind(null, f.id)} factory={f} people={people} meId={me.id} onRecord />}
    </div>
  );
}
