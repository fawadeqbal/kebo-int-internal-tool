import Link from "next/link";
import { AlertTriangle, FileText, Mail } from "lucide-react";
import { buildHref, ButtonLink, Card, EmptyState, StatRow, StatTile, Table, Td, Th, THead, Tr, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, whole } from "@/lib/format";
import type { OpenInvoices } from "@/lib/types-money";
import { FilterCard } from "@/components/common/filter-card";

type Bucket = "not_due" | "soon" | "late30" | "late_more";
const AGE_LABEL: Record<Bucket, string> = { not_due: "Not due", soon: "Due in 7 days", late30: "1–30 late", late_more: "30+ late" };
const n = (v: number) => (Math.abs(v) < 0.005 ? "—" : Math.round(v).toLocaleString("en-US"));

/**
 * What each customer owes us, or we owe each supplier, by age (board Receivables / Payables): the
 * tiles, a search with currency and age, and one row per party with its buckets, total and oldest due.
 */
export async function PartyAgeing({
  side,
  base,
  sp,
  held,
}: {
  side: "receivable" | "payable";
  base: string;
  sp: { q?: string; cur?: string; age?: string };
  /** Credit we hold for customers (receivables), per currency. */
  held?: { currency: string; amount: string; customers: number }[];
}) {
  const r = await api.get<OpenInvoices>("/billing/invoices", { side });
  const receivable = side === "receivable";
  const currencies = [...new Set(r.rows.map((x) => x.currency))].sort();
  const cur = sp.cur && currencies.includes(sp.cur) ? sp.cur : (r.totals.slice().sort((a, b) => Number(b.open) - Number(a.open))[0]?.currency ?? currencies[0]);
  const age = (Object.keys(AGE_LABEL) as Bucket[]).includes(sp.age as Bucket) ? (sp.age as Bucket) : undefined;
  const q = sp.q?.trim().toLowerCase() ?? "";
  const bucketOf = (x: OpenInvoices["rows"][number]): Bucket => (x.late > 30 ? "late_more" : x.late > 0 ? "late30" : x.soon ? "soon" : "not_due");

  type Row = { id: string; name: string; orders: Set<string>; b: Record<Bucket, number>; total: number; oldest: string | null; oldestLate: string | null };
  const byParty = new Map<string, Row>();
  for (const x of r.rows.filter((y) => y.currency === cur && Number(y.open) > 0)) {
    const row = byParty.get(x.party.id) ?? { id: x.party.id, name: x.party.name, orders: new Set<string>(), b: { not_due: 0, soon: 0, late30: 0, late_more: 0 }, total: 0, oldest: null, oldestLate: null };
    row.orders.add(x.order.refNo);
    row.b[bucketOf(x)] += Number(x.open);
    row.total += Number(x.open);
    if (x.dueOn && (!row.oldest || x.dueOn < row.oldest)) row.oldest = x.dueOn;
    if (x.late > 0 && (!row.oldestLate || x.order.refNo < row.oldestLate)) row.oldestLate = x.order.refNo;
    byParty.set(x.party.id, row);
  }
  const all = [...byParty.values()].sort((a, b) => b.b.late_more + b.b.late30 - (a.b.late_more + a.b.late30) || b.total - a.total);
  const rows = all.filter((x) => (!q || x.name.toLowerCase().includes(q) || [...x.orders].some((o) => o.toLowerCase().includes(q))) && (!age || x.b[age] > 0));
  const sum = (k: Bucket | "total") => rows.reduce((t, x) => t + (k === "total" ? x.total : x.b[k]), 0);
  const tot = all.reduce((t, x) => t + x.total, 0);
  const late = all.reduce((t, x) => t + x.b.late30 + x.b.late_more, 0);
  const lateRef = all.find((x) => x.oldestLate)?.oldestLate;
  const credit = held?.find((h) => h.currency === cur);
  const href = (k: string) => (receivable ? `/customers/${k}/money` : `/factories/${k}`);

  return (
    <div className="flex flex-col gap-4">
      <StatRow>
        <StatTile icon={FileText} iconColor={2} label={receivable ? "They owe" : "We owe"} value={cur ? whole(tot, cur) : "—"} sub={`${all.length} ${receivable ? "customer" : "supplier"}${all.length === 1 ? "" : "s"}`} />
        <StatTile label="Not due yet" value={cur ? whole(all.reduce((t, x) => t + x.b.not_due + x.b.soon, 0), cur) : "—"} />
        <StatTile icon={AlertTriangle} iconColor={2} label="Late" value={cur ? whole(late, cur) : "—"} sub={lateRef} tone={late > 0 ? "bad" : undefined} />
        {receivable ? (
          <StatTile label="Credit we hold" value={credit ? whole(credit.amount, credit.currency) : "—"} sub={credit ? `${credit.customers} customer${credit.customers === 1 ? "" : "s"}` : undefined} />
        ) : (
          <StatTile label="Due in 7 days" value={cur ? whole(all.reduce((t, x) => t + x.b.soon, 0), cur) : "—"} />
        )}
      </StatRow>
      <div>
        <FilterCard
          search={receivable ? "Search customer…" : "Search supplier…"}
          value={sp.q}
          clearHref={buildHref(base, { cur: sp.cur, age: sp.age }, {})}
          selects={[
            { name: "cur", label: "Currency", value: sp.cur, options: currencies.map((c) => ({ value: c, label: c })), all: cur },
            { name: "age", label: "Age", value: age, options: (Object.keys(AGE_LABEL) as Bucket[]).map((k) => ({ value: k, label: AGE_LABEL[k] })) },
          ]}
        />
        <Card className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <EmptyState title={q || age ? "Nothing matches" : receivable ? "Nobody owes us" : "We owe nobody"} description={receivable ? "Open payment requests show here by customer." : "What we still owe the suppliers shows here."} />
          ) : (
            <Table className="min-w-[860px]">
              <THead>
                <tr>
                  <Th>{receivable ? "Customer" : "Supplier"}</Th>
                  <Th className="text-right">Not due</Th>
                  <Th className="text-right">Due in 7 days</Th>
                  <Th className="text-right">1–30 late</Th>
                  <Th className="text-right">30+ late</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Oldest due</Th>
                  <Th>
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((x) => (
                  <Tr key={x.id}>
                    <Td>
                      <Link href={href(x.id)} className="font-semibold hover:text-primary">
                        {x.name}
                      </Link>
                      <span className="block text-xs text-text-2">{x.orders.size === 1 ? [...x.orders][0] : `${x.orders.size} orders`}</span>
                    </Td>
                    <Td className="text-right tabular">{n(x.b.not_due)}</Td>
                    <Td className="text-right tabular">{n(x.b.soon)}</Td>
                    <Td className={cn("text-right tabular", x.b.late30 > 0 && "text-bad")}>{n(x.b.late30)}</Td>
                    <Td className={cn("text-right tabular", x.b.late_more > 0 && "font-semibold text-bad")}>{n(x.b.late_more)}</Td>
                    <Td className="text-right font-semibold tabular">{n(x.total)}</Td>
                    <Td className="whitespace-nowrap">{x.oldest ? date(x.oldest) : "on a step"}</Td>
                    <Td className="text-right">
                      <ButtonLink href={receivable ? `/customers/${x.id}/money` : `/payments/new?kind=out`} variant="secondary" size="sm">
                        {receivable ? (
                          <>
                            <Mail aria-hidden /> Remind
                          </>
                        ) : (
                          "Pay"
                        )}
                      </ButtonLink>
                    </Td>
                  </Tr>
                ))}
                <Tr className="border-t-2 border-line font-semibold">
                  <Td>Total {cur}</Td>
                  <Td className="text-right tabular">{n(sum("not_due"))}</Td>
                  <Td className="text-right tabular">{n(sum("soon"))}</Td>
                  <Td className="text-right tabular">{n(sum("late30"))}</Td>
                  <Td className="text-right tabular">{n(sum("late_more"))}</Td>
                  <Td className="text-right tabular">{n(sum("total"))}</Td>
                  <Td />
                  <Td />
                </Tr>
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
