import Link from "next/link";
import { Phone } from "lucide-react";
import { can } from "@kebo/shared";
import { buttonClass, ButtonLink, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requirePermission, hasFeature } from "@/lib/session";
import { money } from "@/lib/format";
import type { ExpenseList } from "@/lib/types-money";
import type { FactoryDetail, FactoryPurchases } from "@/lib/types-people";
import type { LedgerParty } from "@/lib/types-ledger";
import type { HistoryEntry, Person } from "@/lib/types";
import type { FollowUpList, Note } from "@/lib/types-notes";
import { HistoryList } from "@/components/common/history-list";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { HistoryPanel } from "@/components/common/record-nav";
import { ActivityTab, baseActivity, LatestActivity, MarkDone, sortActivity } from "@/components/party/activity";
import { CopyButton, HashToTab, StatementButton } from "@/components/party/party-client";
import { AttentionCard, ContactCard, EmptyLine, OverviewFrame, PartyBadge, PartyTabs, partyStatus, PhoneBar, Tiles, type ActivityItem, type AttentionRow } from "@/components/party/parts";
import { byCurrency, day, daysBetween, monthOf, plural, round, sumText, today as todayHere } from "@/components/party/format";
import { removeFactoryAction, saveFactoryAction } from "../actions";
import { FactoryPanel } from "../factory-form";
import { BankCard, CostsTab, DetailsTab, InProductionCard, KeyDetails, LatestQuotesCard, own, PaymentsTab, PurchaseOrdersTab, SupplierQuotesTab } from "./tabs";

export const metadata = { title: "Factory" };

const TABS = ["overview", "orders", "quotes", "payments", "costs", "details", "activity"] as const;
type Tab = (typeof TABS)[number];

/** Old ?tab= links and #sections → the tab that holds them now. */
const OLD_TAB: Record<string, Tab> = { prices: "quotes", offers: "quotes", making: "orders", history: "activity", notes: "activity", changes: "activity" };
const OLD_HASH: Record<string, Tab> = { overview: "overview", making: "orders", offers: "quotes", notes: "activity", "notes-and-follow-ups": "activity", "follow-ups": "activity", costs: "costs", changes: "activity" };

const EMPTY: FactoryPurchases = { today: "", mainCurrency: "", orders: [], payments: [], readiness: { onTime: 0, known: 0, avgDaysLate: null }, totals: [], waiting: [] };

/**
 * A factory (approved design 36). Header: the name, one badge from what we owe it, one line of facts, Statement,
 * Request quotes (the inquiries waiting for supplier quotes) and ⋯. Then the tabs, one at a time (?tab=):
 * Overview (four figures, what needs attention, what it is making, latest supplier quotes; contact, key details,
 * bank and latest activity on the right), Purchase orders, Supplier quotes, Payments, Costs (managers), Details
 * and Activity.
 */
