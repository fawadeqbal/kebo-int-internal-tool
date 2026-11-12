import { redirect } from "next/navigation";
import { can, PARTY_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { Avatar, Banner, Card, CardBody, CardHeader, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, Tr, ButtonLink } from "@kebo/ui";
import { ArrowRight, FileText, MessageSquare, Package, Wallet } from "lucide-react";
import { todayIn } from "@kebo/utils";
import { late, OPEN_STAGES, owes } from "./shared";
import { ORDER_STAGE_LABEL, ORDER_STAGE_TONE, type OrderStage } from "@kebo/shared";
import { customerPaymentsOf, partyNotesOf } from "@/lib/party-data";
import { date, money, timeAgo, TZ } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { customerOf } from "@/lib/party-data";
import { countryName } from "@/lib/countries";
import { OpenPanelButton } from "@/components/common/panel";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { PerformanceCard } from "@/components/insights/performance";
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
  const [c, settings, pay, notes] = await Promise.all([customerOf(id), editing ? getSettings() : null, customerPaymentsOf(id), partyNotesOf("customers", id)]);
  const latest = [...(pay?.orders ?? [])].sort((a, b) => b.orderedOn.localeCompare(a.orderedOn)).slice(0, 5);
  const totals = pay?.totals ?? [];
  const today = todayIn(TZ);
  const openOrders = c.orders.filter((o) => o.status === "open").length;
  const openDeals = c.inquiries.filter((d) => OPEN_STAGES.includes(d.stage)).length;
  const won = c.inquiries.filter((d) => d.stage === "won").length;
  const lost = c.inquiries.filter((d) => d.stage === "lost").length;
  const dueTotals = totals.filter((t) => Number(t.due) > 0.005);
  const lateOrders = (pay?.orders ?? []).filter((o) => late(o, today)).length;
  const owing = (pay?.orders ?? []).filter(owes).length;
  const held = (pay?.credit.balances ?? []).filter((b) => Number(b.amount) > 0.005);
  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  const countryKnown = c.country !== UNKNOWN_COUNTRY;

  return (
    <div className="flex flex-col gap-4">
      <RecordLanding />
      <StatRow>
        <StatTile
          icon={FileText}
          iconColor={2}
          label="Receivable"
          value={dueTotals.length ? dueTotals.map((t) => money(t.due, t.currency)).join(" · ") : pay ? "Nothing due" : "—"}
          sub={lateOrders ? `${lateOrders} late` : owing ? `on ${owing} order${owing === 1 ? "" : "s"} · none late` : "paid up"}
          tone={lateOrders ? "bad" : undefined}
        />
        <StatTile icon={Package} iconColor={3} label="Open orders" value={openOrders} sub={`${c.orders.length} in all`} />
        <StatTile icon={MessageSquare} iconColor={4} label="Open inquiries" value={openDeals} sub={`${won} won · ${lost} lost`} />
        <StatTile
          icon={Wallet}
          iconColor={5}
          label="Advance held"
          value={held.length ? held.map((b) => money(b.amount, b.currency)).join(" · ") : "—"}
          sub={held.length ? "their money we hold" : "none"}
        />
      </StatRow>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
        <DetailsCard
          flash={sp.saved === c.id}
          edit={canEdit ? { panel: "edit-customer", id: c.id, label: `Edit ${c.name}` } : null}
          items={[
            { label: "Contact", value: primary && [primary.name, primary.position].filter(Boolean).join(" · ") },
            {
              label: "Email",
              value: primary?.email && (
                <a href={`mailto:${primary.email}`} className="break-all hover:text-primary hover:underline">
                  {primary.email}
                </a>
              ),
            },
            {
              label: "Phone / WhatsApp",
              value: (primary?.phone || primary?.whatsapp) && (
                <>
                  {primary.phone && (
                    <a href={`tel:${primary.phone}`} className="hover:text-primary hover:underline">
                      {primary.phone}
                    </a>
                  )}
                  {primary.whatsapp && primary.whatsapp !== primary.phone && (
                    <>
                      {primary.phone && " · "}
                      <a href={waLink(primary.whatsapp)} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                        WhatsApp {primary.whatsapp}
                      </a>
                    </>
                  )}
                </>
              ),
            },
            { label: "Country", value: countryKnown ? countryName(c.country) : null },
            { label: "Address on papers", value: c.address && <span className="whitespace-pre-line">{c.address}</span> },
            { label: "Business license number", value: c.taxNo },
            { label: "Currency they pay in", value: c.defaultCurrency },
            { label: "Type", value: PARTY_TYPE_LABEL[c.type] },
            { label: "WeChat", value: primary?.wechat, optional: true },
            { label: "Reg. number", value: c.regNo, optional: true },
            { label: "Letters on documents", value: c.initials, optional: true },
            { label: "Notes", value: c.notes && <span className="whitespace-pre-line">{c.notes}</span>, wide: true, optional: true },
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
          <PerformanceCard kind="customer" id={c.id} me={me} balances={false} />
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
