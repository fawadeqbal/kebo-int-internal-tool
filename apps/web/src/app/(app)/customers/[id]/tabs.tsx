import Link from "next/link";
import { Plus, Star } from "lucide-react";
import { CUSTOMER_TYPE_LABEL, INQUIRY_STAGE_LABEL, PAYMENT_METHOD_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { ButtonLink, Card, cn, OrderStageBadge, StageBadge, StatusBadge } from "@kebo/ui";
import { InfoTip } from "@kebo/ui/client";
import { money } from "@/lib/format";
import { countryName } from "@/lib/countries";
import type { CustomerDetail } from "@/lib/types-people";
import type { CustomerAccount, CustomerPayments } from "@/lib/types-money";
import type { LedgerParty } from "@/lib/types-ledger";
import type { OrderGroupRow } from "@/lib/types-facts";
import { OpenPanelButton } from "@/components/common/panel";
import { ExportLink } from "@/components/sheets/export-link";
import { ApplyCreditButton, RecordPaymentButton } from "@/components/money/customer-money";
import { StatementButton } from "@/components/party/party-client";
import { AllTab, ChipRow, EditButton, EmptyLine, Facts, ListRow, PartyCard, TotalsLine } from "@/components/party/parts";
import { byCurrency, day, daysBetween, plural, sumText } from "@/components/party/format";

type Order = CustomerDetail["orders"][number];
type PayOrder = CustomerPayments["orders"][number];

const th = "px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-text-2";
const td = "px-3 py-3 whitespace-nowrap";

/** Open sales orders on Overview: five, then All N →. */
export function OpenOrdersCard({ base, orders, pay, today }: { base: string; orders: Order[]; pay: Map<string, PayOrder>; today: string }) {
  const open = orders.filter((o) => o.status === "open");
  if (!open.length) return null;
  return (
    <PartyCard title="Open sales orders" count={open.length} action={<AllTab href={`${base}?tab=orders`} count={orders.length} />}>
      <ul className="divide-y divide-line">
        {open.slice(0, 5).map((o) => {
          const p = pay.get(o.id);
          const due = p && Number(p.due) > 0.005 ? `balance due ${money(p.due, p.currency)}` : null;
          const sub = [o.readyOn && o.stage !== "shipped" && o.stage !== "done" ? `Ready ${day(o.readyOn, today)}` : `Ordered ${day(o.orderedOn, today)}`, due ?? money(o.total, o.currency)].join(" · ");
          return <ListRow key={o.id} href={`/orders/${o.id}`} title={o.refNo} sub={sub} badge={<OrderStageBadge stage={o.stage} />} />;
        })}
      </ul>
    </PartyCard>
  );
}

const OPEN_STAGES = ["new", "sourcing", "quoted"];

/** Open inquiries on Overview: five, then All N →. */
export function OpenInquiriesCard({ base, inquiries }: { base: string; inquiries: CustomerDetail["inquiries"] }) {
  const open = inquiries.filter((d) => OPEN_STAGES.includes(d.stage));
  if (!open.length) return null;
  return (
    <PartyCard title="Open inquiries" count={open.length} action={<AllTab href={`${base}?tab=inquiries`} count={inquiries.length} />}>
      <ul className="divide-y divide-line">
        {open.slice(0, 5).map((d) => (
          <ListRow key={d.id} href={`/inquiries/${d.id}`} title={d.refNo} sub={[d.title, d.assignee?.name].filter(Boolean).join(" · ")} badge={<StageBadge stage={d.stage} onHold={d.onHold} />} />
        ))}
      </ul>
    </PartyCard>
  );
}

/* ---------------------------------------------------------------- Sales orders */

const ORDER_FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "open", label: "Open", test: (o: Order) => o.status === "open" },
  { key: "done", label: "Done", test: (o: Order) => o.status === "closed" },
  { key: "cancelled", label: "Cancelled", test: (o: Order) => o.status === "cancelled" },
] as const;

