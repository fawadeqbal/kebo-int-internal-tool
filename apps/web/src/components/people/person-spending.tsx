import type { ReactNode } from "react";
import Link from "next/link";
import { THead, Th, Card, cn, ScrollFade, EmptyLine, CardHeader } from "@kebo/ui";
import { costKind } from "@/components/money/cost-kinds";
import { RepayWindow } from "@/components/order-sections/costs-windows";
import { date, money, dayMonth, num0 as n0 } from "@/lib/format";
import type { PersonCost, PersonSpendFor, PersonSpending } from "@/lib/types-money";

const FOR_LABEL: Record<PersonSpendFor, string> = {
  orders: "On orders",
  before: "Before orders",
  lost: "Lost inquiries",
  open: "Inquiries still open",
  customers: "On customers",
  company: "For the company",
};


/** The header of a card on a person's page (as RecordListCard's). */
function Head({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <CardHeader title={title} description={description} actions={action && <span className="text-xs text-text-2">{action}</span>} />;
}

/** What a cost was on: the order, the inquiry (lost or not), the customer, or the company. */
function Target({ e }: { e: PersonCost }) {
  if (e.order)
    return (
      <Link href={`/orders/${e.order.id}/costs`} className="font-medium hover:text-primary hover:underline">
        {e.order.refNo}
      </Link>
    );
  if (e.inquiry)
    return (
      <>
        <Link href={`/inquiries/${e.inquiry.id}/costs`} className="font-medium hover:text-primary hover:underline">
          {e.inquiry.refNo}
        </Link>
        {e.for === "lost" && <span className="text-text-2"> lost</span>}
      </>
    );
  if (e.customer)
    return (
      <Link href={`/customers/${e.customer.id}`} className="hover:text-primary hover:underline">
        {e.customer.name}
      </Link>
    );
  return <span className="text-text-2">The company</span>;
}

const paidWords = (e: PersonCost, name: string) =>
  e.paid === "own" ? `${name}'s own money` : e.paid === "own_repaid" ? "own money · paid back" : e.paid === "not_yet" ? "not paid yet" : (e.account ?? "—");

/** One column of sums with a bar each (On what, What it was for). */
function Bars({ title, rows, currency }: { title: string; rows: { label: string; amount: string }[]; currency: string }) {
  const top = Math.max(...rows.map((r) => Number(r.amount)), 1);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-semibold text-text-2">
        {title} · {currency}
      </h3>
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-col gap-1 text-md">
              <span className="flex justify-between gap-3">
                <span>{r.label}</span>
                <span className="font-semibold tabular">{n0(r.amount)}</span>
              </span>
              <span className="h-1.5 rounded-full bg-surface-2" aria-hidden>
                <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, (Number(r.amount) / top) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyLine>Nothing yet.</EmptyLine>
      )}
    </div>
  );
}

/**
 * "Spending" on a person's page (design "spending", board Staff): what they paid this year, and what they
 * recorded where nobody else is named: on what, what it was for, and the latest costs.
 */
export function PersonSpendingCard({ s, year }: { s: PersonSpending; year: string }) {
  const name = s.person.name.split(" ")[0] ?? s.person.name;
  const c = s.currency;
  const fors = (Object.keys(FOR_LABEL) as PersonSpendFor[]).filter((k) => Number(s.byFor[k]) > 0).map((k) => ({ label: FOR_LABEL[k], amount: s.byFor[k] }));
  return (
    <Card className="overflow-clip">
      <Head
        title={`Spending · ${year}`}
        description={`What ${name} paid in ${year}, and what they recorded where nobody else is named`}
        action={s.count ? `${s.count} cost${s.count === 1 ? "" : "s"} · ${money(s.spent, c)}` : undefined}
      />
      {s.count === 0 ? (
        <EmptyLine inset>Nothing spent in {year} yet.</EmptyLine>
      ) : (
        <>
          <div className="grid gap-6 px-4 py-4 sm:grid-cols-2">
            <Bars title="On what" currency={c} rows={s.byKind.slice(0, 6).map((k) => ({ label: costKind(k.category), amount: k.amount }))} />
            <Bars title="What it was for" currency={c} rows={fors} />
          </div>
          <p className="border-t border-line px-4 py-2.5 text-xs text-text-2">
            On orders: already in those orders&apos; profit. For the company: on Company costs. The others are what Profit after all costs takes off
            {Number(s.outside) > 0 ? ` (${money(s.outside, c)})` : ""}.
          </p>
          <ScrollFade scrollLabel="Spending, kind by kind" className="overflow-x-auto border-t border-line">
            <table className="w-full border-collapse text-md">
              <THead>
                <tr>
                  <Th scope="col">
                    Date
                  </Th>
                  <Th scope="col">
                    What for
                  </Th>
                  <Th scope="col">
                    For
                  </Th>
                  <Th scope="col" className="text-right">
                    Amount {c}
                  </Th>
                  <Th scope="col">
                    Paid
                  </Th>
                </tr>
              </THead>
              <tbody>
                {s.latest.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-4 py-2.5 whitespace-nowrap text-text-2">{dayMonth(e.spentOn)}</td>
                    <td className="px-3 py-2.5">
                      {e.description}
                      <span className="block text-xs text-text-2">{costKind(e.category)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Target e={e} />
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                      {n0(e.inMain)}
                      {e.currency !== c && <span className="block text-xs text-text-2">{money(e.amount, e.currency)}</span>}
                    </td>
                    <td className={cn("px-4 py-2.5 text-text-2", e.paid === "own" && "text-warn")}>
                      {paidWords(e, name)}
                      {e.recordedOnly && <span className="block text-xs">recorded by them</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFade>
        </>
      )}
    </Card>
  );
}

/** "Owed back to …": what they paid from their own money and were not paid back, with Pay back (one payment per currency). */
export function PersonOwedCard({ s, today, canPay }: { s: PersonSpending; today: string; canPay: boolean }) {
  if (!s.owed.rows.length) return null;
  const name = s.person.name.split(" ")[0] ?? s.person.name;
  return (
    <Card className="overflow-clip">
      <Head title={`Owed back to ${name}`} description="Paid with their own money and not paid back yet" />
      <ul className="divide-y divide-line">
        {s.owed.rows.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-md">
            <span className="min-w-0">
              {e.description}
              <span className="block text-xs text-text-2">
                {date(e.spentOn)} · <Target e={e} />
              </span>
            </span>
            <span className="font-semibold whitespace-nowrap tabular">{money(e.amount, e.currency)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
        {s.owed.total.map((t) =>
          canPay ? (
            <RepayWindow
              key={t.currency}
              orderId={null}
              ids={t.ids}
              currency={t.currency}
              name={s.person.name}
              amount={money(t.amount, t.currency)}
              today={today}
              canFiles={false}
              label={`Pay back ${money(t.amount, t.currency)}`}
            />
          ) : (
            <span key={t.currency} className="text-sm font-semibold tabular">
              {money(t.amount, t.currency)}
            </span>
          ),
        )}
      </div>
    </Card>
  );
}
