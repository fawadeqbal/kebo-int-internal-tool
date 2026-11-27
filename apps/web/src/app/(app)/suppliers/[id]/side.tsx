import { can } from "@kebo/shared";
import { ButtonLink, Card, CardBody, CardHeader, EmptyLine } from "@kebo/ui";
import { FileText } from "lucide-react";
import { hasFeature, requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import type { SupplierGroups, SupplierOrders } from "@/lib/types-facts";
import { supplierOf, supplierPayablesOf } from "@/lib/party-data";
import { plural, whole } from "@/lib/format";
import { dataOf, failedWhat, part } from "@/lib/part";
import { CouldNotLoad } from "@/components/common/could-not-load";

/**
 * The supplier's side panel, the same on every tab (live audit 20 Nov: it showed on Overview only): Money and how
 * they perform.
 */
export async function SupplierSide({ id }: { id: string }) {
  const me = await requireUser();
  const money = can(me, "expenses.manage") && can(me, "reports.view") && (await hasFeature("insights"));
  const [f, payablesPart, posPart, groupsPart] = await Promise.all([
    supplierOf(id),
    supplierPayablesOf(id),
    money ? part("its orders", () => api.get<SupplierOrders>("/insights/facts/supplier-orders", { supplierId: id })) : null,
    money ? part("what we bought from it", () => api.get<SupplierGroups>("/insights/facts/suppliers/groups", { period: "all", by: "factory", supplierId: id })) : null,
  ]);
  const pos = dataOf(posPart);
  const groups = dataOf(groupsPart);
  const failed = failedWhat(posPart, groupsPart);
  const r = f.record;
  // Not read: said in the money box, in place of "Nothing bought or owed yet".
  const payablesFailed = failedWhat(payablesPart);
  const toPay = (dataOf(payablesPart) ?? []).filter((p) => Number(p.toPay) > 0.005);
  const perf = groups?.rows[0] ?? null;
  // Bought, paid and owed, per currency, from its orders.
  const sums = [...new Set((pos?.rows ?? []).map((o) => o.currency))].map((cur) => {
    const of = (pos?.rows ?? []).filter((o) => o.currency === cur);
    const add = (k: "owed" | "paid" | "toPay") => of.reduce((t, o) => t + Number(o[k]), 0);
    return { cur, orders: of.length, owed: add("owed"), paid: add("paid"), toPay: add("toPay") };
  });
  return (
    <>
          {failed && <CouldNotLoad what={failed} />}
          {/* Money (board): bought, paid, what we owe. */}
          <Card>
            <CardHeader
              title="Finance"
              actions={
                <ButtonLink href={`/suppliers/${f.id}/costs`} variant="link" size="sm">
                  <FileText aria-hidden /> Statement
                </ButtonLink>
              }
            />
            <CardBody className="flex flex-col gap-2.5 text-md">
              {sums.length ? (
                sums.map((t) => (
                  <div key={t.cur} className="flex flex-col gap-2.5">
                    {[
                      [`Bought (${plural(t.orders, "order")})`, whole(t.owed, t.cur)],
                      ["Paid", whole(t.paid, t.cur)],
                      ["We owe", whole(t.toPay, t.cur)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <span className="text-text-2">{k}</span>
                        <strong className="tabular">{v}</strong>
                      </div>
                    ))}
                  </div>
                ))
              ) : toPay.length ? (
                toPay.map((p) => (
                  <div key={p.currency} className="flex justify-between gap-3">
                    <span className="text-text-2">We owe ({plural(p.orders.length, "order")})</span>
                    <strong className="tabular">{whole(p.toPay, p.currency)}</strong>
                  </div>
                ))
              ) : payablesFailed ? (
                <CouldNotLoad what={payablesFailed} compact />
              ) : (
                <EmptyLine>Nothing bought or owed yet.</EmptyLine>
              )}
            </CardBody>
          </Card>

          {/* How they perform (board). */}
          <Card>
            <CardHeader title="How they perform" />
            <CardBody className="flex flex-col gap-2.5 text-md">
              {(
                [
                  ["Offers sent", String(f.quotes.length)],
                  ["Chosen in a quotation", String(f.quotes.filter((q) => q.usedIn).length)],
                  ...(perf ? ([["Won by customer", String(perf.offersWon)]] as const) : []),
                  ["Avg. reply", r.avgDaysToAnswer === null ? "—" : `${r.avgDaysToAnswer} days`],
                  ...(perf ? ([["On-time ready", perf.ready.known ? `${perf.ready.onTime} of ${perf.ready.known}` : "—"]] as const) : []),
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-text-2">{k}</span>
                  <strong className="tabular">{v}</strong>
                </div>
              ))}
            </CardBody>
          </Card>
    </>
  );
}
