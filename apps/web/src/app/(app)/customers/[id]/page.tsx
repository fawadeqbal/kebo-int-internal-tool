import Link from "next/link";
import { MessageCircle, Phone, Plus } from "lucide-react";
import { can, UNKNOWN_COUNTRY } from "@kebo/shared";
import { buttonClass, ButtonLink, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requireUser, hasFeature } from "@/lib/session";
import { money } from "@/lib/format";
import { countryName } from "@/lib/countries";
import type { CustomerDetail } from "@/lib/types-people";
import type { CustomerAccount, CustomerPayments } from "@/lib/types-money";
import type { LedgerParty } from "@/lib/types-ledger";
import type { OrderGroups } from "@/lib/types-facts";
import type { HistoryEntry, Person } from "@/lib/types";
import type { FollowUpList, Note } from "@/lib/types-notes";
import { HistoryList } from "@/components/common/history-list";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { HistoryPanel } from "@/components/common/record-nav";
import { CustomerProfit } from "@/components/money/customer-money";
import { ActivityTab, baseActivity, LatestActivity, MarkDone, sortActivity } from "@/components/party/activity";
import { HashToTab, StatementButton } from "@/components/party/party-client";
import { AttentionCard, ContactCard, EmptyLine, OverviewFrame, PartyBadge, PartyTabs, partyStatus, PhoneBar, Tiles, type ActivityItem, type AttentionRow } from "@/components/party/parts";
import { byCurrency, day, daysBetween, monthOf, plural, round, sumText, today as todayHere } from "@/components/party/format";
import { removeCustomerAction, saveCustomerAction } from "../actions";
import { CustomerPanel } from "../customer-panel";
import { currenciesFrom, type SalesCurrencies } from "../currencies";
import { DetailsTab, InquiriesTab, KeyDetails, OpenInquiriesCard, OpenOrdersCard, PaymentsTab, profitByOrder, SalesOrdersTab } from "./tabs";

export const metadata = { title: "Customer" };

const TABS = ["overview", "orders", "inquiries", "payments", "profit", "details", "activity"] as const;
type Tab = (typeof TABS)[number];

/** Old ?tab= links and #sections → the tab that holds them now. */
const OLD_TAB: Record<string, Tab> = {
  deals: "inquiries",
  money: "payments",
  account: "profit",
  history: "activity",
  notes: "activity",
  "follow-ups": "activity",
  changes: "activity",
  contacts: "details",
};
const OLD_HASH: Record<string, Tab> = { overview: "overview", orders: "orders", inquiries: "inquiries", money: "payments", notes: "activity", "notes-and-follow-ups": "activity", "follow-ups": "activity", contacts: "details", changes: "activity" };

