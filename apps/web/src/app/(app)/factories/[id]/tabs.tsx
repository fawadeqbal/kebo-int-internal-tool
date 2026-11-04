import Link from "next/link";
import { Plus, Star } from "lucide-react";
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@kebo/shared";
import { ButtonLink, Card, cn, StatusBadge, type StatusMeaning } from "@kebo/ui";
import { InfoTip } from "@kebo/ui/client";
import { money } from "@/lib/format";
import type { ExpenseList } from "@/lib/types-money";
import type { FactoryDetail, FactoryPurchases } from "@/lib/types-people";
import type { LedgerParty } from "@/lib/types-ledger";
import { OpenPanelButton } from "@/components/common/panel";
import { ExportLink } from "@/components/sheets/export-link";
import { CopyButton, StatementButton } from "@/components/party/party-client";
import { AllTab, ChipRow, EditButton, EmptyLine, Facts, ListRow, PartyCard, TotalsLine } from "@/components/party/parts";
import { byCurrency, day, plural, sumText } from "@/components/party/format";

type PO = FactoryPurchases["orders"][number];

const th = "px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-text-2";
const td = "px-3 py-3 whitespace-nowrap";

export const PRODUCTION: Record<PO["production"], { label: string; meaning: StatusMeaning }> = {
  on_track: { label: "On track", meaning: "ok" },
  overdue_step: { label: "Overdue step", meaning: "bad" },
  ready: { label: "Ready", meaning: "info" },
  delivered: { label: "Delivered", meaning: "ok" },
  cancelled: { label: "Cancelled", meaning: "neutral" },
};

export const ProductionBadge = ({ p }: { p: PO["production"] }) => <StatusBadge meaning={PRODUCTION[p].meaning}>{PRODUCTION[p].label}</StatusBadge>;

/** In the factory's currency when it has one, else the main currency. */
export const own = (o: PO, k: "total" | "paid" | "balanceDue") => ({ currency: o.currency ?? o.mainCurrency, amount: o.currency ? o[k]! : o[`${k}Main` as const] });

const IN_PRODUCTION: PO["production"][] = ["on_track", "overdue_step", "ready"];

/** In production on Overview: five, then All N →. */
export function InProductionCard({ base, p, today }: { base: string; p: FactoryPurchases; today: string }) {
  const making = p.orders.filter((o) => o.status === "open" && IN_PRODUCTION.includes(o.production));
  if (!making.length) return null;
  return (
    <PartyCard title="In production" count={making.length} action={<AllTab href={`${base}?tab=orders`} count={p.orders.length} />}>
      <ul className="divide-y divide-line">
        {making.slice(0, 5).map((o) => {
          const t = own(o, "total");
          return (
            <ListRow
              key={o.id}
              href={`/orders/${o.id}/factory`}
              title={`${o.refNo} · ${o.customer.name}`}
              sub={`${o.readyOn ? `Ready ${day(o.readyOn, today)}` : "No ready date"} · ${money(t.amount, t.currency)}`}
              badge={<ProductionBadge p={o.production} />}
            />
          );
        })}
      </ul>
    </PartyCard>
  );
}

/** Latest supplier quotes on Overview: five, then All N →. */
export function LatestQuotesCard({ base, f, today }: { base: string; f: FactoryDetail; today: string }) {
  if (!f.quotes.length) return null;
  return (
    <PartyCard title="Latest supplier quotes" action={<AllTab href={`${base}?tab=quotes`} count={f.quotes.length} />}>
      <ul className="divide-y divide-line">
        {f.quotes.slice(0, 5).map((q) => (
          <ListRow
            key={q.id}
            href={`/inquiries/${q.inquiry.id}/sourcing`}
            title={`${q.inquiry.refNo} · ${q.inquiry.title}`}
            sub={`${plural(q._count.lines, "line")} · ${q.currency} · ${day(q.receivedOn, today)}`}
          />
        ))}
      </ul>
    </PartyCard>
  );
}

/* ---------------------------------------------------------------- Purchase orders */

