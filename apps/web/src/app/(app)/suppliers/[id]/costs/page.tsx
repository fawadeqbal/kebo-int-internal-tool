import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { can } from "@kebo/shared";
import { PhoneList, PhoneRow, ButtonLink, Card, CardHeader, RefCode, StatRow, StatTile, Td, Th, THead, Tr, EmptyLine } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission, hasFeature } from "@/lib/session";
import { factoryOf, factoryPayablesOf } from "@/lib/party-data";
import { date, whole, companyToday } from "@/lib/format";
import type { ExpenseList } from "@/lib/types-money";
import type { FactoryOrders } from "@/lib/types-facts";
import type { LedgerParty } from "@/lib/types-ledger";
import { DataTable } from "@/components/common/data-table";
import { supplierTitle } from "@/lib/titles";

export const generateMetadata = supplierTitle("Money");

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
 * after each — from the ledger for those who see it, else order by order. Print statement above it (Pay supplier is the record's one button, at its top).
 */
export default async function FactoryCosts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("sourcing.manage");
  if (!(can(me, "expenses.manage") && (await hasFeature("expenses")))) notFound();
  const today = companyToday();
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
      {/* Bought, Paid and We owe are the side panel's Money box; only what it does not say is here, in the facts line. */}
      <StatRow facts>
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
                  prefetch={false}
                >
                  <Printer aria-hidden /> Print statement
                </ButtonLink>
              )}
            </span>
          }
        />
        {lines.length === 0 ? (
          <EmptyLine inset>Nothing bought yet. What we buy from this supplier and what we pay it show here, with what we owe after each.</EmptyLine>
        ) : (
          <>
          {/* A phone: a row per line — what, its day and order, what it moved; the balance after it on the right. */}
          <PhoneList label="Statement">
            {lines.map((l) => (
              <PhoneRow
                key={l.key}
                href={l.order ? `/orders/${l.order.id}` : undefined}
                title={l.what}
                line={[(l.date ? date(l.date) : "—"), l.order?.refNo, Math.abs(l.owed) >= 0.005 ? `${"owed"} ${amount(l.owed)}` : null, l.paid ? `paid ${amount(l.paid)}` : null].filter(Boolean).join(" · ")}
                figure={two(l.balance)}
              />
            ))}
          </PhoneList>
          <div className="max-sm:hidden">
          <DataTable label="Statement">
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
                  <Tr key={l.key} href={l.order ? `/orders/${l.order.id}` : undefined}>
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
                <tr className="border-t-2 border-line bg-faint font-bold">
                  <Td colSpan={3} />
                  <Td>Total ({cur})</Td>
                  <Td className="text-right tabular">{two(owedSum)}</Td>
                  <Td className="text-right tabular">{two(paidSum)}</Td>
                  <Td className="text-right tabular">{two(closing)}</Td>
                </tr>
              </tfoot>
          </DataTable>
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
