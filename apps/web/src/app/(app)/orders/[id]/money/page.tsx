import Link from "next/link";
import { Banknote } from "lucide-react";
import { PAYMENT_KIND_LABEL } from "@kebo/shared";
import { buttonClass, Card, CardHeader, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { date, money, whole } from "@/lib/format";

export const metadata = { title: "Order · money" };

type Meaning = "ok" | "warn" | "bad" | "neutral" | "info";

/**
 * The order's Money (board OrderMoney): what the customer pays and what came in, what we owe and paid
 * the factory, and the profit planned on the quotation against what is expected now. Payments are
 * recorded on Payment (from the customer) and Factory (to the factory).
 */
export default async function OrderMoneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await orderOf(id);
  const [m, pay, setup] = await Promise.all([optional(() => orderMoneyOf(id)), optional(() => orderPaymentsOf(id)), orderCostsSetup(id)]);
  const base = `/orders/${o.id}`;
  const c = o.currency;
  const costs = setup?.costs ?? null;
  const p = costs?.profit ?? null;
  const fac = m?.factories ?? null;
  const facCur = fac?.rows[0]?.currency ?? null;
  const oneCur = !!fac && fac.rows.every((r) => r.currency === facCur);
  const facOwed = oneCur ? (fac?.rows ?? []).reduce((t, r) => t + Number(r.owed), 0) : 0;
  const facPaid = oneCur ? (fac?.rows ?? []).reduce((t, r) => t + Number(r.paid), 0) : 0;
  const live = (pay?.payments ?? []).filter((x) => !x.voided);
  const kinds = [...new Set(live.map((x) => PAYMENT_KIND_LABEL[x.kind].toLowerCase()))];
  // Customer rows: what came in, then the parts of the plan still open.
  const planOpen = (m?.plan.items ?? []).filter((i) => Number(i.open) > 0);
  const planTone: Record<string, [Meaning, string]> = {
    late: ["bad", "Late"],
    due_soon: ["warn", "Due soon"],
    part_paid: ["warn", "Part paid"],
    open: ["neutral", "Expected"],
    paid: ["ok", "Received"],
  };
  const facTone: Record<string, [Meaning, string]> = { late: ["bad", "Late"], due: ["warn", "Due"], part: ["warn", "Part paid"], later: ["neutral", "Later"], paid: ["ok", "Paid"] };

  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile label="Customer pays" value={whole(Number(o.money.total) + Number(o.money.charged), c)} sub={Number(o.money.charged) > 0 ? `with ${whole(o.money.charged, c)} charged` : undefined} />
        <StatTile label="Received" value={whole(o.money.received, c)} sub={kinds.length ? kinds.join(" · ") : "nothing yet"} />
        <StatTile label="They owe" value={whole(o.money.due, c)} tone={Number(o.money.due) > 0 ? "warn" : "ok"} sub={m?.terms ? m.terms.toLowerCase() : undefined} />
        {oneCur && facCur && <StatTile label="Paid to factory" value={whole(facPaid, facCur)} sub={`of ${whole(facOwed, facCur)}`} />}
        {p && (
          <StatTile
            label="Profit so far"
            value={whole(p.expected, c)}
            tone="ok"
            sub={p.onQuoteMargin !== null ? `planned ${p.onQuoteMargin.toFixed(1)}%` : p.margin !== null ? `${p.margin.toFixed(1)}%` : undefined}
          />
        )}
      </StatRow>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader
            title="From the customer"
            actions={
              <Link href={`${base}/payment`} className={buttonClass("primary", "sm")}>
                <Banknote aria-hidden /> Record payment
              </Link>
            }
          />
          <Table className="min-w-[560px]">
            <THead>
              <tr>
                <Th>Date</Th>
                <Th>Receipt</Th>
                <Th>Kind</Th>
                <Th>Account</Th>
                <Th className="text-right">Amount</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {live.map((x) => (
                <Tr key={x.id}>
                  <Td className="whitespace-nowrap">{date(x.paidOn)}</Td>
                  <Td>{x.reference ? <RefCode>{x.reference}</RefCode> : "—"}</Td>
                  <Td>{PAYMENT_KIND_LABEL[x.kind]}</Td>
                  <Td>{x.account?.name ?? "—"}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(x.amount, x.currency).replace(`${x.currency} `, "")}</Td>
                  <Td>
                    <StatusBadge meaning="ok">Received</StatusBadge>
                  </Td>
                </Tr>
              ))}
              {planOpen.map((i) => {
                const [meaning, word] = planTone[i.status] ?? ["neutral", "Expected"];
                return (
                  <Tr key={`plan-${i.id}`}>
                    <Td className="whitespace-nowrap">{i.dueOn ? `by ${date(i.dueOn)}` : "—"}</Td>
                    <Td>—</Td>
                    <Td>{i.label.replace(/\s*\d+%$/, "")}</Td>
                    <Td className="text-text-2">{i.dueOn ? "" : (i.rule ?? i.when ?? "")}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(i.open, c).replace(`${c} `, "")}</Td>
                    <Td>
                      <StatusBadge meaning={meaning}>{word}</StatusBadge>
                    </Td>
                  </Tr>
                );
              })}
              {!live.length && !planOpen.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-sm text-muted">
                    Nothing received or expected.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>

        {fac && (
          <Card className="overflow-hidden">
            <CardHeader
              title="To the factory"
              actions={
                <Link href={`${base}/factory`} className={buttonClass("secondary", "sm")}>
                  <Banknote aria-hidden /> Pay supplier
                </Link>
              }
            />
            <Table className="min-w-[560px]">
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>Payment</Th>
                  <Th>Kind</Th>
                  <Th>Account</Th>
                  <Th className="text-right">Amount</Th>
                  <Th />
                </tr>
              </THead>
              <tbody>
                {fac.payments
                  .filter((x) => !x.voided)
                  .map((x) => (
                    <Tr key={x.id}>
                      <Td className="whitespace-nowrap">{date(x.paidOn)}</Td>
                      <Td>{x.reference ? <RefCode>{x.reference}</RefCode> : "—"}</Td>
                      <Td>
                        {PAYMENT_KIND_LABEL[x.kind]}
                        {fac.payments.length && fac.rows.length > 1 ? <span className="block text-xs text-muted">{x.factory.name}</span> : null}
                      </Td>
                      <Td>{x.account?.name ?? "—"}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{money(x.amount, x.currency).replace(`${x.currency} `, "")}</Td>
                      <Td>
                        <StatusBadge meaning="ok">Paid</StatusBadge>
                      </Td>
                    </Tr>
                  ))}
                {fac.plans.flatMap((pl) =>
                  pl.rows
                    .filter((r) => Number(r.open) > 0)
                    .map((r) => {
                      const [meaning, word] = facTone[r.status] ?? ["neutral", "Later"];
                      return (
                        <Tr key={`${pl.factory.id}-${r.id ?? r.label}`}>
                          <Td className="whitespace-nowrap">{(r.dueOn ?? r.due) && /^\d{4}-\d{2}-\d{2}$/.test(r.dueOn ?? r.due ?? "") ? `by ${date((r.dueOn ?? r.due)!)}` : "—"}</Td>
                          <Td>—</Td>
                          <Td>
                            {r.label}
                            {fac.plans.length > 1 && <span className="block text-xs text-muted">{pl.factory.name}</span>}
                          </Td>
                          <Td className="text-text-2">{r.dueOn || /^\d{4}-\d{2}-\d{2}$/.test(r.due ?? "") ? "" : (r.due ?? "")}</Td>
                          <Td className="text-right whitespace-nowrap tabular">{money(r.open, pl.currency).replace(`${pl.currency} `, "")}</Td>
                          <Td>
                            <StatusBadge meaning={meaning}>{r.status === "due" && r.dueOn ? `Due ${date(r.dueOn).replace(/ \d{4}$/, "")}` : word}</StatusBadge>
                          </Td>
                        </Tr>
                      );
                    }),
                )}
                {!fac.payments.length && !fac.plans.some((pl) => pl.rows.some((r) => Number(r.open) > 0)) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-sm text-muted">
                      Nothing paid or planned.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>
        )}
      </div>

      {p && (
        <Card className="overflow-hidden">
          <CardHeader title="Profit" />
          <Table className="min-w-[560px]">
            <THead>
              <tr>
                <Th />
                <Th className="text-right">Planned</Th>
                <Th className="text-right">Expected now</Th>
              </tr>
            </THead>
            <tbody>
              {(
                [
                  ["Sale", p.sale, p.sale],
                  ["Goods", (Number(p.sale) - Number(p.planned) - Number(p.onQuote)).toFixed(2), p.factory],
                  ["Freight + insurance", p.planned, p.planned],
                  ["Costs on the deal", null, p.notPlanned],
                  ["Bank charges", null, p.bankCharges],
                ] as [string, string | null, string][]
              ).map(([label, planned, now]) => (
                <Tr key={label}>
                  <Td>{label}</Td>
                  <Td className="text-right tabular">{planned !== null ? whole(planned, c) : "—"}</Td>
                  <Td className="text-right tabular">{Number(now) || label === "Sale" ? whole(now, c) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-bold">
                <td className="px-3.5 py-3">Profit</td>
                <td className="px-3.5 py-3 text-right tabular">
                  {whole(p.onQuote, c)}
                  {p.onQuoteMargin !== null ? ` · ${p.onQuoteMargin.toFixed(1)}%` : ""}
                </td>
                <td className="px-3.5 py-3 text-right tabular">
                  {whole(p.expected, c)}
                  {p.margin !== null ? ` · ${p.margin.toFixed(1)}%` : ""}
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}
    </div>
  );
}
