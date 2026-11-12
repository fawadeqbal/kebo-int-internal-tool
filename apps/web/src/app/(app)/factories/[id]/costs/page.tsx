import { notFound } from "next/navigation";
import { Banknote, Printer } from "lucide-react";
import { can } from "@kebo/shared";
import { ButtonLink, Card, CardHeader, EmptyState, RefCode, StatRow, StatTile, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requirePermission, hasFeature } from "@/lib/session";
import { factoryOf, factoryPayablesOf } from "@/lib/party-data";
import { date, TZ, whole } from "@/lib/format";
import type { ExpenseList } from "@/lib/types-money";
import type { FactoryOrders } from "@/lib/types-facts";
import type { LedgerParty } from "@/lib/types-ledger";
import { DataTable } from "@/components/common/data-table";

export const metadata = { title: "Supplier costs" };

interface Line {
  key: string;
  date: string | null;
  what: string;
  sub?: string | null;
  order: { id: string; refNo: string } | null;
  account: string | null;
  owed: number;
  paid: number;
  balance: number;
}

const two = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (v: number) => (Math.abs(v) < 0.005 ? "" : two(v));

/**
 * The supplier's Costs tab (board "Supplier — Costs tab (statement)", managers): Bought, Paid, We owe and the
 * other costs on it; then the statement — every purchase and every payment to the factory, with what we owe
 * after each — from the ledger for those who see it, else order by order. Print and Pay supplier above it.
 */
export default async function FactoryCosts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("sourcing.manage");
  if (!(can(me, "expenses.manage") && (await hasFeature("expenses")))) notFound();
  const today = todayIn(TZ);
  const ledgerOn = can(me, "ledger.view");
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const [f, costs, payables, pos, ledger] = await Promise.all([
    factoryOf(id),
    api.get<ExpenseList>("/expenses", { factoryId: id }).catch(() => null),
    factoryPayablesOf(id),
    insights ? api.get<FactoryOrders>("/insights/facts/factory-orders", { factoryId: id }).catch(() => null) : null,
    ledgerOn ? api.get<LedgerParty>(`/ledger/parties/factory/${id}`, { from: "2000-01-01", to: today }).catch(() => null) : null,
  ]);
  const orders = (pos?.rows ?? []).filter((o) => o.status !== "cancelled");
  const cur = orders[0]?.currency ?? payables[0]?.currency ?? ledger?.currencies[0]?.currency ?? "CNY";
  const sum = (k: "owed" | "paid" | "toPay") => orders.filter((o) => o.currency === cur).reduce((t, o) => t + Number(o[k]), 0);
  const owing = pos ? sum("toPay") : payables.filter((p) => p.currency === cur).reduce((t, p) => t + Number(p.toPay), 0);
  const firstOpen = orders.find((o) => Number(o.toPay) > 0.005);

  let lines: Line[];
  if (ledger) {
    lines = ledger.rows
      .filter((r) => r.currency === cur && !r.removed)
      .map((r) => {
        const what = [r.typeLabel, r.ref].filter(Boolean).join(" ");
        return {
          key: r.id,
          date: r.date,
          what,
          sub: r.memo && r.memo !== r.typeLabel && r.memo !== what ? r.memo : null,
          order: r.order,
          account: Number(r.debit) > 0 ? (r.counter?.label ?? null) : null,
          owed: Number(r.credit),
          paid: Number(r.debit),
          balance: Number(r.balance),
        };
      });
  } else {
    let running = 0;
    lines = [...orders]
      .filter((o) => o.currency === cur)
      .reverse()
      .map((o) => ({
        key: o.orderId,
        date: o.orderedOn,
        what: `Bought for ${o.refNo}`,
        sub: Number(o.paid) > 0 ? `${whole(o.paid, cur)} paid` : null,
        order: { id: o.orderId, refNo: o.refNo },
        account: null,
        owed: Number(o.owed),
        paid: Number(o.paid),
        balance: (running += Number(o.owed) - Number(o.paid)),
      }));
  }
  const owedSum = lines.reduce((t, l) => t + l.owed, 0);
  const paidSum = lines.reduce((t, l) => t + l.paid, 0);
  const closing = lines.length ? lines[lines.length - 1]!.balance : 0;
  const first = lines.find((l) => l.date)?.date ?? today;

  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile label="Bought" value={pos ? whole(sum("owed"), cur) : "—"} />
        <StatTile label="Paid" value={pos ? whole(sum("paid"), cur) : "—"} />
        <StatTile
          label="We owe"
          value={whole(owing, cur)}
          tone={owing > 0.005 ? "warn" : undefined}
          sub={owing > 0.005 && firstOpen ? `${firstOpen.refNo} first` : undefined}
        />
        <StatTile label="Other costs" value={costs ? whole(costs.total, costs.currency) : "—"} sub="visits, inspections" />
      </StatRow>

      <Card className="overflow-clip">
        <CardHeader
          title="Statement"
          actions={
            <span className="flex flex-wrap gap-2">
              {ledgerOn && (
                <ButtonLink
                  href={`/print/ledger/factory/${f.id}?from=${first}&to=${today}&cur=${cur}`}
                  size="sm"
                  target="_blank"
                  prefetch={false}
                >
                  <Printer aria-hidden /> Print
                </ButtonLink>
              )}
              {(can(me, "payments.record") || can(me, "expenses.manage")) && (
                <ButtonLink href={`/payments/new?kind=out&factory=${f.id}&back=/factories/${f.id}/costs`} variant="primary" size="sm">
                  <Banknote aria-hidden /> Pay supplier
                </ButtonLink>
              )}
            </span>
          }
        />
        {lines.length === 0 ? (
          <EmptyState
            title="Nothing bought yet"
            description="What we buy from this factory and what we pay it show here, with what we owe after each."
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
                  <Th className="text-right">Owed</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </THead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={l.key}>
                    <Td className="whitespace-nowrap">{l.date ? date(l.date) : "—"}</Td>
                    <Td>
                      <span className={l.paid && !l.owed ? "block font-semibold" : "block"}>{l.what}</span>
                      {l.sub && <span className="block text-xs text-text-2">{l.sub}</span>}
                    </Td>
                    <Td>{l.order ? <RefCode href={`/orders/${l.order.id}`}>{l.order.refNo}</RefCode> : "—"}</Td>
                    <Td>{l.account ?? "—"}</Td>
                    <Td className="text-right tabular">{amount(l.owed)}</Td>
                    <Td className="text-right tabular">{amount(l.paid)}</Td>
                    <Td className="text-right tabular">{two(l.balance)}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-[#f8faf9] font-bold dark:bg-surface-2">
                  <Td colSpan={3} />
                  <Td>Total ({cur})</Td>
                  <Td className="text-right tabular">{two(owedSum)}</Td>
                  <Td className="text-right tabular">{two(paidSum)}</Td>
                  <Td className="text-right tabular">{two(closing)}</Td>
                </tr>
              </tfoot>
            </table>
          </DataTable>
        )}
      </Card>
    </div>
  );
}
