import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Star } from "lucide-react";
import { can, CUSTOMER_TYPE_LABEL, UNKNOWN_COUNTRY, type OrderStatus } from "@kebo/shared";
import { Banner, ButtonLink, PageHeader, StageBadge, StatusBadge, type StatusMeaning } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { load, requireUser, hasFeature } from "@/lib/session";
import { date, money } from "@/lib/format";
import { countryName } from "@/lib/countries";
import type { CustomerDetail } from "@/lib/types-people";
import type { CustomerPayments } from "@/lib/types-money";
import type { HistoryEntry } from "@/lib/types";
import { HistoryList } from "@/components/common/history-list";
import { MoreMenu, RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";
import { AllLink, DetailsCard, RecordEmpty, RecordFrame, RecordListCard, RecordRow, RecordSection } from "@/components/common/record";
import { HistoryPanel, RecordLanding, RecordNav } from "@/components/common/record-nav";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { changeRows, compactChanges } from "@/components/orders/side-panel";
import { CustomerMoney } from "@/components/money/customer-money";
import { PerformanceCard } from "@/components/insights/performance";
import { removeCustomerAction, saveCustomerAction } from "../actions";
import { CustomerPanel } from "../customer-panel";
import { currenciesFrom, type SalesCurrencies } from "../currencies";

export const metadata = { title: "Customer" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Mar 2025" */
const monthOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: TZ });
const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, "")}`;
/** Rows a list card shows before "All n". */
const ROWS = 6;

/** Old ?tab= links → the section on the page (History opens in the side panel). */
const SECTION_OF: Record<string, string> = { inquiries: "inquiries", deals: "inquiries", orders: "orders", money: "money", payments: "money", account: "money" };

type PayOrder = CustomerPayments["orders"][number];

/**
 * A customer (design system: Record frame). Header: ← Customers, the name, a
 * status worked out from their orders' payments (Overdue · Owes money · Paid
 * up · No order yet), one summary line and the one primary — New inquiry —
 * with ⋯ for the rest (remove last, red). Main column: Performance (from
 * Insights), Details with ✎ Edit (the side panel), their orders and
 * inquiries, then their money; right panel: contacts and changes. No tabs:
 * old ?tab= links land on the section, ?tab=history opens All history.
 */
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (sp.tab === "history") redirect(`/customers/${id}?panel=history`);
  const me = await requireUser();
  const canEdit = can(me, "customers.manage");
  const canAsk = can(me, "inquiries.create");
  const editing = canEdit && sp.panel === "edit-customer";
  const [c, history, pay, managers, board, settings] = await Promise.all([
    load(() => api.get<CustomerDetail>(`/customers/${id}`)),
    api.get<HistoryEntry[]>("/history", { type: "customer", id }).catch(() => [] as HistoryEntry[]),
    api.get<CustomerPayments>("/payments", { customerId: id }).catch(() => null),
    can(me, "expenses.manage") ? hasFeature("expenses") : false,
    hasFeature("orders_board"),
    editing ? api.get<SalesCurrencies>("/settings") : null,
  ]);
  const moneyView = sp.view === "profit" || sp.tab === "account" ? "profit" : "payments";
  const openOrders = c.orders.filter((o) => o.status === "open").length;
  // Where each open order is in the flow (orders board module).
  const steps =
    openOrders && board
      ? new Map(
          ((await api.get<{ items: { id: string; current: { label: string; sub: string } | null }[] }>("/order-board").catch(() => null))?.items ?? []).map((i) => [
            i.id,
            i.current,
          ]),
        )
      : null;
  const openDeals = c.inquiries.filter((d) => ["new", "sourcing", "quoted"].includes(d.stage)).length;
  const won = c.inquiries.filter((d) => d.stage === "won").length;
  const lost = c.inquiries.filter((d) => d.stage === "lost").length;

  // Their status, from what they owe (word + colour).
  const today = todayIn(TZ);
  const paying = new Map((pay?.orders ?? []).map((o) => [o.id, o]));
  const owes = (o: PayOrder) => o.status !== "cancelled" && Number(o.due) > 0.005;
  const late = (o: PayOrder) => owes(o) && !!o.next?.dueOn && o.next.dueOn < today;
  const allPay = [...paying.values()];
  const status: { meaning: StatusMeaning; label: string } = allPay.some(late)
    ? { meaning: "bad", label: "Overdue" }
    : allPay.some(owes)
      ? { meaning: "info", label: "Owes money" }
      : c.orders.some((o) => o.status !== "cancelled")
        ? { meaning: "ok", label: "Paid up" }
        : { meaning: "neutral", label: c.inquiries.length ? "No order yet" : "New" };

  const primary = c.contacts.find((p) => p.isPrimary) ?? c.contacts[0] ?? null;
  const handledBy = c.inquiries.find((d) => d.assignee)?.assignee?.name;
  const countryKnown = c.country !== UNKNOWN_COUNTRY;
  const changes = compactChanges(history);

  const ORDER_STATUS: Record<OrderStatus, { label: string; meaning: StatusMeaning }> = {
    open: { label: "In progress", meaning: "info" },
    closed: { label: "Done", meaning: "ok" },
    cancelled: { label: "Cancelled", meaning: "neutral" },
  };
  const orderStatus = (o: CustomerDetail["orders"][number]) => {
    const p = paying.get(o.id);
    return o.status === "open" && p && late(p) ? { label: "Payment late", meaning: "bad" as const } : ORDER_STATUS[o.status];
  };
  const orderLine = (o: CustomerDetail["orders"][number]) => {
    const p = paying.get(o.id);
    const cur = o.status === "open" ? steps?.get(o.id) : undefined;
    const where = cur ? cur.label : o.status === "open" && steps ? "every step done" : null;
    const due = p && owes(p) ? `${money(p.due, p.currency)} due` : null;
    return [`ordered ${date(o.orderedOn)}`, where, due].filter(Boolean).join(" · ");
  };
  const orderMenu = (o: CustomerDetail["orders"][number]): MenuEntry[] => [
    { label: "Open", href: `/orders/${o.id}` },
    { label: "Payments", href: `/orders/${o.id}/payment` },
    { label: "Copy link", copy: `/orders/${o.id}` },
  ];
  const inquiryMenu = (d: CustomerDetail["inquiries"][number]): MenuEntry[] => [
    { label: "Open", href: `/inquiries/${d.id}` },
    { label: "Copy link", copy: `/inquiries/${d.id}` },
  ];

  const more: MenuEntry[] = [
    { label: "Their inquiries", href: `/inquiries?customer=${c.id}&stage=all` },
    { label: "Copy link", copy: `/customers/${c.id}` },
    ...(can(me, "customers.delete")
      ? [
          { separator: true as const },
          {
            label: "Remove…",
            danger: true as const,
            confirm: {
              title: `Remove ${c.name}?`,
              body: "They stay on past inquiries and orders, but no longer appear in lists and pickers. Not possible while an order is open.",
              confirmLabel: "Remove",
            },
            action: removeCustomerAction.bind(null, c.id),
          },
        ]
      : []),
  ];

  const newInquiry = `/inquiries/new?customer=${c.id}`;
  const section = sp.tab ? SECTION_OF[sp.tab] : undefined;

  return (
    <div>
      <PageHeader
        backHref="/customers"
        backLabel="Customers"
        phoneStack
        title={c.name}
        badge={<StatusBadge meaning={status.meaning}>{status.label}</StatusBadge>}
        summary={
          <>
            {countryKnown ? countryName(c.country) : <span className="text-warn">Country not set</span>}
            {c.type === "individual" && ` · ${CUSTOMER_TYPE_LABEL.individual.toLowerCase()}`}
            {` · customer since ${monthOf(c.createdAt)}`}
            {handledBy && <span className="max-sm:hidden"> · handled by {handledBy}</span>}
          </>
        }
        primary={
          canAsk && (
            <ButtonLink href={newInquiry} variant="primary">
              <Plus aria-hidden /> New inquiry
            </ButtonLink>
          )
        }
        more={<MoreMenu items={more} label={`More for ${c.name}`} />}
      />
      <RecordLanding section={section} />

      <RecordFrame
        sideLabel="Contacts and changes"
        nav={
          <RecordNav
            label="Customer sections"
            items={[
              { id: "overview", label: "Overview" },
              { id: "orders", label: "Orders", count: c.orders.length },
              { id: "inquiries", label: "Inquiries", count: c.inquiries.length },
              { id: "money", label: "Money" },
              { id: "contacts", label: "Contacts", count: c.contacts.length },
              { id: "changes", label: "Changes", count: changes.length },
            ]}
          />
        }
        main={
          <>
            <RecordSection id="overview" className="flex flex-col gap-5">
              <PerformanceCard kind="customer" id={c.id} me={me} />
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
                  { label: "Type", value: CUSTOMER_TYPE_LABEL[c.type] },
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
            </RecordSection>

            <RecordSection id="orders">
              <RecordListCard
                title="Orders"
                count={c.orders.length}
                description={c.orders.length ? `${plural(openOrders, "open order")} · newest first` : undefined}
                action={c.orders.length > ROWS && <AllLink href={`/orders?status=all&q=${encodeURIComponent(c.name)}`}>All {c.orders.length}</AllLink>}
                empty={<RecordEmpty title="No orders yet">An order appears here when this customer accepts a quotation.</RecordEmpty>}
              >
                {c.orders.slice(0, ROWS).map((o) => {
                  const s = orderStatus(o);
                  return (
                    <RecordRow
                      key={o.id}
                      href={`/orders/${o.id}`}
                      title={o.refNo}
                      sub={orderLine(o)}
                      status={<StatusBadge meaning={s.meaning}>{s.label}</StatusBadge>}
                      figure={money(o.total, o.currency)}
                      menu={<RowMenu items={orderMenu(o)} label={`Actions for ${o.refNo}`} />}
                    />
                  );
                })}
              </RecordListCard>
            </RecordSection>

            <RecordSection id="inquiries">
              <RecordListCard
                title="Inquiries"
                count={c.inquiries.length}
                description={
                  c.inquiries.length
                    ? `${openDeals} open · ${won} won · ${lost} lost${can(me, "inquiries.viewAll") ? "" : " · the ones you handle or created"}`
                    : undefined
                }
                action={
                  <>
                    {c.inquiries.length > ROWS && <AllLink href={`/inquiries?customer=${c.id}&stage=all`}>All {c.inquiries.length}</AllLink>}
                    {canAsk && (
                      <Link href={newInquiry} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-text-2 hover:bg-surface-2 hover:text-text">
                        <Plus aria-hidden className="size-3.5" /> New inquiry
                      </Link>
                    )}
                  </>
                }
                empty={
                  <RecordEmpty
                    title="No inquiries yet"
                    action={
                      canAsk && (
                        <ButtonLink href={newInquiry} size="sm">
                          <Plus aria-hidden /> Add their first inquiry
                        </ButtonLink>
                      )
                    }
                  >
                    Every request for prices from this customer shows here, with its stage.
                  </RecordEmpty>
                }
              >
                {c.inquiries.slice(0, ROWS).map((d) => (
                  <RecordRow
                    key={d.id}
                    href={`/inquiries/${d.id}`}
                    title={d.refNo}
                    sub={[d.title, d.assignee?.name ?? "nobody handles it yet"].filter(Boolean).join(" · ")}
                    status={<StageBadge stage={d.stage} onHold={d.onHold} />}
                    figure={<span className="text-xs text-text-2">{date(d.createdAt)}</span>}
                    menu={<RowMenu items={inquiryMenu(d)} label={`Actions for ${d.refNo}`} />}
                  />
                ))}
              </RecordListCard>
            </RecordSection>

            <RecordSection id="money" className="flex flex-col gap-3">
              <h2 className="text-[15px] font-semibold">
                Money <span className="text-xs font-normal text-muted">· what they paid and still owe{managers ? ", and what they earned us" : ""}</span>
              </h2>
              <CustomerMoney customerId={c.id} customerName={c.name} view={moneyView} managers={managers} />
            </RecordSection>
          </>
        }
        side={
          <SidePanelCard label="Contacts and changes">
            <div id="contacts" className="scroll-mt-32">
              <SideSection
                title="Contacts"
                count={c.contacts.length}
                action={
                  canEdit && (
                    <OpenPanelButton panel="edit-customer" id={c.id} variant="ghost" size="sm" label="Add or change contacts">
                      <Plus aria-hidden /> Add
                    </OpenPanelButton>
                  )
                }
                empty="No contacts yet. Add at least one person you can reach."
              >
                {c.contacts.map((p) => (
                  <li key={p.id} className="border-b border-line py-2 last:border-b-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {p.name}
                      {p.isPrimary && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary">
                          <Star aria-hidden className="size-3 fill-current" /> Primary
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-text-2 [overflow-wrap:anywhere]">
                      {[p.position, p.email, p.phone, p.whatsapp && p.whatsapp !== p.phone ? `WhatsApp ${p.whatsapp}` : null, p.wechat ? `WeChat ${p.wechat}` : null]
                        .filter(Boolean)
                        .join(" · ") || "No way to reach them yet"}
                    </span>
                  </li>
                ))}
              </SideSection>
            </div>
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

      {editing && settings && (
        <CustomerPanel action={saveCustomerAction.bind(null, c.id)} customer={c} currencies={currenciesFrom(settings)} onRecord />
      )}
      {sp.panel === "history" && (
        <HistoryPanel title={`History · ${c.name}`}>
          <HistoryList entries={history} />
        </HistoryPanel>
      )}
    </div>
  );
}
