import Link from "next/link";
import { EditRequestWindow } from "../inquiry-windows";
import { can, CHANNEL_LABEL, INQUIRY_STAGE_LABEL, LOST_REASON_LABEL, PRIORITY_LABEL, REVISION_STATUS_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, cn, RefCode } from "@kebo/ui";
import { DetailsCard } from "@/components/common/record";
import { requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import { dealHistoryOf, dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { shortName } from "@/components/deals/offer-facts";
import { holdAction, moveStageAction } from "../actions";
import { DecisionButtons } from "./panels";
import { offerFactsOf } from "./facts";
import { ItemsCard } from "./items-card";
import { WithSide } from "./side";
import { revisionsOf } from "./steps";

export const metadata = { title: "Inquiry" };

/**
 * The inquiry's Overview: where it stands in three lines (the factory offers, the quotation, the sales
 * order: each a link to its tab), the request as the customer made it, and the items they asked for. Once
 * won: the deal that was made. Beside it, the panel every tab has.
 */
export default async function DealOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ panel?: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage");
  const [history, facts, s] = await Promise.all([d.onHold ? optional(() => dealHistoryOf(id)) : null, sourcing ? offerFactsOf(id) : null, sourcing ? sourcingOf(id).catch(() => null) : null]);
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts[0];
  const base = `/inquiries/${d.id}`;

  // On hold, or lost: what holds it or why it was lost, with the way back.
  const lastHold = d.onHold ? (history ?? []).find((e) => /hold/i.test(e.summary ?? e.action)) : null;
  const state = d.onHold ? (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-5 py-4">
      <div>
        <strong>On hold{lastHold ? ` since ${date(lastHold.at)}` : ""}.</strong>
        <span className="block text-sm text-text-2">Reminders are paused. The stage stays “{INQUIRY_STAGE_LABEL[d.stage]}”.</span>
      </div>
      {d.canWork && d.allowed.hold && (
        <DecisionButtons stage={d.stage} onHold canHold canReopen={false} only="hold" stageAction={moveStageAction.bind(null, d.id)} holdAction={holdAction.bind(null, d.id)} />
      )}
    </section>
  ) : d.stage === "lost" ? (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bad/25 bg-bad-soft px-5 py-4">
      <div>
        <strong className="text-bad">
          Lost{d.closedAt ? ` on ${date(d.closedAt)}` : ""}
          {d.lostReason ? ` · ${LOST_REASON_LABEL[d.lostReason]}` : ""}.
        </strong>
        <span className="block text-sm text-text-2">{d.allowed.reopen ? "A manager can reopen it and quote again." : "Ask a manager to reopen it if they come back."}</span>
      </div>
      {d.canWork && d.allowed.reopen && (
        <DecisionButtons stage={d.stage} onHold={false} canHold={false} canReopen stageAction={moveStageAction.bind(null, d.id)} holdAction={holdAction.bind(null, d.id)} />
      )}
    </section>
  ) : null;

  // Where it stands: one line per document, each the way to its tab.
  const latest = revisionsOf(d)[0];
  const order = d.orders.find((o) => o.status !== "cancelled");
  const offerFact = s?.quotes.length
    ? [...s.quotes.map((q) => `${shortName(q.factory.name)} ${money(q.factoryTotal, q.currency)}`), ...(facts?.waiting ?? []).map((w) => `${shortName(w.name)} not answered`)].join(" · ")
    : facts?.waiting.length
      ? `Asked: ${facts.waiting.map((w) => shortName(w.name)).join(", ")}`
      : "Nobody asked yet";
  const offerStatus = !facts
    ? null
    : facts.waiting.length
      ? { text: facts.waiting.length === 1 ? "Waiting for one" : `Waiting for ${facts.waiting.length}`, tone: "text-action" }
      : facts.offers
        ? { text: "All in", tone: "text-ok" }
        : { text: "Not started", tone: "text-text-2" };
  const lines: { kind: string; number: React.ReactNode; status: string; tone: string; fact: string; amount?: string }[] = [
    ...(facts && offerStatus
      ? [
          {
            kind: "Factory offers",
            number: (
              <Link href={`${base}/sourcing`} className="font-semibold text-primary hover:underline">
                {facts.asked > facts.offers ? `${facts.answered} of ${facts.asked} in` : facts.offers ? `${facts.offers} in` : "Open"}
              </Link>
            ),
            status: offerStatus.text,
            tone: offerStatus.tone,
            fact: offerFact,
          },
        ]
      : []),
    {
      kind: "Quotation",
      number: d.quotation ? (
        <Link href={`${base}/quotation`} className="font-semibold text-primary hover:underline">
          {d.quotation.refNo}
        </Link>
      ) : (
        <span className="text-muted">—</span>
      ),
      status: latest ? `R${latest.number} ${REVISION_STATUS_LABEL[latest.status].toLowerCase()}` : "Not made",
      tone: !latest ? "text-text-2" : latest.status === "accepted" ? "text-ok" : latest.status === "draft" || latest.status === "sent" ? "text-action" : "text-text-2",
      fact: latest ? `valid until ${date(latest.validUntil)}${latest.sentOn ? ` · sent ${date(latest.sentOn)}` : ""}` : "Made from a factory offer, with your prices",
      amount: latest ? `${latest.totalUpTo ? "from " : ""}${money(latest.total, latest.currency)}` : undefined,
    },
    {
      kind: "Sales order",
      number: order ? (
        <Link href={`/orders/${order.id}`} className="font-semibold text-primary hover:underline">
          {order.refNo}
        </Link>
      ) : (
        <span className="text-muted">—</span>
      ),
      status: order ? `Made ${date(order.orderedOn)}` : "Not yet",
      tone: order ? "text-ok" : "text-text-2",
      fact: order ? (order.customerRef ? `Customer ref. ${order.customerRef}` : "The work continues on the order") : "Made when the customer accepts an option",
      amount: order ? money(order.total, order.currency) : undefined,
    },
  ];

  // Won: the deal that was made (sale, planned cost and profit) and what was made from it.
  const q = order && d.stage === "won" ? await optional(() => quotationOf(id)) : null;
  const rev = q?.revisions.find((r) => r.status === "accepted");
  const opt = rev?.options.find((o) => o.status === "accepted") ?? rev?.options[0];
  const costing = sourcing ? opt?.costing : null;
  const c = rev?.currency ?? order?.currency ?? "";
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3">
      <span className="text-text-2">{label}</span>
      <strong className="text-right tabular">{value}</strong>
    </div>
  );

  return (
    <WithSide id={id}>
      {state}
      <Card className="overflow-clip">
        <CardHeader title="Where it stands" />
        <ul className="flex flex-col">
          {lines.map((l) => (
            <li key={l.kind} className="grid grid-cols-[110px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-0.5 border-t border-line px-5 py-3 text-sm first:border-t-0 sm:grid-cols-[110px_150px_150px_minmax(0,1fr)_auto]">
              <span className="text-text-2">{l.kind}</span>
              <span className="tabular">{l.number}</span>
              <span className={cn("font-semibold max-sm:col-start-2", l.tone)}>{l.status}</span>
              <span className="text-text-2 max-sm:col-start-2">{l.fact}</span>
              <span className="text-right font-semibold whitespace-nowrap tabular max-sm:col-start-2 max-sm:text-left">{l.amount ?? ""}</span>
            </li>
          ))}
        </ul>
      </Card>

      {order && d.stage === "won" && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="The deal" />
            <CardBody className="flex flex-col gap-2 text-sm">
              {opt && row("Accepted", `R${rev!.number} · Option ${opt.letter}${opt.factory ? ` · ${shortName(opt.factory.name)}` : ""}`)}
              {row("Sale", money(opt?.total ?? order.total, c))}
              {costing && row("Planned cost", money(costing.cost, c))}
              {costing && row("Planned profit", `${money(costing.profit, c)}${costing.marginPercent != null ? ` · ${costing.marginPercent.toFixed(1)}%` : ""}`)}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Made from it" />
            <CardBody className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="block text-xs text-muted">Sales order</span>
                <Link href={`/orders/${order.id}`} className="hover:opacity-80">
                  <RefCode>{order.refNo}</RefCode>
                </Link>
              </div>
              {opt?.factory && (
                <div>
                  <span className="block text-xs text-muted">Purchase order</span>
                  <Link href={`/orders/${order.id}/factory`} className="text-text hover:underline">
                    {opt.factory.name}
                  </Link>
                </div>
              )}
              {(rev?.options.filter((o) => o.id !== opt?.id) ?? []).map((o) => (
                <div key={o.id}>
                  <span className="block text-xs text-muted">Option {o.letter}</span>
                  <Badge>Not chosen</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      <DetailsCard
        title="The request"
        items={[
          {
            label: "Customer",
            value: (
              <Link href={`/customers/${d.customer.id}`} className="text-primary hover:underline">
                {d.customer.name}
              </Link>
            ),
          },
          { label: "Contact", value: contact ? [contact.name, contact.whatsapp ?? contact.phone ?? contact.email].filter(Boolean).join(" · ") : null },
          { label: "Came by", value: `${CHANNEL_LABEL[d.channel]} · ${date(d.createdAt)}` },
          { label: "Category", value: d.category },
          { label: "Priority", value: PRIORITY_LABEL[d.priority] },
          { label: "Needed by", value: d.requiredBy ? date(d.requiredBy) : null },
          { label: "What they need", value: d.requirements && <span className="whitespace-pre-line">{d.requirements}</span>, wide: true },
        ]}
        edit={d.allowed.edit ? { panel: "edit-request", label: "Edit the request" } : null}
      />

      <ItemsCard id={id} />
      {(await searchParams).panel === "edit-request" && <EditRequestWindow d={d} />}
    </WithSide>
  );
}
