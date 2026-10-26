import Link from "next/link";
import { multiplyMinor, toMinor, formatMinor } from "@kebo/money";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import { date, money, qty } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { SalesSettings, SourcingView } from "@/lib/types-deals";
import { FactoryQuotes } from "@/components/deals/sourcing-board";
import { CoverageBadge } from "@/components/deals/revision-editor";
import { removeFactoryQuoteAction, saveFactoryQuoteAction, searchFactoriesAction } from "./actions";

export const metadata = { title: "Factory prices" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

/**
 * The factories' offers for the deal. Each offer is the factory's own lines
 * (its models, quantities and parts), each saying which of the customer's items
 * it answers. Compare whole offers (cost, what they cover, lead time) and item
 * by item; the quotation offers whole offers as options A, B…
 */
export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [d, s, settings] = await Promise.all([
    load(() => api.get<DealDetail>(`/inquiries/${id}`)),
    load(() => api.get<SourcingView>(`/inquiries/${id}/sourcing`)),
    api.get<{ sales: SalesSettings }>("/settings"),
  ]);
  const canEdit = d.allowed.source;
  const cheapest = Math.min(...s.quotes.filter((q) => q.totalCost !== null && !q.coverage.missing.length).map((q) => Number(q.totalCost)));

  return (
    <div className="flex flex-col gap-5">
      {!canEdit && (
        <Alert tone="info">
          {d.stage === "won" || d.stage === "lost"
            ? "This deal is closed, so its factory prices can no longer change."
            : "Only the person handling this deal (or a manager) can change its factory prices."}
        </Alert>
      )}
      {s.missingRates.length > 0 && (
        <Alert tone="warning">
          There is no exchange rate for {s.missingRates.join(", ")} in Settings, so those prices cannot be turned into {s.currency} and are
          left out of the comparison. Ask an admin to add the rate (1 {s.currency} = ? {s.missingRates[0]}).
        </Alert>
      )}

      {s.quotes.length > 0 && (
        <Card>
          <CardHeader
            title="Compare offers"
            description={`What each whole offer costs us in ${s.currency} (factory prices plus tax) and which of the customer's items it covers. Each offer can go to the customer as an option.`}
            actions={
              <Link href={`/deals/${d.id}/quotation`} className={buttonClass("primary", "sm")}>
                Go to the quotation
              </Link>
            }
          />
          <Table>
            <THead>
              <tr>
                <Th>Factory</Th>
                <Th>Covers</Th>
                <Th className="text-right">Lines</Th>
                <Th className="text-right">Cost to us</Th>
                <Th>Lead time</Th>
                <Th>Valid until</Th>
              </tr>
            </THead>
            <tbody>
              {[...s.quotes]
                .sort((a, b) => a.coverage.missing.length - b.coverage.missing.length || (a.totalCost === null ? 1 : b.totalCost === null ? -1 : Number(a.totalCost) - Number(b.totalCost)))
                .map((q) => (
                  <Tr key={q.id}>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{q.factory.name}</span>
                        {q.totalCost !== null && Number(q.totalCost) === cheapest && s.quotes.length > 1 && <Badge tone="ok">Cheapest complete</Badge>}
                      </span>
                      <span className="text-xs text-muted">received {date(q.receivedOn)}</span>
                    </Td>
                    <Td>
                      <CoverageBadge missing={q.coverage.missing} />
                    </Td>
                    <Td className="text-right tabular">{q.lines.length}</Td>
                    <Td className="text-right font-medium whitespace-nowrap tabular">{q.totalCost === null ? <span className="text-xs font-normal text-warn">No exchange rate</span> : money(q.totalCost, s.currency)}</Td>
                    <Td className="text-sm">{q.leadTime ?? <span className="text-muted">—</span>}</Td>
                    <Td className="text-sm whitespace-nowrap">{q.validUntil ? date(q.validUntil) : <span className="text-muted">—</span>}</Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
        </Card>
      )}

      {s.quotes.length > 0 && (
        <Card>
          <CardHeader title="Compare by item" description={`Each of the customer's items and the factory lines that answer it, cheapest first (your cost per unit in ${s.currency}).`} />
          <CardBody className="flex flex-col gap-5">
            {s.items.map((it) => (
              <section key={it.id} aria-label={`${it.parentId ? "Part" : "Item"} ${it.no}`} className={cn(it.parentId && "ml-4 border-l-2 border-line pl-4 sm:ml-6")}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="min-w-0 text-sm font-semibold">
                    <span className="mr-1.5 text-muted tabular">{it.no}</span>
                    <span className="whitespace-pre-line">{it.description}</span>
                    {it.model && <span className="ml-2 text-xs font-normal text-muted">{it.model}</span>}
                  </h3>
                  <span className="text-sm text-muted tabular">
                    {qty(it.quantity)} {it.unit}
                  </span>
                </div>
                {it.options.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">{it.hasParts ? "No factory line answers it as a whole yet — see its parts below." : "No factory has answered this item yet."}</p>
                ) : (
                  <div className="rounded-lg border border-line">
                    <Table>
                      <THead>
                        <tr>
                          <Th>Factory line</Th>
                          <Th className="text-right">Their price</Th>
                          <Th className="text-right">Your cost / unit</Th>
                          <Th className="hidden text-right sm:table-cell">For their quantity</Th>
                        </tr>
                      </THead>
                      <tbody>
                        {it.options.map((o) => (
                          <Tr key={o.id}>
                            <Td>
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{o.factory.name}</span>
                                {o.id === it.cheapestLineId && it.options.length > 1 && <Badge tone="ok">Cheapest</Badge>}
                              </span>
                              <span className="block text-xs text-muted">
                                {o.no} {o.description.split("\n")[0]}
                                {o.model ? ` · ${o.model}` : ""}
                              </span>
                              <span className="mt-0.5 block text-xs text-text-2">{o.costNote}</span>
                            </Td>
                            <Td className="text-right whitespace-nowrap tabular">
                              {money(o.unitPrice, o.currency)}
                              <span className="block text-xs text-muted">without tax</span>
                            </Td>
                            <Td className="text-right font-medium whitespace-nowrap tabular">
                              {Number(o.unitPrice) === 0 ? (
                                <span className="text-xs font-normal text-muted">Not priced on its own</span>
                              ) : o.unitCost === null ? (
                                <span className="text-xs font-normal text-warn">No exchange rate</span>
                              ) : (
                                money(o.unitCost, s.currency)
                              )}
                            </Td>
                            <Td className="hidden text-right whitespace-nowrap text-text-2 tabular sm:table-cell">
                              {o.unitCost === null ? "—" : `${formatMinor(multiplyMinor(toMinor(o.unitCost), o.quantity), s.currency)} (${qty(o.quantity)} ${o.unit})`}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </section>
            ))}
          </CardBody>
        </Card>
      )}

      <FactoryQuotes
        quotes={s.quotes}
        items={s.items}
        canEdit={canEdit}
        today={todayIn(TZ)}
        mainCurrency={s.currency}
        rates={settings.sales.exchangeRates}
        saveAction={saveFactoryQuoteAction.bind(null, d.id)}
        removeAction={removeFactoryQuoteAction.bind(null, d.id)}
        searchFactories={searchFactoriesAction}
      />
    </div>
  );
}