export function SalesOrdersTab({
  c,
  base,
  filter,
  pay,
  profit,
  today,
  newInquiry,
}: {
  c: CustomerDetail;
  base: string;
  filter?: string;
  pay: Map<string, PayOrder>;
  /** Managers: each sales order's gross profit (main currency). */
  profit: { currency: string; byOrder: Map<string, string> } | null;
  today: string;
  newInquiry: string | null;
}) {
  if (!c.orders.length)
    return (
      <Card>
        <EmptyLine
          action={
            newInquiry && (
              <ButtonLink href={newInquiry} size="sm" variant="primary">
                <Plus aria-hidden /> New inquiry
              </ButtonLink>
            )
          }
        >
          No sales orders yet.
        </EmptyLine>
      </Card>
    );
  const f = ORDER_FILTERS.find((x) => x.key === filter) ?? ORDER_FILTERS[0];
  const rows = c.orders.filter(f.test);
  const currencies = [...new Set(c.orders.map((o) => o.currency))];
  const one = currencies.length === 1 ? currencies[0]! : null;
  const amount = (v: string | null | undefined, cur: string) => (v === null || v === undefined ? "—" : one ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : money(v, cur));
  const live = rows.filter((o) => o.status !== "cancelled");
  const totals = (k: "total" | "received" | "due") => byCurrency(live, (o) => o.currency, (o) => (k === "total" ? o.total : (pay.get(o.id)?.[k] ?? (k === "due" ? o.total : "0"))));
  return (
    <>
      <ChipRow
        chips={ORDER_FILTERS.map((x) => ({ href: x.key === "all" ? `${base}?tab=orders` : `${base}?tab=orders&f=${x.key}`, label: x.label, count: c.orders.filter(x.test).length, active: x.key === f.key })).filter(
          (x) => x.count > 0 || x.active || x.label !== "Cancelled",
        )}
        end={<ExportLink what="orders" query={{ status: "all", q: c.name }} label="Export" className="border-transparent bg-transparent shadow-none" />}
      />
      <Card className="overflow-clip">
        {rows.length === 0 ? (
          <EmptyLine>Nothing matches these filters.</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={th}>
                    Sales order
                  </th>
                  <th scope="col" className={cn(th, "max-md:hidden")}>
                    Date
                  </th>
                  <th scope="col" className={th}>
                    Stage
                  </th>
                  <th scope="col" className={cn(th, "max-lg:hidden")}>
                    Ready date
                  </th>
                  <th scope="col" className={cn(th, "text-right max-sm:hidden")}>
                    Total{one && ` (${one})`}
                  </th>
                  <th scope="col" className={cn(th, "text-right max-md:hidden")}>
                    Received
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Balance due
                  </th>
                  {profit && (
                    <th scope="col" className={cn(th, "text-right max-sm:hidden")}>
                      <span className="inline-flex items-center gap-1">
                        Gross profit ({profit.currency})
                        <InfoTip label="About gross profit" align="end">
                          Quoted profit, less unplanned costs and bank charges.
                        </InfoTip>
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const p = pay.get(o.id);
                  const late = p && Number(p.overdue) > 0.005;
                  const gp = profit?.byOrder.get(o.id);
                  return (
                    <tr key={o.id} className={cn("relative border-b border-line last:border-b-0 hover:bg-primary-soft/40", o.status === "cancelled" && "text-muted")}>
                      <td className={td}>
                        <Link href={`/orders/${o.id}`} className="font-semibold tabular after:absolute after:inset-0 hover:text-primary">
                          {o.refNo}
                        </Link>
                      </td>
                      <td className={cn(td, "max-md:hidden")}>{day(o.orderedOn, today)}</td>
                      <td className={td}>{o.status === "cancelled" ? <StatusBadge meaning="neutral">Cancelled</StatusBadge> : <OrderStageBadge stage={o.stage} />}</td>
                      <td className={cn(td, "max-lg:hidden")}>{o.readyOn ? day(o.readyOn, today) : "—"}</td>
                      <td className={cn(td, "text-right tabular max-sm:hidden")}>{amount(p?.total ?? o.total, o.currency)}</td>
                      <td className={cn(td, "text-right tabular max-md:hidden")}>{amount(p?.received, o.currency)}</td>
                      <td className={cn(td, "text-right tabular", late && "font-semibold text-bad")}>
                        {o.status === "cancelled" ? "—" : amount(p?.due, o.currency)}
                        {late && <span className="sr-only"> (overdue)</span>}
                      </td>
                      {profit && <td className={cn(td, "text-right tabular max-sm:hidden", gp && Number(gp) < 0 && "text-bad")}>{gp ? Math.round(Number(gp)).toLocaleString("en-US") : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {live.length > 0 && (
        <TotalsLine
          items={[
            [
              { label: "Total", value: sumText(totals("total"), "—") },
              { label: "Received", value: sumText(totals("received"), "—") },
              { label: "Balance due", value: sumText(totals("due"), "—") },
            ],
          ]}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Inquiries */

const INQUIRY_FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "open", label: "Open", test: (d: CustomerDetail["inquiries"][number]) => OPEN_STAGES.includes(d.stage) },
  { key: "won", label: INQUIRY_STAGE_LABEL.won, test: (d: CustomerDetail["inquiries"][number]) => d.stage === "won" },
  { key: "lost", label: INQUIRY_STAGE_LABEL.lost, test: (d: CustomerDetail["inquiries"][number]) => d.stage === "lost" },
] as const;

export function InquiriesTab({ c, base, filter, today, newInquiry }: { c: CustomerDetail; base: string; filter?: string; today: string; newInquiry: string | null }) {
  const add = newInquiry && (
    <ButtonLink href={newInquiry} size="sm" variant="secondary">
      <Plus aria-hidden /> New inquiry
    </ButtonLink>
  );
  if (!c.inquiries.length)
    return (
      <Card>
        <EmptyLine action={add}>No inquiries yet.</EmptyLine>
      </Card>
    );
  const f = INQUIRY_FILTERS.find((x) => x.key === filter) ?? INQUIRY_FILTERS[0];
  const rows = c.inquiries.filter(f.test);
  return (
    <>
      <ChipRow
        chips={INQUIRY_FILTERS.map((x) => ({ href: x.key === "all" ? `${base}?tab=inquiries` : `${base}?tab=inquiries&f=${x.key}`, label: x.label, count: c.inquiries.filter(x.test).length, active: x.key === f.key }))}
        end={add}
      />
      <Card className="overflow-clip">
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((d) => (
              <ListRow
                key={d.id}
                href={`/inquiries/${d.id}`}
                title={d.refNo}
                sub={[d.title, d.assignee?.name, day(d.createdAt.slice(0, 10), today)].filter(Boolean).join(" · ")}
                badge={<StageBadge stage={d.stage} onHold={d.onHold} />}
              />
            ))}
          </ul>
        ) : (
          <EmptyLine>Nothing matches these filters.</EmptyLine>
        )}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- Payments */

/** Not due · 1–30 · 31–60 · over 60 days, from the ledger's ageing (61–90 and 90+ together). */
function ageTiles(ledger: LedgerParty | null, pay: CustomerPayments, today: string) {
  if (ledger) {
    const b = new Map(ledger.ageing.buckets.map((x) => [x.bucket, x]));
    const pick = (...keys: string[]) => {
      const items = keys.flatMap((k) => b.get(k as never)?.items ?? []);
      return { amount: keys.reduce((t, k) => t + Number(b.get(k as never)?.base ?? 0), 0), refs: [...new Set(items.map((i) => i.refNo).filter(Boolean))] as string[] };
    };
    return { currency: ledger.mainCurrency, tiles: [pick("not_due"), pick("d1_30"), pick("d31_60"), pick("d61_90", "d90_plus")] };
  }
  // No ledger for this person: the same buckets from each sales order's overdue instalments.
  const one = pay.totals.length === 1 ? pay.totals[0]!.currency : null;
  if (!one) return null;
  const tiles = [0, 1, 2, 3].map(() => ({ amount: 0, refs: [] as string[] }));
  for (const o of pay.orders) {
    if (o.status === "cancelled" || Number(o.due) <= 0.005) continue;
    const over = Number(o.overdue);
    const late = o.overdueSince ? daysBetween(o.overdueSince, today) : 0;
    const k = !over ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : 3;
    if (Number(o.due) - over > 0.005) tiles[0]!.amount += Number(o.due) - over;
    if (over) tiles[k]!.amount += over;
    tiles[k]!.refs.push(o.refNo);
  }
  return { currency: one, tiles };
}

const AGE_LABEL = ["Not due", "1–30 days", "31–60 days", "Over 60 days"];

export async function PaymentsTab({
  c,
  pay,
  ledger,
  habit,
  today,
  statement,
}: {
  c: CustomerDetail;
  pay: CustomerPayments;
  ledger: LedgerParty | null;
  habit: OrderGroupRow | null;
  today: string;
  statement: boolean;
}) {
  const age = ageTiles(ledger, pay, today);
  const credit = pay.credit.balances.filter((b) => Number(b.amount) > 0);
  const lastIn = pay.credit.entries.find((e) => e.kind === "in" && !e.voided);
  const live = pay.payments.filter((p) => !p.voided);
  const last = live[0];
  const shown = pay.payments;
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="ageing-title">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ageing-title" className="flex items-center gap-1 text-[15px] font-semibold">
            Receivables by age
            <InfoTip label="About receivables by age">What they owe in {age?.currency ?? c.defaultCurrency}, by days past each due date.</InfoTip>
          </h2>
          {statement && <StatementButton kind="customer" id={c.id} from={`${today.slice(0, 4)}-01-01`} to={today} back={`/customers/${c.id}?tab=payments`} label="Statement of account" variant="secondary" />}
        </div>
        {age ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {age.tiles.map((t, i) => (
              <div key={AGE_LABEL[i]} className="min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
                <p className="text-xs font-medium text-text-2">{AGE_LABEL[i]}</p>
                <p className={cn("mt-1 truncate text-lg font-bold tabular sm:text-[22px] sm:leading-7", i > 0 && t.amount > 0.005 && "text-bad")}>{money(t.amount, age.currency)}</p>
                <p className="mt-0.5 truncate text-xs text-text-2">{t.refs.length ? (i === 0 ? plural(t.refs.length, "sales order") : t.refs.slice(0, 2).join(", ") + (t.refs.length > 2 ? ` +${t.refs.length - 2}` : "")) : " "}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-2">{sumText(byCurrency(pay.totals, (t) => t.currency, (t) => t.due), "Nothing owed.")}</p>
        )}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <PartyCard title="Advance / credit" help="Customer money we hold. Offered when their next sales order needs a deposit.">
          <Facts
            items={[
              {
                label: "Held",
                value: (
                  <>
                    <span className="font-semibold tabular">{credit.length ? credit.map((b) => money(b.amount, b.currency)).join(" + ") : money(0, c.defaultCurrency)}</span>
                    {lastIn && credit.length > 0 && <span className="text-text-2"> · {lastIn.order ? `from ${lastIn.order.refNo}` : (lastIn.note ?? "")} · since {day(lastIn.on, today)}</span>}
                  </>
                ),
              },
            ]}
          />
          {(credit.length > 0 || pay.credit.entries.length > 0) && (
            <div className="px-4 pb-3.5">
              <ApplyCreditButton customerId={c.id} customerName={c.name} pay={pay} />
            </div>
          )}
        </PartyCard>
        <PartyCard title="Paying habit">
          <Facts
            items={[
              ...(habit
                ? [
                    { label: "Days to pay", value: habit.daysToPay === null ? null : `${Math.round(habit.daysToPay)} on average` },
                    { label: "Paid on time", value: habit.paid.inFull ? `${habit.paid.onTime} of ${plural(habit.paid.inFull, "sales order")}` : null },
                  ]
                : []),
              { label: "Last payment", value: last ? `${day(last.paidOn, today)} · ${money(last.amount, last.currency)}` : null },
            ]}
          />
        </PartyCard>
      </div>

      <PartyCard title="Payments received" count={live.length} action={<RecordPaymentButton customerId={c.id} customerName={c.name} pay={pay} />}>
        {shown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60">
                  <th scope="col" className={th}>
                    Date
                  </th>
                  <th scope="col" className={cn(th, "max-sm:hidden")}>
                    Reference
                  </th>
                  <th scope="col" className={th}>
                    Sales order
                  </th>
                  <th scope="col" className={cn(th, "max-md:hidden")}>
                    Payment method
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Amount
                  </th>
                  <th scope="col" className={cn(th, "text-right max-md:hidden")}>
                    <span className="inline-flex items-center gap-1">
                      Bank charges <InfoTip label="About bank charges">Kept by the banks; still counts as paid by the customer.</InfoTip>
                    </span>
                  </th>
                  <th scope="col" className={cn(th, "max-lg:hidden")}>
                    Attachment
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={cn("border-b border-line last:border-b-0", p.voided && "text-muted line-through")}>
                    <td className={td}>{day(p.paidOn, today)}</td>
                    <td className={cn(td, "max-sm:hidden")}>{p.reference ?? "—"}</td>
                    <td className={td}>
                      <Link href={`/orders/${p.order.id}/payment`} className="tabular hover:text-primary">
                        {p.order.refNo}
                      </Link>
                    </td>
                    <td className={cn(td, "max-md:hidden")}>{PAYMENT_METHOD_LABEL[p.method]}</td>
                    <td className={cn(td, "text-right tabular")}>{money(p.amount, p.currency)}</td>
                    <td className={cn(td, "text-right tabular max-md:hidden")}>{Number(p.bankCharges).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    <td className={cn(td, "max-lg:hidden")}>
                      {p.hasFile ? (
                        <a href={`/files/payments/${p.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyLine>No payments received yet.</EmptyLine>
        )}
      </PartyCard>
    </div>
  );
}

/* ---------------------------------------------------------------- Details */

export function DetailsTab({ c, canEdit, handledBy }: { c: CustomerDetail; canEdit: boolean; handledBy?: string }) {
  const edit = canEdit ? <EditButton panel="edit-customer" id={c.id} label={`Edit ${c.name}`} /> : undefined;
  const add = canEdit && (
    <OpenPanelButton panel="edit-customer" id={c.id} variant="ghost" size="sm" label="Add contact">
      <Plus aria-hidden /> Add contact
    </OpenPanelButton>
  );
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-5">
        <PartyCard title="Contacts" count={c.contacts.length} action={add}>
          {c.contacts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60">
                    <th scope="col" className={th}>
                      Name
                    </th>
                    <th scope="col" className={cn(th, "max-sm:hidden")}>
                      Position
                    </th>
                    <th scope="col" className={th}>
                      Phone / WhatsApp
                    </th>
                    <th scope="col" className={cn(th, "max-md:hidden")}>
                      Email
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {c.contacts.map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-b-0">
                      <td className={cn(td, p.isPrimary && "font-semibold")}>
                        {p.name}
                        {p.isPrimary && (
                          <>
                            {" "}
                            <Star aria-hidden className="inline size-3 fill-current align-[-1px]" />
                            <span className="sr-only">(primary)</span>
                          </>
                        )}
                        {p.wechat && <span className="block text-xs font-normal text-text-2">WeChat {p.wechat}</span>}
                      </td>
                      <td className={cn(td, "max-sm:hidden")}>{p.position ?? "—"}</td>
                      <td className={cn(td, "tabular")}>
                        {p.phone ? (
                          <a href={`tel:${p.phone}`} className="hover:text-primary">
                            {p.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                        {p.whatsapp && p.whatsapp !== p.phone && <span className="block text-xs text-text-2">WhatsApp {p.whatsapp}</span>}
                      </td>
                      <td className={cn(td, "max-md:hidden")}>
                        {p.email ? (
                          <a href={`mailto:${p.email}`} className="hover:text-primary">
                            {p.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyLine>No contacts yet.</EmptyLine>
          )}
        </PartyCard>
        <PartyCard title="Company" action={edit}>
          <Facts
            wide
            items={[
              { label: "Name", value: c.name },
              { label: "Type", value: CUSTOMER_TYPE_LABEL[c.type] },
              { label: "Country", value: c.country !== UNKNOWN_COUNTRY ? countryName(c.country) : <span className="text-warn">Not set</span> },
              { label: "Address on documents", value: c.address && <span className="whitespace-pre-line">{c.address}</span> },
              { label: "Tax / license no.", value: c.taxNo },
              { label: "Reg. number", value: c.regNo },
              { label: "Letters on documents", value: c.initials },
            ]}
          />
        </PartyCard>
        <PartyCard title="Sales terms" action={edit}>
          <Facts
            wide
            items={[
              { label: "Currency", value: c.defaultCurrency },
              { label: "Handled by", value: handledBy },
            ]}
          />
        </PartyCard>
      </div>
      <aside aria-label="Notes" className="flex min-w-0 flex-col gap-5">
        <PartyCard title="Notes about them" action={edit}>
          {c.notes ? <p className="px-4 py-3.5 text-sm whitespace-pre-line text-text-2">{c.notes}</p> : <EmptyLine>No notes yet.</EmptyLine>}
        </PartyCard>
      </aside>
    </div>
  );
}

/** Overview's Key details: five fields and Edit. */
export function KeyDetails({ c, canEdit, handledBy }: { c: CustomerDetail; canEdit: boolean; handledBy?: string }) {
  return (
    <PartyCard title="Key details" action={canEdit ? <EditButton panel="edit-customer" id={c.id} label={`Edit ${c.name}`} /> : undefined}>
      <Facts
        items={[
          { label: "Country", value: c.country !== UNKNOWN_COUNTRY ? countryName(c.country) : <span className="text-warn">Not set</span> },
          { label: "Currency", value: c.defaultCurrency },
          { label: "Type", value: CUSTOMER_TYPE_LABEL[c.type] },
          { label: "Tax / license no.", value: c.taxNo },
          { label: "Handled by", value: handledBy },
        ]}
      />
    </PartyCard>
  );
}

/** Gross profit per sales order from the customer's account (managers). */
export const profitByOrder = (a: CustomerAccount | null) =>
  a ? { currency: a.currency, byOrder: new Map(a.rows.flatMap((r) => (r.order ? [[r.order.id, r.order.profit] as const] : []))) } : null;
