import Link from "next/link";
import { LOST_REASON_LABEL } from "@kebo/shared";
import { Card, CardHeader, StatTile, Table, Td, Th, THead, Tr, EmptyLine, linkClass, Dash } from "@kebo/ui";
import { costKind } from "@/components/money/cost-kinds";
import { money, num0 as n0 } from "@/lib/format";
import { bigMoney, change, type Period } from "@/lib/insights-period";
import type { loadSpending } from "@/lib/insights-data";
import { BarList, Delta, Tiles } from "./frame";
import { how, reportSpan } from "@/lib/figures";

const dash = <Dash />;
/** Spent for every 100 sold, two decimals; a dash with nothing sold. */
const per100 = (spent: number, sold: number) => (sold > 0 ? ((spent / sold) * 100).toFixed(2) : null);
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Reports › Spending (design "spending", board Spending): who spends, on what, and what winning and losing cost
 * us. "Spent to sell" is trips, hotels, meals, gifts, samples, courier and checks on a customer, an inquiry or an
 * order; a person's "Spent" is everything they paid (as on their page). The company's own costs stay on
 * Finance › Expenses.
 */
export function SpendingSection({ d, p }: { d: Awaited<ReturnType<typeof loadSpending>>; p: Period }) {
  const c = d.currency;
  const toSell = Number(d.toSell);
  const owing = d.people.filter((x) => Number(x.owed) > 0).sort((a, b) => Number(b.owed) - Number(a.owed));
  const everyone = d.people.reduce(
    (t, x) => ({ spent: t.spent + Number(x.spent), toSell: t.toSell + Number(x.toSell), lost: t.lost + Number(x.lost), owed: t.owed + Number(x.owed), sold: t.sold + x.sold }),
    { spent: 0, toSell: 0, lost: 0, owed: 0, sold: 0 },
  );
  const lostDeals = d.lostReasons.reduce((t, r) => t + r.deals, 0);
  // What each figure counts, behind its ⓘ (lib/figures.ts).
  const span = reportSpan(p);
  // Months before anything was spent or sold are left out (the last three stay).
  const firstBusy = d.months.findIndex((m) => Number(m.toSell) > 0 || m.sold > 0);
  const months = d.months.slice(Math.min(firstBusy < 0 ? d.months.length : firstBusy, Math.max(0, d.months.length - 3)));

  return (
    <div className="flex flex-col gap-4">
      <Tiles className="xl:grid-cols-5">
        <StatTile
          label="Spent to sell"
          value={bigMoney(toSell, c)}
          delta={d.toSellBefore !== null ? <Delta value={change(toSell, Number(d.toSellBefore))} goodWhenUp={false} vs={p.vsLabel} /> : undefined}
          sub="trips, samples, gifts, meals"
          how={how.spentToSell(span, c)}
        />
        <StatTile label="On inquiries we won" value={bigMoney(Number(d.onWon), c)} sub="on their orders, or before them" how={how.onDealsWon(span)} />
        <StatTile
          label="What lost inquiries cost"
          value={bigMoney(Number(d.lost.spent), c)}
          sub={`${d.lost.deals} lost inquir${d.lost.deals === 1 ? "y" : "ies"}`}
          how={how.lostDeals(span)}
        />
        <StatTile
          label={`Per ${c} 100 sold`}
          value={per100(toSell, d.sold) === null ? "—" : `${c} ${per100(toSell, d.sold)}`}
          sub={`on ${bigMoney(d.sold, c)} sold`}
          how={how.per100(span, c)}
        />
        <StatTile
          label="Owed back to staff"
          value={bigMoney(Number(d.owed), c)}
          sub={owing.length ? owing.slice(0, 2).map((x) => `${x.person.name.split(" ")[0]} ${n0(x.owed)}`).join(" · ") : "nothing owed"}
          how={how.owedBack(c)}
        />
      </Tiles>

      <p className="text-md text-text-2">
        The company&apos;s own costs (rent, salaries, the office: {money(d.company, c)} {p.name}) are on{" "}
        <Link href="/money/company-costs" className={linkClass}>
          Finance › Expenses
        </Link>
        .
      </p>

      <Card className="overflow-clip">
        <CardHeader title="Who spends" description="What each person paid, against what they sold. A name opens their page." />
        {d.people.length === 0 ? (
          <EmptyLine inset>Nothing was spent {p.name}.</EmptyLine>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Person</Th>
                <Th className="text-right">Spent {c}</Th>
                <Th className="text-right">To sell</Th>
                <Th className="text-right">On lost inquiries</Th>
                <Th className="text-right">Sold</Th>
                <Th className="text-right">Per 100 sold</Th>
                <Th className="text-right">Owed back</Th>
              </tr>
            </THead>
            <tbody>
              {d.people.map((x) => (
                <Tr key={x.person.id} href={`/users/${x.person.id}#spending`}>
                  <Td className="font-semibold">
                    <Link href={`/users/${x.person.id}#spending`} className="hover:text-primary">
                      {x.person.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular">{n0(x.spent)}</Td>
                  <Td className="text-right tabular">{Number(x.toSell) > 0 ? n0(x.toSell) : dash}</Td>
                  <Td className="text-right tabular">{Number(x.lost) > 0 ? n0(x.lost) : dash}</Td>
                  <Td className="text-right tabular">{x.sold > 0 ? n0(x.sold) : dash}</Td>
                  <Td className="text-right tabular">{per100(Number(x.toSell), x.sold) ?? dash}</Td>
                  <Td className={Number(x.owed) > 0 ? "text-right font-semibold text-warn tabular" : "text-right tabular"}>{Number(x.owed) > 0 ? n0(x.owed) : dash}</Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-bold">
                <td className="px-3.5 py-3">Everyone</td>
                <td className="px-3.5 py-3 text-right tabular">{n0(everyone.spent)}</td>
                <td className="px-3.5 py-3 text-right tabular">{n0(everyone.toSell)}</td>
                <td className="px-3.5 py-3 text-right tabular">{n0(everyone.lost)}</td>
                <td className="px-3.5 py-3 text-right tabular">{n0(d.sold)}</td>
                <td className="px-3.5 py-3 text-right tabular">{per100(everyone.toSell, d.sold) ?? "—"}</td>
                <td className="px-3.5 py-3 text-right tabular">{n0(everyone.owed)}</td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="On what" description={`Spent to sell, ${c}, every person`} />
          <div className="p-4">
            {d.kinds.length ? (
              <BarList label="Spent to sell by kind" rows={d.kinds.map((k) => ({ key: k.category, label: costKind(k.category), value: Number(k.amount), text: n0(k.amount) }))} />
            ) : (
              <EmptyLine>Nothing spent to sell {p.name}.</EmptyLine>
            )}
          </div>
        </Card>

        <Card className="overflow-clip">
          <CardHeader title="What losing cost us, by reason" description={`${lostDeals} lost inquir${lostDeals === 1 ? "y" : "ies"} with costs ${p.name}`} />
          {d.lostReasons.length === 0 ? (
            <EmptyLine inset>Nothing was spent on a lost inquiry {p.name}.</EmptyLine>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Why we lost</Th>
                  <Th className="text-right">Deals</Th>
                  <Th className="text-right">Spent on them</Th>
                  <Th className="text-right">Per inquiry</Th>
                </tr>
              </THead>
              <tbody>
                {d.lostReasons.map((r) => (
                  <Tr key={r.reason}>
                    <Td>{r.reason === "not_said" ? "No reason given" : LOST_REASON_LABEL[r.reason]}</Td>
                    <Td className="text-right tabular">{r.deals}</Td>
                    <Td className="text-right tabular">{n0(r.spent)}</Td>
                    <Td className="text-right tabular">{n0(Number(r.spent) / Math.max(1, r.deals))}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong font-bold">
                  <td className="px-3.5 py-3">All lost</td>
                  <td className="px-3.5 py-3 text-right tabular">{lostDeals}</td>
                  <td className="px-3.5 py-3 text-right tabular">{n0(d.lost.spent)}</td>
                  <td className="px-3.5 py-3 text-right tabular">{n0(Number(d.lost.spent) / Math.max(1, lostDeals))}</td>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        {d.costing && (
          <Card className="overflow-clip">
            <CardHeader title="Customers who cost more than they bring" description={`Spent on them ${p.name} is more than the profit from their orders`} />
            {d.costing.length === 0 ? (
              <p className="p-4 text-sm text-muted">None {p.name}.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Customer</Th>
                    <Th className="text-right">Profit on orders</Th>
                    <Th className="text-right">Spent on them</Th>
                    <Th className="text-right">After all costs</Th>
                  </tr>
                </THead>
                <tbody>
                  {d.costing.map((x) => (
                    <Tr key={x.customer.id} href={`/customers/${x.customer.id}/money#where`}>
                      <Td className="font-semibold">
                        <Link href={`/customers/${x.customer.id}/money#where`} className="hover:text-primary">
                          {x.customer.name}
                        </Link>
                      </Td>
                      <Td className="text-right tabular">{n0(x.profit)}</Td>
                      <Td className="text-right tabular">{n0(x.spent)}</Td>
                      <Td className="text-right font-semibold text-bad tabular">{n0(x.net)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        <Card className="overflow-clip">
          <CardHeader title="Supplier visits" description="Trips, hotels, meals and checks with a supplier named" />
          {d.factories.length === 0 ? (
            <EmptyLine inset>No supplier visit {p.name}.</EmptyLine>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Supplier</Th>
                  <Th className="text-right">Costs</Th>
                  <Th className="text-right">Spent {c}</Th>
                </tr>
              </THead>
              <tbody>
                {d.factories.map((f) => (
                  <Tr key={f.factory.id} href={`/suppliers/${f.factory.id}`}>
                    <Td className="font-semibold">
                      <Link href={`/suppliers/${f.factory.id}`} className="hover:text-primary">
                        {f.factory.name}
                      </Link>
                    </Td>
                    <Td className="text-right tabular">{f.visits}</Td>
                    <Td className="text-right tabular">{n0(f.spent)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="overflow-clip">
          <CardHeader title="Month by month" description="Spent to sell, and for every 100 sold" />
          <Table>
            <THead>
              <tr>
                <Th>Month</Th>
                <Th className="text-right">Spent to sell</Th>
                <Th className="text-right">Sold</Th>
                <Th className="text-right">Per 100 sold</Th>
              </tr>
            </THead>
            <tbody>
              {months.map((m) => (
                <Tr key={m.month}>
                  <Td>{MONTH.format(new Date(`${m.month}-01T00:00:00Z`))}</Td>
                  <Td className="text-right tabular">{n0(m.toSell)}</Td>
                  <Td className="text-right tabular">{m.sold > 0 ? n0(m.sold) : dash}</Td>
                  <Td className="text-right tabular">{per100(Number(m.toSell), m.sold) ?? dash}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
