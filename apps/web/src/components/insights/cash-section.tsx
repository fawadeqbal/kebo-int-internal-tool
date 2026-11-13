import Link from "next/link";
import { Alert, Card, CardHeader, cn, StatRow, StatTile, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, plural } from "@/lib/format";
import { bigMoney, monthYearOf, type Period } from "@/lib/insights-period";
import type { CashReport } from "@/lib/types-facts";

const n2 = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v: string | number) => (Number(v) < 0 ? `− ${n2(-Number(v))}` : n2(v));

/**
 * Reports › Cash (design "money, simple", board RCash): what came in and went out in the period, month by
 * month, and what each account held at the start and holds at the end. Read from the cash book's own rows.
 */
export function CashSection({ r, p }: { r: CashReport; p: Period }) {
  const c = r.currency;
  const ended = r.to < r.today;
  const net = Number(r.total.net);
  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile label="Came in" value={bigMoney(Number(r.in.amount), c)} tone={Number(r.in.amount) > 0 ? "ok" : undefined} sub={plural(r.in.entries, "payment")} />
        <StatTile label="Went out" value={bigMoney(Number(r.out.amount), c)} sub={plural(r.out.entries, "payment")} />
        <StatTile label="Net" value={net < 0 ? `− ${bigMoney(-net, c)}` : bigMoney(net, c)} tone={net < 0 ? "bad" : undefined} sub={p.name} />
        <StatTile label="Cash now" value={bigMoney(Number(r.cashNow), c)} sub={`${plural(r.accounts.filter((a) => !a.archived).length, "account")}${r.byCurrency.length > 1 ? `, counted in ${c}` : ""}`} href="/finance/cash-book" />
      </StatRow>
      {r.offAccount > 0 && (
        <Alert tone="warning">
          {plural(r.offAccount, "payment")} of this period {r.offAccount === 1 ? "is" : "are"} on no account yet, so {r.offAccount === 1 ? "it is" : "they are"} in the months below and in no
          account’s balance.{" "}
          <Link href="/finance/cash-book?acct=none" className="font-medium underline underline-offset-2">
            Put them on an account
          </Link>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="In and out, by month" description={`${c} · other currencies at today’s rate`} />
        <Table>
          <THead>
            <tr>
              <Th>Month</Th>
              <Th className="text-right">From customers</Th>
              <Th className="text-right hidden md:table-cell">To suppliers</Th>
              <Th className="text-right hidden md:table-cell">Freight and other bills</Th>
              <Th className="text-right hidden md:table-cell">Company costs</Th>
              <Th className="text-right">Net</Th>
              <Th className="text-right hidden sm:table-cell">Cash at the end</Th>
            </tr>
          </THead>
          <tbody>
            {r.months.map((m) => (
              <Tr key={m.month}>
                <Td className="font-semibold whitespace-nowrap">{monthYearOf(m.month)}</Td>
                <Td className="text-right tabular whitespace-nowrap">{signed(m.customers)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{signed(m.suppliers)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(m.bills)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(m.company)}</Td>
                <Td className={cn("text-right font-semibold tabular whitespace-nowrap", Number(m.net) < 0 && "text-bad")}>{signed(m.net)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden sm:table-cell">{n2(m.cashEnd)}</Td>
              </Tr>
            ))}
            {r.months.length > 1 && (
              <Tr className="font-semibold">
                <Td>Total</Td>
                <Td className="text-right tabular whitespace-nowrap">{signed(r.total.customers)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{signed(r.total.suppliers)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(r.total.bills)}</Td>
                <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">{n2(r.total.company)}</Td>
                <Td className={cn("text-right tabular whitespace-nowrap", net < 0 && "text-bad")}>{signed(r.total.net)}</Td>
                <Td className="hidden sm:table-cell" />
              </Tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="By account" description="each in its own currency · moves between our accounts count here, not in the months above" />
        {r.accounts.length === 0 ? (
          <p className="p-4 text-sm text-muted">
            No account yet.{" "}
            <Link href="/finance/cash-book" className="font-medium text-primary hover:underline">
              Add the first one on Cash &amp; bank
            </Link>
          </p>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Account</Th>
                <Th className="text-right hidden md:table-cell">At the start</Th>
                <Th className="text-right hidden sm:table-cell">In</Th>
                <Th className="text-right hidden sm:table-cell">Out</Th>
                <Th className="text-right">{ended ? "At the end" : "Now"}</Th>
              </tr>
            </THead>
            <tbody>
              {r.accounts.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <Link href={`/finance/cash-book?acct=${a.id}`} className="-my-1 inline-block py-1 font-semibold text-primary hover:underline">
                      {a.name} · {a.currency}
                    </Link>
                    {(a.openedOn || a.archived) && (
                      <span className="block text-xs text-text-2">{[a.openedOn && `opened ${date(a.openedOn)}`, a.archived && "closed"].filter(Boolean).join(" · ")}</span>
                    )}
                  </Td>
                  <Td className="text-right tabular whitespace-nowrap hidden md:table-cell">
                    {a.currency} {signed(a.start)}
                  </Td>
                  <Td className="text-right tabular whitespace-nowrap hidden sm:table-cell">{n2(a.in)}</Td>
                  <Td className="text-right tabular whitespace-nowrap hidden sm:table-cell">{n2(a.out)}</Td>
                  <Td className={cn("text-right font-semibold tabular whitespace-nowrap", Number(a.end) < 0 && "text-bad")}>
                    {a.currency} {signed(a.end)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