export default async function FactoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requirePermission("sourcing.manage");
  const canLedger = can(me, "ledger.view");
  const editing = sp.panel === "edit-factory";
  const [f, history, managers, people, notes, followUps, purchases] = await Promise.all([
    load(() => api.get<FactoryDetail>(`/factories/${id}`)),
    api.get<HistoryEntry[]>("/history", { type: "factory", id }).catch(() => [] as HistoryEntry[]),
    can(me, "expenses.manage") ? hasFeature("expenses") : false,
    api.get<Person[]>("/users/people").catch(() => [] as Person[]),
    api.get<Note[]>(`/factories/${id}/notes`).catch(() => [] as Note[]),
    api.get<FollowUpList>("/follow-ups", { factoryId: id }).catch(() => null),
    api.get<FactoryPurchases>(`/factories/${id}/purchases`).catch(() => null),
  ]);
  const p = purchases ?? EMPTY;
  const asked = (sp.tab && (OLD_TAB[sp.tab] ?? (TABS as readonly string[]).find((t) => t === sp.tab))) || (sp.offers === "all" ? "quotes" : "overview");
  const tab: Tab = asked === "costs" && !managers ? "overview" : (asked as Tab);
  const today = todayHere();
  const year = today.slice(0, 4);
  const base = `/factories/${f.id}`;
  const r = f.record;

  const live = p.orders.filter((o) => o.status !== "cancelled");
  const due = byCurrency(live, (o) => own(o, "balanceDue").currency, (o) => own(o, "balanceDue").amount).filter((s) => s.minor > 0);
  const dueNow = live.flatMap((o) => o.open.filter((x) => x.due && x.due <= today).map((x) => ({ o, x })));
  const status = partyStatus({ overdue: dueNow.some(({ x }) => x.due! < today), outstanding: due.length > 0, ordered: live.length > 0, started: f.quotes.length > 0 });
  const currency = p.orders.find((o) => o.currency)?.currency ?? f.quotes[0]?.currency ?? null;
  const primary = f.contacts.find((c) => c.isPrimary) ?? f.contacts[0] ?? null;
  const ledger = canLedger ? `/finance/ledger/factories/${f.id}` : null;

  const activity: ActivityItem[] = sortActivity([
    ...baseActivity(notes, followUps?.rows ?? [], history),
    ...p.payments
      .filter((x) => !x.voided)
      .map((x): ActivityItem => ({ key: `p-${x.id}`, at: x.paidOn, kind: "payment", who: null, text: `Paid ${money(x.amount, x.currency)} on ${x.order.refNo}${x.reference ? ` · ${x.reference}` : ""}`, href: `/orders/${x.order.id}/factory` })),
    ...f.quotes.map((q): ActivityItem => ({ key: `q-${q.id}`, at: q.receivedOn.slice(0, 10), kind: "supplier_quote", who: null, text: `${q.inquiry.refNo} · ${plural(q._count.lines, "line")} · ${q.currency}`, href: `/inquiries/${q.inquiry.id}/sourcing` })),
  ]);

  const more: MenuEntry[] = [
    ...(ledger ? [{ label: "Ledger", href: ledger }] : []),
    { label: "Copy link", copy: base },
    ...(can(me, "inquiries.updateAny")
      ? [
          { separator: true as const },
          {
            label: "Archive",
            danger: true as const,
            confirm: { title: `Archive ${f.name}?`, body: "Its supplier quotes stay on their inquiries.", confirmLabel: "Archive" },
            action: removeFactoryAction.bind(null, f.id),
          },
        ]
      : []),
  ];

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "orders", label: "Purchase orders", count: p.orders.length },
    { key: "quotes", label: "Supplier quotes", count: f.quotes.length },
    { key: "payments", label: "Payments" },
    ...(managers ? [{ key: "costs", label: "Costs" }] : []),
    { key: "details", label: "Details" },
    { key: "activity", label: "Activity", count: activity.length },
  ];

  const mine = live.filter((o) => o.orderedOn.startsWith(year));
  const answered = r.asked ? Math.round((r.answered / r.asked) * 100) : null;
  const dueWeek = byCurrency(
    live.flatMap((o) => o.open.filter((x) => x.due && daysBetween(today, x.due) <= 7)),
    (x) => x.currency,
    (x) => x.open,
  );

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Purchasing" }, { label: "Factories", href: "/factories" }]}
        phoneStack
        title={f.name}
        badge={<PartyBadge s={status} />}
        summary={[currency, f.owner ? `handled by ${f.owner.name}` : null, `since ${monthOf(f.createdAt)}`].filter(Boolean).join(" · ")}
        papers={ledger && <StatementButton kind="factory" id={f.id} from={`${year}-01-01`} to={today} back={base} />}
        primary={
          <ButtonLink href="/inquiries?stage=sourcing" variant="primary">
            Request quotes
          </ButtonLink>
        }
        more={<MoreMenu items={more} label={`More for ${f.name}`} />}
      />
      <HashToTab map={OLD_HASH} />
      <PartyTabs base={base} tabs={tabs} current={tab} />

      {tab === "overview" && (
        <>
          <Tiles
            items={[
              { label: `Purchases · ${year}`, help: "Total of our purchase orders to them this year.", value: round(byCurrency(mine, (o) => own(o, "total").currency, (o) => own(o, "total").amount), "—"), sub: plural(mine.length, "purchase order") },
              {
                label: "Balance due",
                help: "What we still owe them, on every purchase order.",
                value: sumText(due, currency ? money(0, currency) : "—"),
                sub: dueWeek.length ? `${sumText(dueWeek, "")} due this week` : due.length ? "nothing due this week" : "paid up",
                tone: due.length ? "warn" : undefined,
              },
              {
                label: "Ready on time",
                help: "Purchase orders ready by the ready date they gave.",
                value: p.readiness.known ? `${p.readiness.onTime} of ${p.readiness.known}` : "—",
                sub: p.readiness.avgDaysLate ? `avg ${p.readiness.avgDaysLate} days late` : p.readiness.known ? "never late" : "none ready yet",
                tone: p.readiness.known && p.readiness.onTime / p.readiness.known < 0.5 ? "bad" : undefined,
              },
              {
                label: "Quotes answered",
                help: "Quote requests they answered with a supplier quote, and how fast.",
                value: answered === null ? "—" : `${answered}%`,
                sub: r.asked ? `${r.answered} of ${r.asked}${r.avgDaysToAnswer !== null ? ` · ${r.avgDaysToAnswer} days` : ""}` : "none requested yet",
                tone: answered !== null && answered < 50 ? "bad" : undefined,
              },
            ]}
          />
          <OverviewFrame
            main={
              <>
                <AttentionCard rows={attention(p, followUps?.rows ?? [], today)} />
                <InProductionCard base={base} p={p} today={today} />
                <LatestQuotesCard base={base} f={f} today={today} />
                {!live.some((o) => o.status === "open") && !f.quotes.length && (
                  <div className="rounded-xl border border-line bg-surface">
                    <EmptyLine
                      action={
                        <ButtonLink href="/inquiries?stage=sourcing" size="sm" variant="secondary">
                          Request quotes
                        </ButtonLink>
                      }
                    >
                      No purchase orders or supplier quotes yet.
                    </EmptyLine>
                  </div>
                )}
              </>
            }
            side={
              <>
                <ContactCard contact={primary} chat="wechat" all={{ href: `${base}?tab=details`, count: f.contacts.length }} empty={<EmptyLine>No contacts yet.</EmptyLine>} />
                <KeyDetails f={f} currency={currency} />
                <BankCard f={f} />
                <LatestActivity items={activity} base={base} today={today} />
              </>
            }
          />
        </>
      )}
      {tab === "orders" && <PurchaseOrdersTab f={f} p={p} base={base} filter={sp.f} today={today} />}
      {tab === "quotes" && <SupplierQuotesTab f={f} p={p} today={today} />}
      {tab === "payments" && (
        <PaymentsTab f={f} p={p} ledger={canLedger ? await api.get<LedgerParty>(`/ledger/parties/factory/${f.id}`, { from: today, to: today }).catch(() => null) : null} today={today} statement={canLedger} />
      )}
      {tab === "costs" && managers && <CostsTabLoader id={f.id} today={today} />}
      {tab === "details" && <DetailsTab f={f} currency={currency} />}
      {tab === "activity" && (
        <ActivityTab
          base={base}
          filter={sp.kind}
          items={activity}
          followUps={followUps?.rows ?? []}
          today={today}
          canNote
          on={{ key: "factoryId", id: f.id }}
          label={f.name}
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
        {primary?.wechat && <CopyButton text={primary.wechat} label="WeChat" done="WeChat ID copied" className="h-10" />}
        <Link href="/inquiries?stage=sourcing" className={buttonClass("primary", "md")}>
          Request quotes
        </Link>
      </PhoneBar>

      {editing && <FactoryPanel action={saveFactoryAction.bind(null, f.id)} factory={f} people={people} meId={me.id} onRecord />}
      {sp.panel === "history" && (
        <HistoryPanel title={`History · ${f.name}`}>
          <HistoryList entries={history} />
        </HistoryPanel>
      )}
    </div>
  );
}

