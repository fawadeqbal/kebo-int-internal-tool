import { redirect } from "next/navigation";
import { can, EXPENSE_CATEGORY_LABEL } from "@kebo/shared";
import { ButtonLink, Card, PageHeader, StatusBadge, type StatusMeaning } from "@kebo/ui";
import { BookOpen, Search } from "lucide-react";
import { api } from "@/lib/api";
import { load, requirePermission, hasFeature } from "@/lib/session";
import { date, money, plural } from "@/lib/format";
import type { ExpenseList } from "@/lib/types-money";
import type { FactoryDetail } from "@/lib/types-people";
import type { HistoryEntry, Person } from "@/lib/types";
import type { FollowUpList, Note } from "@/lib/types-notes";
import { FollowUpsCard, NotesCard } from "@/components/notes/cards";
import { HistoryList } from "@/components/common/history-list";
import { MoreMenu, RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";
import { AllLink, DetailsCard, FigureTiles, RecordEmpty, RecordFrame, RecordListCard, RecordRow, RecordSection } from "@/components/common/record";
import { HistoryPanel, RecordLanding, RecordNav } from "@/components/common/record-nav";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { changeRows, compactChanges } from "@/components/orders/side-panel";
import { PerformanceCard } from "@/components/insights/performance";
import { removeFactoryAction, saveFactoryAction } from "../actions";
import { FactoryPanel } from "../factory-form";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Factory" };

/** Offers a card shows before "Show all". */
const ROWS = 8;

/** Old ?tab= links → the section on the page (History opens in the side panel). */
const SECTION_OF: Record<string, string> = { prices: "offers", costs: "costs", details: "overview" };

/**
 * A factory (design system: Record frame). Header: ← Factories, the name, a
 * status from what it makes for us (Late · Making for us · No open order),
 * one summary line and the one primary — Ask for prices (the inquiries
 * waiting for factory prices) — with ⋯ for the rest (remove last, red). Main
 * column: Performance (Insights), how it answers and delivers,
 * Details with ✎ Edit (side panel), the orders it is making, its price
 * offers and (managers) visits and costs; right panel: changes. No tabs: old
 * ?tab= links land on the section, ?tab=history opens All history.
 */
export default async function FactoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (sp.tab === "history") redirect(`/factories/${id}?panel=history`);
  const me = await requirePermission("sourcing.manage");
  const editing = sp.panel === "edit-factory";
  const [f, history, managers, people, notes, followUps] = await Promise.all([
    load(() => api.get<FactoryDetail>(`/factories/${id}`)),
    api.get<HistoryEntry[]>("/history", { type: "factory", id }).catch(() => [] as HistoryEntry[]),
    can(me, "expenses.manage") ? hasFeature("expenses") : false,
    getPeople().catch(() => [] as Person[]),
    api.get<Note[]>(`/factories/${id}/notes`).catch(() => [] as Note[]),
    api.get<FollowUpList>("/follow-ups", { factoryId: id }).catch(() => null),
  ]);
  const costs = managers ? await api.get<ExpenseList>("/expenses", { factoryId: id }).catch(() => null) : null;
  const canRemove = can(me, "inquiries.updateAny");
  const r = f.record;
  const changes = compactChanges(history);

  const status: { meaning: StatusMeaning; label: string } = r.lateSteps
    ? { meaning: "bad", label: "Late" }
    : r.openOrders.length
      ? { meaning: "info", label: "Making for us" }
      : { meaning: "neutral", label: f.quotes.length ? "No open order" : "Not quoted yet" };

  const ledger = can(me, "ledger.view") ? `/finance/ledger/factories/${f.id}` : null;
  const more: MenuEntry[] = [
    ...(ledger ? [{ label: "Ledger and statement", href: ledger }] : []),
    { label: "Copy link", copy: `/factories/${f.id}` },
    ...(canRemove
      ? [
          { separator: true as const },
          {
            label: "Remove…",
            danger: true as const,
            confirm: { title: `Remove ${f.name}?`, body: "It will no longer appear in lists and pickers. Its past prices stay on their inquiries.", confirmLabel: "Remove" },
            action: removeFactoryAction.bind(null, f.id),
          },
        ]
      : []),
  ];
  const allOffers = sp.offers === "all";
  const offers = allOffers ? f.quotes : f.quotes.slice(0, ROWS);
  const section = sp.tab ? SECTION_OF[sp.tab] : allOffers ? "offers" : undefined;
  const answered = r.asked ? Math.round((r.answered / r.asked) * 100) : null;

  return (
    <div>
      <PageHeader
        backHref="/factories"
        backLabel="Factories"
        phoneStack
        title={f.name}
        badge={<StatusBadge meaning={status.meaning}>{status.label}</StatusBadge>}
        summary={[
          f.owner ? `looked after by ${f.owner.name}` : "nobody looks after it yet",
          f.contactPerson,
          plural(f.quotes.length, "price offer"),
        ]
          .filter(Boolean)
          .join(" · ")
          .replace(/^./, (x) => x.toUpperCase())}
        papers={
          ledger && (
            <ButtonLink href={ledger} variant="secondary">
              <BookOpen aria-hidden /> Ledger
            </ButtonLink>
          )
        }
        primary={
          <ButtonLink href="/inquiries?stage=sourcing" variant="primary" title="Inquiries waiting for factory prices: open one to ask this factory">
            <Search aria-hidden /> Ask for prices
          </ButtonLink>
        }
        more={<MoreMenu items={more} label={`More for ${f.name}`} />}
      />
      <RecordLanding section={section} />

      <RecordFrame
        sideLabel="Changes"
        nav={
          <RecordNav
            label="Factory sections"
            items={[
              { id: "overview", label: "Overview" },
              { id: "making", label: "Making", count: r.openOrders.length },
              { id: "offers", label: "Price offers", count: f.quotes.length },
              { id: "notes", label: "Notes", count: notes.length },
              ...(costs ? [{ id: "costs", label: "Costs", count: costs.rows.length }] : []),
              { id: "changes", label: "Changes", count: changes.length },
            ]}
          />
        }
        main={
          <>
            <RecordSection id="overview" className="flex flex-col gap-5">
              <PerformanceCard kind="factory" id={f.id} me={me} />
              {(r.asked > 0 || r.openOrders.length > 0) && (
                <Card>
                  <div className="border-b border-line px-4 py-3">
                    <h2 className="text-[15px] font-semibold">How it works with us</h2>
                    <p className="mt-0.5 text-xs text-muted">When we ask for prices, and what it is making for us now</p>
                  </div>
                  <FigureTiles
                    items={[
                      {
                        label: "Answers when asked",
                        value: answered === null ? "—" : `${answered}%`,
                        sub: r.asked ? `${r.answered} of ${r.asked} asked${r.declined ? ` · ${r.declined} declined` : ""}` : "not asked yet",
                        tone: answered !== null && answered < 50 ? "bad" : undefined,
                      },
                      { label: "Days to answer", value: r.avgDaysToAnswer ?? "—", sub: "on average, asked → offer" },
                      {
                        label: "Making for us now",
                        value: r.openOrders.length,
                        sub: r.lateSteps ? `${plural(r.lateSteps, "production step")} late` : "open orders",
                        tone: r.lateSteps ? "bad" : undefined,
                      },
                      { label: "Price offers", value: f.quotes.length, sub: f.quotes[0] ? `last ${date(f.quotes[0].receivedOn)}` : "none yet" },
                    ]}
                  />
                </Card>
              )}
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
            </RecordSection>

            <RecordSection id="making">
              <RecordListCard
                title="Orders it is making"
                count={r.openOrders.length}
                description={r.openOrders.length ? "Open orders with lines from this factory" : undefined}
                empty={<RecordEmpty title="Nothing in production here">An order shows here while it has lines from this factory, with the day it should be ready.</RecordEmpty>}
              >
                {r.openOrders.map((o) => (
                  <RecordRow
                    key={o.id}
                    href={`/orders/${o.id}/factory`}
                    title={o.refNo}
                    sub={o.customer}
                    figure={<span className="text-xs text-text-2">{o.readyOn ? `ready ${date(o.readyOn)}` : "no ready date"}</span>}
                    menu={
                      <RowMenu
                        label={`Actions for ${o.refNo}`}
                        items={[
                          { label: "Open", href: `/orders/${o.id}/factory` },
                          { label: "Production", href: `/orders/${o.id}/production` },
                          { label: "Copy link", copy: `/orders/${o.id}` },
                        ]}
                      />
                    }
                  />
                ))}
              </RecordListCard>
            </RecordSection>

            <RecordSection id="notes-and-follow-ups" className="grid items-start gap-5 xl:grid-cols-2">
              <NotesCard on={{ key: "factoryId", id: f.id }} notes={notes} canAdd />
              <FollowUpsCard on={{ key: "factoryId", id: f.id }} label={f.name} rows={followUps?.rows ?? []} people={people} meId={me.id} />
            </RecordSection>

            <RecordSection id="offers">
              <RecordListCard
                title="Price offers"
                count={f.quotes.length}
                description={f.quotes.length ? "Prices it gave on our inquiries, newest first" : undefined}
                action={f.quotes.length > ROWS && !allOffers && <AllLink href={`/factories/${f.id}?offers=all`}>All {f.quotes.length}</AllLink>}
                empty={
                  <RecordEmpty
                    title="No prices yet"
                    action={
                      <ButtonLink href="/inquiries?stage=sourcing" size="sm">
                        Inquiries waiting for prices
                      </ButtonLink>
                    }
                  >
                    Prices are recorded on an inquiry, under Factory prices. Open an inquiry that needs prices and ask this factory.
                  </RecordEmpty>
                }
              >
                {offers.map((q) => (
                  <RecordRow
                    key={q.id}
                    href={`/inquiries/${q.inquiry.id}/sourcing`}
                    title={q.inquiry.refNo}
                    sub={q.inquiry.title}
                    figure={
                      <span className="text-xs text-text-2">
                        {plural(q._count.lines, "line")} · {q.currency} · {date(q.receivedOn)}
                      </span>
                    }
                    menu={
                      <RowMenu
                        label={`Actions for ${q.inquiry.refNo}`}
                        items={[
                          { label: "Open the prices", href: `/inquiries/${q.inquiry.id}/sourcing` },
                          { label: "Open the inquiry", href: `/inquiries/${q.inquiry.id}` },
                          { label: "Copy link", copy: `/inquiries/${q.inquiry.id}/sourcing` },
                        ]}
                      />
                    }
                  />
                ))}
              </RecordListCard>
            </RecordSection>

            {costs && (
              <RecordSection id="costs">
                <RecordListCard
                  title="Visits and costs"
                  count={costs.rows.length}
                  description={`Managers only · expenses that name this factory: trips, inspections${costs.rows.length ? ` · ${money(costs.total, costs.currency)} in all` : ""}`}
                  empty={<RecordEmpty title="Nothing spent here yet">When adding an expense, choose this factory under Factory visited, and it shows here.</RecordEmpty>}
                >
                  {costs.rows.map((e) => (
                    <RecordRow
                      key={e.id}
                      href={e.deal ? `/inquiries/${e.deal.id}` : e.order ? `/orders/${e.order.id}/payment` : undefined}
                      muted={!!e.voided}
                      title={<span className={e.voided ? "line-through" : undefined}>{e.description}</span>}
                      sub={[EXPENSE_CATEGORY_LABEL[e.category], date(e.spentOn), e.deal?.refNo ?? e.order?.refNo, e.customer?.name].filter(Boolean).join(" · ")}
                      figure={money(e.amount, e.currency)}
                    />
                  ))}
                </RecordListCard>
              </RecordSection>
            )}
          </>
        }
        side={
          <SidePanelCard>
            <div id="changes" className="scroll-mt-32">
              <SideSection
                title="Changes"
                count={changes.length}
                dense
                action={
                  history.length > 0 && (
                    <OpenPanelButton panel="history" variant="ghost" size="sm">
                      All history
                    </OpenPanelButton>
                  )
                }
                empty="Nothing changed yet."
              >
                {changeRows(changes)}
              </SideSection>
            </div>
          </SidePanelCard>
        }
      />

      {editing && <FactoryPanel action={saveFactoryAction.bind(null, f.id)} factory={f} people={people} meId={me.id} onRecord />}
      {sp.panel === "history" && (
        <HistoryPanel title={`History · ${f.name}`}>
          <HistoryList entries={history} />
        </HistoryPanel>
      )}
    </div>
  );
}
