import { Banknote, Printer } from "lucide-react";
import { can, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { ButtonLink, Card, CardHeader, EmptyState, RefCode, StatRow, StatTile, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { customerOf, customerPaymentsOf } from "@/lib/party-data";
import { date, TZ, whole } from "@/lib/format";
import type { LedgerParty } from "@/lib/types-ledger";
import { DataTable } from "@/components/common/data-table";
import { late } from "../shared";

export const metadata = { title: "Customer money" };

/** One line of the statement: charged (what they owe more) or paid, and the balance after it. */
interface Line {
  key: string;
  date: string;
  what: string;
  sub?: string | null;
  order: { id: string; refNo: string } | null;
  account: string | null;
  charged: number;
  paid: number;
  balance: number;
}

const amount = (v: number) =>
  Math.abs(v) < 0.005 ? "" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The customer's Money tab (board "Customer — Money tab (statement)"): Sold, Received, They owe (with what is
 * late) and Credit; then the statement — every order charged and every payment, with the balance after each —
 * from the ledger for those who see it, else from the orders and payments. Print and Record payment above it.
 */
export default async function CustomerMoneyTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const ledgerOn = can(me, "ledger.view");
  const today = todayIn(TZ);
  const [c, pay, ledger] = await Promise.all([
    customerOf(id),
    customerPaymentsOf(id),
    ledgerOn ? api.get<LedgerParty>(`/ledger/parties/customer/${id}`, { from: "2000-01-01", to: today }).catch(() => null) : null,
  ]);
  const totals = pay?.totals ?? [];
  const main = totals[0]?.currency ?? c.defaultCurrency;
  const sum = (k: "total" | "received" | "due") => totals.filter((t) => t.currency === main).reduce((s, t) => s + Number(t[k]), 0);
  const lateAmount = (pay?.orders ?? [])
    .filter((o) => o.currency === main && late(o, today))
    .reduce((s, o) => s + Number(o.next?.open ?? 0), 0);
  const credit = pay?.credit.balances.find((b) => b.currency === main)?.amount ?? 0;

  // The statement in the customer's main currency.
  let lines: Line[];
  if (ledger) {
    lines = ledger.rows
      .filter((r) => r.currency === main && !r.removed)
      .map((r) => {
        const what = [r.typeLabel, r.ref].filter(Boolean).join(" ");
        return {
          key: r.id,
          date: r.date,
          what,
          sub: r.memo && r.memo !== r.typeLabel && r.memo !== what ? r.memo : null,
          order: r.order,
          account: Number(r.credit) > 0 ? (r.counter?.label ?? null) : null,
          charged: Number(r.debit),
          paid: Number(r.credit),
          balance: Number(r.balance),
        };
      });
  } else {
    const events = [
      ...(pay?.orders ?? [])
        .filter((o) => o.currency === main && o.status !== "cancelled")
        .map((o) => ({
          key: o.id,
          date: o.orderedOn,
          what: `Sales order ${o.refNo}`,
          sub: null,
          order: { id: o.id, refNo: o.refNo },
          account: null,
          charged: Number(o.total),
          paid: 0,
        })),
      ...(pay?.payments ?? [])
        .filter((p) => p.currency === main && !p.voided)
        .map((p) => ({
          key: p.id,
          date: p.paidOn,
          what: `Payment${p.reference ? ` ${p.reference}` : ""}`,
          sub: PAYMENT_KIND_LABEL[p.kind],
          order: p.order,
          account: PAYMENT_METHOD_LABEL[p.method],
          charged: 0,
          paid: Number(p.amount),
        })),
    ].sort((a, b) => a.date.localeCompare(b.date) || b.charged - a.charged);
    let running = 0;
    lines = events.map((e) => ({ ...e, balance: (running += e.charged - e.paid) }));
  }
  const charged = lines.reduce((s, l) => s + l.charged, 0);
  const paid = lines.reduce((s, l) => s + l.paid, 0);
  const closing = lines.length ? lines[lines.length - 1]!.balance : 0;

  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile label="Sold" value={whole(sum("total"), main)} />
        <StatTile label="Received" value={whole(sum("received"), main)} />
        <StatTile
          label="They owe"
          value={whole(sum("due"), main)}
          tone={lateAmount > 0.005 ? "bad" : undefined}
          sub={lateAmount > 0.005 ? `${whole(lateAmount, main)} late` : undefined}
        />
        <StatTile label="Credit" value={whole(credit, main)} />
      </StatRow>

      <Card className="overflow-clip">
        <CardHeader
          title={
            <span>
              Statement {lines.length > 0 && <span className="text-xs font-normal text-muted">· since {date(lines[0]!.date)}</span>}
            </span>
          }
          actions={
            <span className="flex flex-wrap gap-2">
              {ledgerOn && (
                <ButtonLink
                  href={`/print/ledger/customer/${c.id}?from=${lines[0]?.date ?? today}&to=${today}&cur=${main}`}
                  size="sm"
                  target="_blank"
                  prefetch={false}
                >
                  <Printer aria-hidden /> Print statement
                </ButtonLink>
              )}
              {can(me, "payments.record") && (
                <ButtonLink href={`/payments/new?kind=in&customer=${c.id}&back=/customers/${c.id}/money`} variant="primary" size="sm">
                  <Banknote aria-hidden /> Record payment
                </ButtonLink>
              )}
            </span>
          }
        />
        {lines.length === 0 ? (
          <EmptyState
            title="Nothing to show yet"
            description="Their orders and payments show here as a statement, with the balance after each."
          />
        ) : (
          <DataTable label="Statement">
            <table className="w-full min-w-[1000px] text-[13px]">
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>What</Th>
                  <Th>Order</Th>
                  <Th>Account</Th>
                  <Th className="text-right">Charged</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </THead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={l.key}>
                    <Td className="whitespace-nowrap">{date(l.date)}</Td>
                    <Td>
                      <span className={l.paid ? "block font-semibold" : "block"}>{l.what}</span>
                      {l.sub && <span className="block text-xs text-text-2">{l.sub}</span>}
                    </Td>
                    <Td>{l.order ? <RefCode href={`/orders/${l.order.id}`}>{l.order.refNo}</RefCode> : "—"}</Td>
                    <Td>{l.account ?? "—"}</Td>
                    <Td className="text-right tabular">{amount(l.charged)}</Td>
                    <Td className="text-right tabular">{amount(l.paid)}</Td>
                    <Td className="text-right tabular">
                      {l.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-[#f8faf9] font-bold dark:bg-surface-2">
                  <Td colSpan={3} />
                  <Td>Total ({main})</Td>
                  <Td className="text-right tabular">{amount(charged) || "0.00"}</Td>
                  <Td className="text-right tabular">{amount(paid) || "0.00"}</Td>
                  <Td className="text-right tabular">
                    {closing.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Td>
                </tr>
              </tfoot>
            </table>
          </DataTable>
        )}
      </Card>
    </div>
  );
}