async function CostsTabLoader({ id, today }: { id: string; today: string }) {
  const costs = await api.get<ExpenseList>("/expenses", { factoryId: id }).catch(() => null);
  return costs ? <CostsTab costs={costs} today={today} /> : null;
}

/**
 * What needs someone today: overdue production steps, instalments due to the factory today or before, quote
 * requests past their reply date (or three days without one), and follow-ups due. Overdue first.
 */
function attention(p: FactoryPurchases, followUps: FollowUpList["rows"], today: string): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const o of p.orders) {
    if (o.status !== "open") continue;
    for (const s of o.lateSteps.slice(0, 1))
      rows.push({
        key: `s-${o.id}`,
        tone: "bad",
        title: `${o.refNo} · ${s.title} overdue`,
        sub: [s.dueOn ? `Was due ${day(s.dueOn, today)}` : null, o.readyOn ? `ready date ${day(o.readyOn, today)}` : null].filter(Boolean).join(" · "),
        href: `/orders/${o.id}/production`,
        action: (
          <ButtonLink href={`/orders/${o.id}/production`} size="sm" variant="ghost">
            Open
          </ButtonLink>
        ),
      });
    for (const x of o.open.filter((x) => x.due && x.due <= today))
      rows.push({
        key: `i-${o.id}-${x.label}`,
        tone: x.due! < today ? "bad" : "warn",
        title: `${x.label} ${money(x.open, x.currency)} ${x.due! < today ? "overdue" : "due today"}`,
        sub: `${o.refNo} · ${x.due! < today ? `due ${day(x.due, today)}` : "today"}`,
        href: `/orders/${o.id}/factory`,
        action: (
          <ButtonLink href={`/orders/${o.id}/factory`} size="sm" variant="secondary">
            Record payment
          </ButtonLink>
        ),
      });
  }
  for (const w of p.waiting) {
    const waited = daysBetween(w.sentOn, today);
    if (w.replyBy ? w.replyBy > today : waited < 3) continue;
    rows.push({
      key: `w-${w.id}`,
      tone: "warn",
      title: `Quote request ${w.inquiry.refNo} · no reply`,
      sub: `Asked ${day(w.sentOn, today)} · ${plural(waited, "day")}`,
      href: `/inquiries/${w.inquiry.id}/sourcing`,
      action: (
        <ButtonLink href={`/inquiries/${w.inquiry.id}/sourcing`} size="sm" variant="ghost">
          Open
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
  return rows.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1));
}