/**
 * A customer (approved design 36). Header: the name, one badge from what they owe, one line of facts, Statement,
 * New inquiry and ⋯. Then the tabs, one at a time (?tab=): Overview (four figures, what needs attention, open
 * sales orders and inquiries; contact, key details and latest activity on the right), Sales orders, Inquiries,
 * Payments, Profit (managers), Details and Activity.
 */
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const canEdit = can(me, "customers.manage");
  const canAsk = can(me, "inquiries.create");
  const canLedger = can(me, "ledger.view");
  const editing = canEdit && sp.panel === "edit-customer";
  const [c, history, payOrNull, managers, settings, notes, followUps, people] = await Promise.all([
    load(() => api.get<CustomerDetail>(`/customers/${id}`)),
    api.get<HistoryEntry[]>("/history", { type: "customer", id }).catch(() => [] as HistoryEntry[]),
    api.get<CustomerPayments>("/payments", { customerId: id }).catch(() => null),
    can(me, "expenses.manage") ? hasFeature("expenses") : false,
    editing ? api.get<SalesCurrencies>("/settings") : null,
    api.get<Note[]>(`/customers/${id}/notes`).catch(() => [] as Note[]),
    api.get<FollowUpList>("/follow-ups", { customerId: id }).catch(() => null),
    api.get<Person[]>("/users/people").catch(() => [] as Person[]),
  ]);
  const asked = (sp.tab && (OLD_TAB[sp.tab] ?? (TABS as readonly string[]).find((t) => t === sp.tab))) || "overview";
  const tab: Tab = asked === "profit" && !managers ? (sp.tab === "account" ? "payments" : "overview") : (asked as Tab);
  const today = todayHere();
  const year = today.slice(0, 4);
  const base = `/customers/${c.id}`;
  const pay: CustomerPayments = payOrNull ?? { totals: [], orders: [], payments: [], credit: { balances: [], entries: [], canRecord: false } };
  const payOf = new Map(pay.orders.map((o) => [o.id, o]));
  const account = managers && (tab === "overview" || tab === "orders" || tab === "profit") ? await api.get<CustomerAccount>(`/customers/${id}/account`).catch(() => null) : null;

  // Their badge, from what they owe.
  const live = pay.orders.filter((o) => o.status !== "cancelled");
  const overdue = byCurrency(live, (o) => o.currency, (o) => o.overdue).filter((s) => s.minor > 0);
  const due = byCurrency(live, (o) => o.currency, (o) => o.due).filter((s) => s.minor > 0);
  const status = partyStatus({ overdue: overdue.length > 0, outstanding: due.length > 0, ordered: c.orders.some((o) => o.status !== "cancelled"), started: c.inquiries.length > 0 });

  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  const handledBy = c.inquiries.find((d) => d.assignee)?.assignee?.name;
  const countryKnown = c.country !== UNKNOWN_COUNTRY;
  const newInquiry = canAsk ? `/inquiries/new?customer=${c.id}` : null;
  const ledger = canLedger ? `/finance/ledger/customers/${c.id}` : null;

  // Everything that happened with them, newest first.
  const activity: ActivityItem[] = sortActivity([
    ...baseActivity(notes, followUps?.rows ?? [], history),
    ...pay.payments
      .filter((p) => !p.voided)
      .map((p): ActivityItem => ({ key: `p-${p.id}`, at: p.paidOn, kind: "payment", who: null, text: `Received ${money(p.amount, p.currency)} on ${p.order.refNo}${p.reference ? ` · ${p.reference}` : ""}`, href: `/orders/${p.order.id}/payment` })),
    ...c.inquiries.flatMap((d) => d.sent.map((r): ActivityItem => ({ key: `q-${d.id}-${r.number}`, at: r.sentOn, kind: "quotation", who: r.by.name, text: `Sent ${d.refNo} revision ${r.number}`, href: `/inquiries/${d.id}/quotation` }))),
    ...c.orders.map((o): ActivityItem => ({ key: `o-${o.id}`, at: o.orderedOn, kind: "order", who: null, text: `${o.refNo} · ${money(o.total, o.currency)}`, href: `/orders/${o.id}` })),
  ]);

  const more: MenuEntry[] = [
    ...(ledger ? [{ label: "Ledger", href: ledger }] : []),
    { label: "Their inquiries", href: `/inquiries?customer=${c.id}&stage=all` },
    { label: "Copy link", copy: base },
    ...(can(me, "customers.delete")
      ? [
          { separator: true as const },
          {
            label: "Archive",
            danger: true as const,
            confirm: { title: `Archive ${c.name}?`, body: "They stay on past inquiries and sales orders. Not possible while a sales order is open.", confirmLabel: "Archive" },
            action: removeCustomerAction.bind(null, c.id),
          },
        ]
      : []),
  ];

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "orders", label: "Sales orders", count: c.orders.length },
    { key: "inquiries", label: "Inquiries", count: c.inquiries.length },
    { key: "payments", label: "Payments" },
    ...(managers ? [{ key: "profit", label: "Profit" }] : []),
    { key: "details", label: "Details" },
    { key: "activity", label: "Activity", count: activity.length },
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Sales" }, { label: "Customers", href: "/customers" }]}
        phoneStack
        title={c.name}
        badge={<PartyBadge s={status} />}
        summary={[
          countryKnown ? countryName(c.country) : "Country not set",
          c.defaultCurrency,
          handledBy ? `handled by ${handledBy}` : null,
          `since ${monthOf(c.createdAt)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        papers={ledger && <StatementButton kind="customer" id={c.id} from={`${year}-01-01`} to={today} back={base} />}
        primary={
          newInquiry && (
            <ButtonLink href={newInquiry} variant="primary">
              <Plus aria-hidden /> New inquiry
            </ButtonLink>
          )
        }
        more={<MoreMenu items={more} label={`More for ${c.name}`} />}
      />
      <HashToTab map={OLD_HASH} />
      <PartyTabs base={base} tabs={tabs} current={tab} />

      {tab === "overview" && (
        <>
          <Tiles
            items={[
              (() => {
                const mine = c.orders.filter((o) => o.status !== "cancelled" && o.orderedOn.startsWith(year));
                return { label: `Sales · ${year}`, help: "Total of their sales orders this year, cancelled ones left out.", value: round(byCurrency(mine, (o) => o.currency, (o) => o.total), "—"), sub: plural(mine.length, "sales order") };
              })(),
              ...(account
                ? [
                    (() => {
                      const rows = account.rows.flatMap((r) => (r.order && r.order.orderedOn.startsWith(year) ? [r.order] : []));
                      const gp = rows.reduce((t, o) => t + Number(o.profit), 0);
                      const rev = rows.reduce((t, o) => t + Number(o.revenue), 0);
                      return {
                        label: "Gross profit",
                        help: "Quoted profit, less unplanned costs and bank charges, this year.",
                        value: rows.length ? `${gp < 0 ? "−" : ""}${account.currency} ${Math.round(Math.abs(gp)).toLocaleString("en-US")}` : "—",
                        sub: rev > 0 ? `${((gp / rev) * 100).toFixed(1)}%` : "no sales order this year",
                        tone: gp < 0 ? ("bad" as const) : undefined,
                      };
                    })(),
                  ]
                : []),
              {
                label: "Balance due",
                help: "Total minus payments so far, on every sales order.",
                value: sumText(due, money(0, c.defaultCurrency)),
                sub: overdue.length ? `${sumText(overdue, "")} overdue` : due.length ? "nothing overdue" : "paid up",
                tone: overdue.length ? "bad" : undefined,
              },
              (() => {
                const held = pay.credit.balances.filter((b) => Number(b.amount) > 0);
                return {
                  label: "Advance / credit",
                  help: "Customer money we hold. Offered when their next sales order needs a deposit.",
                  value: held.length ? held.map((b) => money(b.amount, b.currency)).join(" + ") : money(0, c.defaultCurrency),
                  sub: held.length ? (due.length ? "can be applied" : "held for them") : "none held",
                };
              })(),
            ]}
          />
          <OverviewFrame
            main={
              <>
                <AttentionCard rows={attention(c, pay, followUps?.rows ?? [], today)} />
                <OpenOrdersCard base={base} orders={c.orders} pay={payOf} today={today} />
                <OpenInquiriesCard base={base} inquiries={c.inquiries} />
                {!c.orders.some((o) => o.status === "open") && !c.inquiries.some((d) => ["new", "sourcing", "quoted"].includes(d.stage)) && (
                  <div className="rounded-xl border border-line bg-surface">
                    <EmptyLine
                      action={
                        newInquiry && (
                          <ButtonLink href={newInquiry} size="sm" variant="secondary">
                            <Plus aria-hidden /> New inquiry
                          </ButtonLink>
                        )
                      }
                    >
                      No open sales orders or inquiries.
                    </EmptyLine>
                  </div>
                )}
              </>
            }
            side={
              <>
                <ContactCard contact={primary} chat="whatsapp" all={{ href: `${base}?tab=details`, count: c.contacts.length }} empty={<EmptyLine>No contacts yet.</EmptyLine>} />
                <KeyDetails c={c} canEdit={canEdit} handledBy={handledBy} />
                <LatestActivity items={activity} base={base} today={today} />
              </>
            }
          />
        </>
      )}
      {tab === "orders" && <SalesOrdersTab c={c} base={base} filter={sp.f} pay={payOf} profit={profitByOrder(account)} today={today} newInquiry={newInquiry} />}
      {tab === "inquiries" && <InquiriesTab c={c} base={base} filter={sp.f} today={today} newInquiry={newInquiry} />}
      {tab === "payments" && (
        <PaymentsTab
          c={c}
          pay={pay}
          ledger={canLedger ? await api.get<LedgerParty>(`/ledger/parties/customer/${c.id}`, { from: today, to: today }).catch(() => null) : null}
          habit={await payingHabit(me, c.id)}
          today={today}
          statement={canLedger}
        />
      )}
      {tab === "profit" && account && <CustomerProfit a={account} customerId={c.id} customerName={c.name} />}
      {tab === "details" && <DetailsTab c={c} canEdit={canEdit} handledBy={handledBy} />}
      {tab === "activity" && (
        <ActivityTab
          base={base}
          filter={sp.kind}
          items={activity}
          followUps={followUps?.rows ?? []}
          today={today}
          canNote={canEdit}
          on={{ key: "customerId", id: c.id }}
          label={c.name}
          contacts={c.contacts.map((p) => ({ id: p.id, name: p.name }))}
          people={people}
          meId={me.id}
        />
      )}

      <PhoneBar>
        {primary?.phone && (
          <a href={`tel:${primary.phone}`} className={buttonClass("secondary", "md")}>
            <Phone aria-hidden /> Call
          </a>
        )}
        {(primary?.whatsapp || primary?.phone) && (
          <a href={`https://wa.me/${(primary.whatsapp || primary.phone)!.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")}>
            <MessageCircle aria-hidden /> WhatsApp
          </a>
        )}
        {newInquiry && (
          <Link href={newInquiry} className={buttonClass("primary", "md")}>
            <Plus aria-hidden /> Inquiry
          </Link>
        )}
      </PhoneBar>

      {editing && settings && <CustomerPanel action={saveCustomerAction.bind(null, c.id)} customer={c} currencies={currenciesFrom(settings)} onRecord />}
      {sp.panel === "history" && (
        <HistoryPanel title={`History · ${c.name}`}>
          <HistoryList entries={history} />
        </HistoryPanel>
      )}
    </div>
  );
}

