import { redirect } from "next/navigation";
import { can, PARTY_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { Avatar, Banner, Card, CardBody, CardHeader, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, Tr, ButtonLink } from "@kebo/ui";
import { ArrowRight } from "lucide-react";
import { ORDER_STAGE_LABEL, ORDER_STAGE_TONE, type OrderStage } from "@kebo/shared";
import { customerPaymentsOf, partyNotesOf } from "@/lib/party-data";
import { date, money, timeAgo } from "@/lib/format";
import { hasFeature, requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import type { OrderGroups } from "@/lib/types-facts";
import { customerOf } from "@/lib/party-data";
import { countryName } from "@/lib/countries";
import { OpenPanelButton } from "@/components/common/panel";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { getSettings } from "@/lib/loaders";
import { saveCustomerAction } from "../actions";
import { CustomerPanel } from "../customer-panel";
import { currenciesFrom } from "../currencies";

export const metadata = { title: "Customer" };

const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;

/** Old ?tab= links and the history panel → the tab that has them now. */
const TAB_OF: Record<string, string> = {
  inquiries: "inquiries",
  deals: "inquiries",
  orders: "orders",
  money: "money",
  payments: "money",
  account: "money?view=profit",
  history: "notes",
  contacts: "contacts",
};

/**
 * The customer's Overview tab: Performance (from Insights) and Details with ✎ Edit (the side panel), the
 * primary contact among them. Contacts, orders, inquiries, money and notes each have their own tab.
 */
export default async function CustomerOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const old = sp.tab ? TAB_OF[sp.tab] : sp.panel === "history" ? "notes" : undefined;
  if (old) redirect(`/customers/${id}/${old}`);
  const me = await requireUser();
  const canEdit = can(me, "customers.manage");
  const editing = canEdit && sp.panel === "edit-customer";
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const [c, settings, pay, notes, groups] = await Promise.all([
    customerOf(id),
    editing ? getSettings() : null,
    customerPaymentsOf(id),
    partyNotesOf("customers", id),
    insights ? api.get<OrderGroups>("/insights/facts/orders/groups", { period: "all", by: "company", customerId: id }).catch(() => null) : null,
  ]);
  const facts = groups?.rows[0];
  const latest = [...(pay?.orders ?? [])].sort((a, b) => b.orderedOn.localeCompare(a.orderedOn)).slice(0, 5);
  const totals = pay?.totals ?? [];
  const openOrders = c.orders.filter((o) => o.status === "open").length;
  const won = c.inquiries.filter((d) => d.stage === "won").length;
  const lost = c.inquiries.filter((d) => d.stage === "lost").length;
  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  const countryKnown = c.country !== UNKNOWN_COUNTRY;

  return (
    <div className="flex flex-col gap-4">
      <RecordLanding />
      <StatRow>
        <StatTile label="Orders" value={c.orders.filter((o) => o.status !== "cancelled").length} sub={`${openOrders} open`} />
        <StatTile label="Win rate" value={won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "—"} sub={`${won} of ${won + lost} inquiries`} />
        <StatTile label="Avg. days to pay" value={facts?.daysToPay === null || facts?.daysToPay === undefined ? "—" : String(Math.round(facts.daysToPay))} sub="order to paid in full" />
        <StatTile label="Margin" value={facts?.marginQuote === null || facts?.marginQuote === undefined ? "—" : `${Math.round(facts.marginQuote * 10) / 10}%`} sub="on their orders" />
      </StatRow>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
        <DetailsCard
          flash={sp.saved === c.id}
          edit={canEdit ? { panel: "edit-customer", id: c.id, label: `Edit ${c.name}` } : null}
          items={[
          { label: "Type", value: PARTY_TYPE_LABEL[c.type] },
          { label: "Country", value: countryKnown ? countryName(c.country) : null },
          { label: "Default currency", value: c.defaultCurrency },
          { label: "Address", value: c.address && <span className="whitespace-pre-line">{c.address}</span>, wide: true },
          { label: "Initials on papers", value: c.initials },
          { label: "Tax no.", value: c.taxNo },
          { label: "Registration no.", value: c.regNo },
          { label: "Notes", value: c.notes && <span className="whitespace-pre-line">{c.notes}</span>, wide: true },
        ]}
          footer={
            !countryKnown && (
              <Banner meaning="warn" className="mx-4 mb-4">
                Their country is not set yet — it decides shipping.{" "}
                {canEdit ? (
                  <OpenPanelButton panel="edit-customer" id={c.id} variant="link" size="sm" className="h-auto font-semibold">
                    Add it
                  </OpenPanelButton>
                ) : (
                  "Ask someone who manages customers to add it."
                )}
              </Banner>
            )
          }
        />
          {/* Latest orders (board): number, date, total, what they owe, stage. */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Latest orders"
              actions={
                <ButtonLink href={`/customers/${c.id}/orders`} variant="link" size="sm">
                  All orders <ArrowRight aria-hidden />
                </ButtonLink>
              }
            />
            {latest.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">They owe</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {latest.map((o) => (
                    <Tr key={o.id}>
                      <Td>
                        <RefCode href={`/orders/${o.id}`}>{o.refNo}</RefCode>
                      </Td>
                      <Td className="whitespace-nowrap">{date(o.orderedOn)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{money(o.total, o.currency)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{Number(o.due) > 0.005 ? money(o.due, o.currency) : "—"}</Td>
                      <Td>
                        {o.status === "cancelled" ? (
                          <StatusBadge meaning="neutral">Cancelled</StatusBadge>
                        ) : o.status === "closed" ? (
                          <StatusBadge meaning="ok">Closed</StatusBadge>
                        ) : (
                          <StatusBadge meaning={ORDER_STAGE_TONE[o.stage as OrderStage] ?? "info"}>{ORDER_STAGE_LABEL[o.stage as OrderStage] ?? o.stage}</StatusBadge>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <CardBody>
                <p className="text-sm text-muted">No orders yet. An order is made when they accept a quotation.</p>
              </CardBody>
            )}
          </Card>
        </div>

        <aside aria-label="At a glance" className="flex min-w-0 flex-col gap-4">
          {/* Money (board): sold, received, they owe, credit, per currency. */}
          <Card>
            <CardHeader
              title="Money"
              actions={
                <ButtonLink href={`/customers/${c.id}/money`} variant="link" size="sm">
                  Statement
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {totals.length ? (
                totals.map((t) => (
                  <div key={t.currency} className="flex flex-col gap-2.5">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">Sold ({t.orders} order{t.orders === 1 ? "" : "s"})</span>
                      <strong className="tabular">{money(t.total, t.currency)}</strong>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">Received</span>
                      <strong className="tabular">{money(t.received, t.currency)}</strong>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">They owe</span>
                      <strong className="tabular">{money(t.due, t.currency)}</strong>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted">No orders yet.</p>
              )}
              {(pay?.credit.balances ?? []).map((b) => (
                <div key={b.currency} className="flex justify-between gap-3">
                  <span className="text-muted">Credit on account</span>
                  <strong className="tabular">{money(b.amount, b.currency)}</strong>
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Main contact (board). */}
          <Card>
            <CardHeader
              title="Main contact"
              actions={
                <ButtonLink href={`/customers/${c.id}/contacts`} variant="link" size="sm">
                  All {c.contacts.length}
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-1.5 text-sm">
              {primary ? (
                <>
                  <strong>{primary.name}</strong>
                  {primary.position && <span className="text-muted">{primary.position}{primary.isPrimary ? " · primary" : ""}</span>}
                  {primary.email && (
                    <a href={`mailto:${primary.email}`} className="break-all hover:text-primary">
                      {primary.email}
                    </a>
                  )}
                  {primary.phone && <a href={`tel:${primary.phone}`}>{primary.phone}</a>}
                  {primary.whatsapp && (
                    <a href={waLink(primary.whatsapp)} target="_blank" rel="noreferrer" className="hover:text-primary">
                      WhatsApp {primary.whatsapp}
                    </a>
                  )}
                  {primary.wechat && <span>WeChat {primary.wechat}</span>}
                </>
              ) : (
                <span className="text-muted">No contact yet.</span>
              )}
            </CardBody>
          </Card>

          {/* Activity (board): the latest notes and calls. */}
          <Card>
            <CardHeader
              title="Activity"
              actions={
                <ButtonLink href={`/customers/${c.id}/notes`} variant="link" size="sm">
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
      {editing && settings && <CustomerPanel action={saveCustomerAction.bind(null, c.id)} customer={c} currencies={currenciesFrom(settings)} onRecord />}
    </div>
  );
}
