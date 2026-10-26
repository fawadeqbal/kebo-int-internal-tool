import Link from "next/link";
import { multiplyMinor, toMinor, formatMinor } from "@kebo/money";
import { Alert, Badge, Card, CardBody, CardHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import { money, qty } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { SalesSettings, SourcingView } from "@/lib/types-deals";
import { ChoosePrice, FactoryQuotes } from "@/components/deals/sourcing-board";
import { choosePriceAction, removeFactoryQuoteAction, saveFactoryQuoteAction, searchFactoriesAction } from "./actions";

export const metadata = { title: "Factory prices" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

/**
 * Every factory price for the deal: per requested item the offers cheapest
 * first (landed cost in the selling currency), which one the quotation starts
 * from, and the offers themselves.
 */
export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [d, s, settings] = await Promise.all([load(() => api.get<DealDetail>(`/inquiries/${id}`)), load(() => api.get<SourcingView>(`/inquiries/${id}/sourcing`)), api.get<{ sales: SalesSettings }>("/settings")]);
  const canEdit = d.allowed.source;
  const choose = choosePriceAction.bind(null, d.id);
  const priced = s.items.filter((i) => i.options.some((o) => o.unitCost !== null)).length;

  return (
    <div className="flex flex-col gap-5">
      {!canEdit && <Alert tone="info">{d.stage === "won" || d.stage === "lost" ? "This deal is closed, so its factory prices can no longer change." : "Only the person handling this deal (or a manager) can change its factory prices."}</Alert>}
      {s.missingRates.length > 0 && (
        <Alert tone="warning">
          There is no exchange rate for {s.missingRates.join(", ")} in Settings, so those prices cannot be turned into {s.currency} and are left out of the comparison. Ask an admin to add the rate (1 {s.currency} = ? {s.missingRates[0]}).
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Compare by item"
          description={`Your cost per unit in ${s.currency}: the factory price plus its tax. ${priced} of ${s.items.length} item${s.items.length === 1 ? "" : "s"} priced.`}
          actions={
            priced > 0 ? (
              <Link href={`/deals/${d.id}/quotation`} className="text-sm font-medium text-primary hover:underline">
                Go to the quotation →
              </Link>
            ) : undefined
          }
        />
        <CardBody className="flex flex-col gap-5">
          {s.items.map((it, n) => {
            const preferred = it.preferredLineId ?? null;
            return (
              <section key={it.id} aria-label={`Item ${n + 1}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="min-w-0 text-sm font-semibold">
                    <span className="mr-1.5 text-muted">{n + 1}.</span>
                    <span className="whitespace-pre-line">{it.description}</span>
                    {it.model && <span className="ml-2 text-xs font-normal text-muted">{it.model}</span>}
                  </h3>
                  <span className="text-sm text-muted tabular">
                    {qty(it.quantity)} {it.unit}
                  </span>
                </div>
                {it.options.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">No factory price for this item yet.</p>
                ) : (
                  <div className="rounded-lg border border-line">
                    <Table>
                      <THead>
                        <tr>
                          <Th>Factory</Th>
                          <Th className="text-right">Their price</Th>
                          <Th className="text-right">Your cost / unit</Th>
                          <Th className="hidden text-right sm:table-cell">For {qty(it.quantity)} {it.unit}</Th>
                          <Th className="relative text-right">
                            <span className="sr-only">Choice</span>
                          </Th>
                        </tr>
                      </THead>
                      <tbody>
                        {it.options.map((o) => (
                          <Tr key={o.id} className={o.id === preferred ? "bg-primary-soft/30" : undefined}>
                            <Td>
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{o.factory.name}</span>
                                {o.id === it.cheapestLineId && it.options.length > 1 && <Badge tone="ok">Cheapest</Badge>}
                              </span>
                              {o.model && <span className="block text-xs text-muted">{o.model}</span>}
                              <span className="mt-0.5 block text-xs text-text-2">{o.costNote}</span>
                            </Td>
                            <Td className="text-right whitespace-nowrap tabular">
                              {money(o.unitPrice, o.currency)}
                              <span className="block text-xs text-muted">without tax</span>
                            </Td>
                            <Td className="text-right font-medium whitespace-nowrap tabular">{o.unitCost === null ? <span className="text-xs font-normal text-warn">No exchange rate</span> : money(o.unitCost, s.currency)}</Td>
                            <Td className="hidden text-right whitespace-nowrap sm:table-cell text-text-2 tabular">{o.unitCost === null ? "—" : formatMinor(multiplyMinor(toMinor(o.unitCost), it.quantity), s.currency)}</Td>
                            <Td className="text-right">{canEdit ? <ChoosePrice action={choose} itemId={it.id} lineId={o.id} chosen={o.id === preferred} /> : o.id === preferred ? <Badge tone="primary">Quoting from this</Badge> : null}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </section>
            );
          })}
        </CardBody>
      </Card>

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