/**
 * What needs someone today: overdue instalments, follow-ups due today or before, and inquiries waiting three
 * days or more for supplier quotes. Overdue first; five at most (the card cuts).
 */
function attention(c: CustomerDetail, pay: CustomerPayments, followUps: FollowUpList["rows"], today: string): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const o of pay.orders) {
    if (o.status === "cancelled" || Number(o.overdue) <= 0.005) continue;
    rows.push({
      key: `o-${o.id}`,
      tone: "bad",
      title: `${o.refNo} · balance ${money(o.overdue, o.currency)}`,
      sub: `Overdue ${plural(daysBetween(o.overdueSince ?? today, today), "day")}${o.next?.label ? ` · ${o.next.label}` : ""}`,
      href: `/orders/${o.id}/payment`,
      action: (
        <ButtonLink href={`/orders/${o.id}/payment`} size="sm" variant="secondary">
          Record payment
        </ButtonLink>
      ),
    });
  }
  for (const f of followUps) {
    if (f.done || f.dueOn > today) continue;
    rows.push({
      key: `f-${f.id}`,
      tone: f.dueOn < today ? "bad" : "warn",
      title: `Follow-up: ${f.title}`,
      sub: `${f.dueOn < today ? `Overdue since ${day(f.dueOn, today)}` : "Today"} · ${f.assignee.name}`,
      action: f.can.done ? <MarkDone f={f} /> : <span />,
    });
  }
  for (const d of c.inquiries) {
    if (d.stage !== "sourcing" || d.onHold) continue;
    const waited = daysBetween(d.createdAt.slice(0, 10), today);
    if (waited < 3) continue;
    rows.push({
      key: `d-${d.id}`,
      tone: "warn",
      title: `${d.refNo} · no supplier quote yet`,
      sub: `Sourcing for ${plural(waited, "day")}${d.assignee ? ` · ${d.assignee.name}` : ""}`,
      href: `/inquiries/${d.id}/sourcing`,
      action: (
        <ButtonLink href={`/inquiries/${d.id}/sourcing`} size="sm" variant="ghost">
          Open
        </ButtonLink>
      ),
    });
  }
  return rows.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1));
}

/** Days to pay and paid on time, from Reports (for those who may see it). */
async function payingHabit(me: Awaited<ReturnType<typeof requireUser>>, customerId: string) {
  if (!can(me, "reports.view") || !(await hasFeature("insights"))) return null;
  const g = await api.get<OrderGroups>("/insights/facts/orders/groups", { period: "all", customerId }).catch(() => null);
  return g?.rows[0] ?? null;
}