const PO_FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "production", label: "In production", test: (o: PO) => o.status === "open" && (o.production === "on_track" || o.production === "overdue_step") },
  { key: "ready", label: "Ready", test: (o: PO) => o.production === "ready" },
  { key: "delivered", label: "Delivered", test: (o: PO) => o.production === "delivered" },
  { key: "cancelled", label: "Cancelled", test: (o: PO) => o.production === "cancelled" },
] as const;

export function PurchaseOrdersTab({ f, p, base, filter, today }: { f: FactoryDetail; p: FactoryPurchases; base: string; filter?: string; today: string }) {
  if (!p.orders.length)
    return (
      <Card>
        <EmptyLine
          action={
            <ButtonLink href="/inquiries?stage=sourcing" size="sm" variant="secondary">
              Request quotes
            </ButtonLink>
          }
        >
          No purchase orders yet.
        </EmptyLine>
      </Card>
    );
  const fl = PO_FILTERS.find((x) => x.key === filter) ?? PO_FILTERS[0];
  const rows = p.orders.filter(fl.test);
  const currencies = [...new Set(p.orders.map((o) => o.currency ?? o.mainCurrency))];
  const one = currencies.length === 1 ? currencies[0]! : null;
  const amount = (o: PO, k: "total" | "paid" | "balanceDue") => {
    const v = own(o, k);
    return one ? Number(v.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : money(v.amount, v.currency);
  };
  const live = rows.filter((o) => o.status !== "cancelled");
  const sum = (k: "total" | "paid" | "balanceDue") => byCurrency(live, (o) => own(o, k).currency, (o) => own(o, k).amount);
  return (
    <>
      <ChipRow
        chips={PO_FILTERS.map((x) => ({ href: x.key === "all" ? `${base}?tab=orders` : `${base}?tab=orders&f=${x.key}`, label: x.label, count: p.orders.filter(x.test).length, active: x.key === fl.key })).filter((x) => x.count > 0 || x.active || x.label !== "Cancelled")}
        end={<ExportLink what="factory-orders" query={{ id: f.id }} label="Export" className="border-transparent bg-transparent shadow-none" />}
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
                    <span className="inline-flex items-center gap-1">
                      Purchase order
                      <InfoTip label="About purchase order numbers" align="start">
                        Our order to the factory. Number follows the sales order.
                      </InfoTip>
                    </span>
                  </th>
                  <th scope="col" className={cn(th, "max-md:hidden")}>
                    Customer
                  </th>
                  <th scope="col" className={th}>
                    Production
                  </th>
                  <th scope="col" className={cn(th, "max-lg:hidden")}>
                    Ready date
                  </th>
                  <th scope="col" className={cn(th, "text-right max-sm:hidden")}>
                    Total{one && ` (${one})`}
                  </th>
                  <th scope="col" className={cn(th, "text-right max-md:hidden")}>
                    Paid
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Balance due
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const overdue = o.open.some((x) => x.due && x.due < today);
                  return (
                    <tr key={o.id} className={cn("relative border-b border-line last:border-b-0 hover:bg-primary-soft/40", o.status === "cancelled" && "text-muted")}>
                      <td className={td}>
                        <Link href={`/orders/${o.id}/factory`} className="font-semibold tabular after:absolute after:inset-0 hover:text-primary">
                          {o.refNo}
                        </Link>
                      </td>
                      <td className={cn(td, "max-md:hidden")}>{o.customer.name}</td>
                      <td className={td}>
                        <ProductionBadge p={o.production} />
                      </td>
                      <td className={cn(td, "max-lg:hidden")}>{o.readyOn ? day(o.readyOn, today) : "—"}</td>
                      <td className={cn(td, "text-right tabular max-sm:hidden")}>{amount(o, "total")}</td>
                      <td className={cn(td, "text-right tabular max-md:hidden")}>{amount(o, "paid")}</td>
                      <td className={cn(td, "text-right tabular", Number(own(o, "balanceDue").amount) > 0.005 && (overdue ? "font-semibold text-bad" : "text-warn"))}>
                        {o.status === "cancelled" ? "—" : amount(o, "balanceDue")}
                        {overdue && <span className="sr-only"> (overdue)</span>}
                      </td>
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
              { label: "Total", value: sumText(sum("total"), "—") },
              { label: "Paid", value: sumText(sum("paid"), "—") },
              { label: "Balance due", value: sumText(sum("balanceDue"), "—") },
            ],
          ]}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Supplier quotes */

export function SupplierQuotesTab({ f, p, today }: { f: FactoryDetail; p: FactoryPurchases; today: string }) {
  const request = (
    <ButtonLink href="/inquiries?stage=sourcing" size="sm" variant="secondary">
      Request quotes
    </ButtonLink>
  );
  return (
    <div className="flex flex-col gap-5">
      {p.waiting.length > 0 && (
        <PartyCard title="Quote requests without a reply" count={p.waiting.length}>
          <ul className="divide-y divide-line">
            {p.waiting.map((w) => (
              <ListRow key={w.id} href={`/inquiries/${w.inquiry.id}/sourcing`} title={`${w.inquiry.refNo} · ${w.inquiry.title}`} sub={`Asked ${day(w.sentOn, today)}${w.replyBy ? ` · reply by ${day(w.replyBy, today)}` : ""}`} badge={<StatusBadge meaning={w.replyBy && w.replyBy < today ? "bad" : "neutral"}>Requested</StatusBadge>} />
            ))}
          </ul>
        </PartyCard>
      )}
      <PartyCard title="Supplier quotes" count={f.quotes.length} help="A factory's prices for an inquiry. Internal, never sent to the customer." action={request}>
        {f.quotes.length ? (
          <ul className="divide-y divide-line">
            {f.quotes.map((q) => (
              <ListRow key={q.id} href={`/inquiries/${q.inquiry.id}/sourcing`} title={`${q.inquiry.refNo} · ${q.inquiry.title}`} sub={`${plural(q._count.lines, "line")} · ${q.currency} · ${day(q.receivedOn, today)}`} />
            ))}
          </ul>
        ) : (
          <EmptyLine action={request}>No supplier quotes yet.</EmptyLine>
        )}
      </PartyCard>
    </div>
  );
}

/* ---------------------------------------------------------------- Payments */

const AGE_LABEL = ["Not due", "1–30 days", "31–60 days", "Over 60 days"];

export function PaymentsTab({ f, p, ledger, today, statement }: { f: FactoryDetail; p: FactoryPurchases; ledger: LedgerParty | null; today: string; statement: boolean }) {
  const b = ledger ? new Map(ledger.ageing.buckets.map((x) => [x.bucket as string, x])) : null;
  const tiles = b
    ? [["not_due"], ["d1_30"], ["d31_60"], ["d61_90", "d90_plus"]].map((keys) => {
        const items = keys.flatMap((k) => b.get(k)?.items ?? []);
        return { amount: keys.reduce((t, k) => t + Number(b.get(k)?.base ?? 0), 0), refs: [...new Set(items.map((i) => i.refNo).filter(Boolean))] as string[] };
      })
    : null;
  const live = p.payments.filter((x) => !x.voided);
  return (
    <div className="flex flex-col gap-5">
      {tiles && ledger && (
        <section aria-labelledby="ageing-title">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <h2 id="ageing-title" className="flex items-center gap-1 text-[15px] font-semibold">
              Payables by age
              <InfoTip label="About payables by age">What we owe them in {ledger.mainCurrency}, by days past each due date.</InfoTip>
            </h2>
            {statement && <StatementButton kind="factory" id={f.id} from={`${today.slice(0, 4)}-01-01`} to={today} back={`/factories/${f.id}?tab=payments`} label="Statement of account" variant="secondary" />}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((t, i) => (
              <div key={AGE_LABEL[i]} className="min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
                <p className="text-xs font-medium text-text-2">{AGE_LABEL[i]}</p>
                <p className={cn("mt-1 truncate text-lg font-bold tabular sm:text-[22px] sm:leading-7", i > 0 && t.amount > 0.005 && "text-bad")}>{money(t.amount, ledger.mainCurrency)}</p>
                <p className="mt-0.5 truncate text-xs text-text-2">{t.refs.length ? (i === 0 ? plural(t.refs.length, "purchase order") : t.refs.slice(0, 2).join(", ") + (t.refs.length > 2 ? ` +${t.refs.length - 2}` : "")) : " "}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <PartyCard title="Payments made" count={live.length}>
        {p.payments.length ? (
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
                    Purchase order
                  </th>
                  <th scope="col" className={cn(th, "max-md:hidden")}>
                    Payment method
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Amount
                  </th>
                  <th scope="col" className={cn(th, "max-lg:hidden")}>
                    Attachment
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.payments.map((x) => (
                  <tr key={x.id} className={cn("border-b border-line last:border-b-0", x.voided && "text-muted line-through")}>
                    <td className={td}>{day(x.paidOn, today)}</td>
                    <td className={cn(td, "max-sm:hidden")}>{x.reference ?? "—"}</td>
                    <td className={td}>
                      <Link href={`/orders/${x.order.id}/factory`} className="tabular hover:text-primary">
                        {x.order.refNo}
                      </Link>
                    </td>
                    <td className={cn(td, "max-md:hidden")}>{PAYMENT_METHOD_LABEL[x.method as PaymentMethod] ?? x.method}</td>
                    <td className={cn(td, "text-right tabular")}>{money(x.amount, x.currency)}</td>
                    <td className={cn(td, "max-lg:hidden")}>
                      {x.hasFile ? (
                        <a href={`/files/factory-payments/${x.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
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
          <EmptyLine>No payments made yet.</EmptyLine>
        )}
      </PartyCard>
    </div>
  );
}

/* ---------------------------------------------------------------- Costs */

export function CostsTab({ costs, today }: { costs: ExpenseList; today: string }) {
  return (
    <PartyCard title="Expenses" count={costs.rows.length} help="Expenses that name this factory: visits, inspections." action={costs.rows.length > 0 && <span className="text-sm font-semibold tabular">{money(costs.total, costs.currency)}</span>}>
      {costs.rows.length ? (
        <ul className="divide-y divide-line">
          {costs.rows.map((e) => (
            <ListRow
              key={e.id}
              href={e.deal ? `/inquiries/${e.deal.id}` : e.order ? `/orders/${e.order.id}/payment` : undefined}
              title={<span className={e.voided ? "text-text-2 line-through" : undefined}>{e.description}</span>}
              sub={[EXPENSE_CATEGORY_LABEL[e.category], day(e.spentOn, today), e.deal?.refNo ?? e.order?.refNo, e.customer?.name].filter(Boolean).join(" · ")}
              figure={money(e.amount, e.currency)}
            />
          ))}
        </ul>
      ) : (
        <EmptyLine>No expenses yet.</EmptyLine>
      )}
    </PartyCard>
  );
}

/* ---------------------------------------------------------------- Details */

/** "•••• 6621" */
export const masked = (account: string) => `•••• ${account.replace(/\s/g, "").slice(-4)}`;

export const bankText = (f: FactoryDetail) =>
  [
    f.bankBeneficiary && `Beneficiary: ${f.bankBeneficiary}`,
    f.bankName && `Bank: ${f.bankName}`,
    f.bankAccount && `Account: ${f.bankAccount}`,
    f.bankSwift && `SWIFT: ${f.bankSwift}`,
    f.bankDetails,
  ]
    .filter(Boolean)
    .join("\n");

/** Overview's Bank card: the account masked, Copy for paying. */
export function BankCard({ f }: { f: FactoryDetail }) {
  const any = f.bankName || f.bankAccount || f.bankSwift || f.bankBeneficiary || f.bankDetails;
  if (!any) return null;
  return (
    <PartyCard title="Bank">
      <Facts
        items={[
          ...(f.bankName ? [{ label: "Bank", value: f.bankName }] : []),
          ...(f.bankAccount ? [{ label: "Account", value: <span className="tabular">{masked(f.bankAccount)}</span> }] : []),
          ...(f.bankSwift ? [{ label: "SWIFT", value: f.bankSwift }] : []),
          ...(!f.bankName && !f.bankAccount && f.bankDetails ? [{ label: "Other", value: <span className="line-clamp-3 whitespace-pre-line">{f.bankDetails}</span> }] : []),
        ]}
      />
      <div className="px-4 pb-3.5">
        <CopyButton text={bankText(f)} label="Copy bank details" done="Bank details copied" variant="ghost" />
      </div>
    </PartyCard>
  );
}

export function DetailsTab({ f, currency }: { f: FactoryDetail; currency: string | null }) {
  const edit = <EditButton panel="edit-factory" id={f.id} label={`Edit ${f.name}`} />;
  const add = (
    <OpenPanelButton panel="edit-factory" id={f.id} variant="ghost" size="sm" label="Add contact">
      <Plus aria-hidden /> Add contact
    </OpenPanelButton>
  );
  const bank = bankText(f);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-5">
        <PartyCard title="Contacts" count={f.contacts.length} action={add}>
          {f.contacts.length ? (
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
                      Phone
                    </th>
                    <th scope="col" className={cn(th, "max-md:hidden")}>
                      WeChat
                    </th>
                    <th scope="col" className={cn(th, "max-lg:hidden")}>
                      Email
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {f.contacts.map((p) => (
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
                      </td>
                      <td className={cn(td, "max-md:hidden")}>{p.wechat ?? "—"}</td>
                      <td className={cn(td, "max-lg:hidden")}>
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
              { label: "Name", value: f.name },
              { label: "Address", value: f.address && <span className="whitespace-pre-line">{f.address}</span> },
              { label: "Handled by", value: f.owner?.name },
            ]}
          />
        </PartyCard>
        <PartyCard title="Purchase terms">
          <Facts wide items={[{ label: "Currency", value: currency }]} />
        </PartyCard>
      </div>
      <aside aria-label="Bank and notes" className="flex min-w-0 flex-col gap-5">
        <PartyCard title="Bank details" action={edit}>
          <Facts
            items={[
              { label: "Beneficiary", value: f.bankBeneficiary },
              { label: "Bank", value: f.bankName },
              { label: "Account", value: f.bankAccount && <span className="tabular">{f.bankAccount}</span> },
              { label: "SWIFT", value: f.bankSwift },
              ...(f.bankDetails ? [{ label: "Other bank details", value: <span className="whitespace-pre-line">{f.bankDetails}</span> }] : []),
            ]}
          />
          {bank && (
            <div className="px-4 pb-3.5">
              <CopyButton text={bank} label="Copy" done="Bank details copied" variant="ghost" />
            </div>
          )}
        </PartyCard>
        <PartyCard title="Notes about them" action={edit}>
          {f.notes ? <p className="px-4 py-3.5 text-sm whitespace-pre-line text-text-2">{f.notes}</p> : <EmptyLine>No notes yet.</EmptyLine>}
        </PartyCard>
      </aside>
    </div>
  );
}

/** Overview's Key details: five fields and Edit. */
export function KeyDetails({ f, currency }: { f: FactoryDetail; currency: string | null }) {
  const primary = f.contacts.find((c) => c.isPrimary) ?? f.contacts[0];
  return (
    <PartyCard title="Key details" action={<EditButton panel="edit-factory" id={f.id} label={`Edit ${f.name}`} />}>
      <Facts
        items={[
          { label: "Address", value: f.address && <span className="line-clamp-2 whitespace-pre-line">{f.address}</span> },
          { label: "Currency", value: currency },
          { label: "Phone", value: primary?.phone },
          { label: "Email", value: primary?.email && <span className="break-all">{primary.email}</span> },
          { label: "Handled by", value: f.owner?.name },
        ]}
      />
    </PartyCard>
  );
}
