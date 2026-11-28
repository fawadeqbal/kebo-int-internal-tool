import Link from "next/link";
import { EditRequestWindow } from "../inquiry-windows";
import { can, INQUIRY_STAGE_LABEL, LOST_REASON_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, RefCode, Notice } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import { dealHistoryOf, dealOf, quotationOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { shortName } from "@/components/deals/offer-facts";
import { holdAction, moveStageAction } from "../actions";
import { DecisionButtons } from "./panels";
import { ItemsCard } from "./items-card";
import { FilesCard, RequestBoxes } from "./request-card";
import { WithSide } from "./side";
import { inquiryTitle } from "@/lib/titles";
import { editsOf } from "@/lib/edit-data";

export const generateMetadata = inquiryTitle();

/**
 * The inquiry's Overview (design rules 18 Nov): the request in the boxes of its steps — Customer, Details, Items,
 * Files — each with its own Edit (that part only). On
 * hold or lost: why, first; once won: the deal that was made. Beside it, the panel every tab has. (How far it
 * has got is in the header and the tabs: Supplier offers 2 · Quotations R1 sent.)
 */
export default async function DealOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ panel?: string; id?: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage");
  const history = d.onHold ? await optional(() => dealHistoryOf(id)) : null;

  // On hold, or lost: what holds it or why it was lost, with the way back, in the one notice.
  const lastHold = d.onHold ? (history ?? []).find((e) => /hold/i.test(e.summary ?? e.action)) : null;
  const state = d.onHold ? (
    <Notice
      tone="info"
      title={`On hold${lastHold ? ` since ${date(lastHold.at)}` : ""}.`}
      action={
        d.canWork && d.allowed.hold ? (
          <DecisionButtons stage={d.stage} onHold canHold canReopen={false} only="hold" stageAction={moveStageAction.bind(null, d.id)} holdAction={holdAction.bind(null, d.id)} />
        ) : undefined
      }
    >
      Reminders are paused. The stage stays “{INQUIRY_STAGE_LABEL[d.stage]}”.
    </Notice>
  ) : d.stage === "lost" ? (
    <Notice
      tone="bad"
      title={`Lost${d.closedAt ? ` on ${date(d.closedAt)}` : ""}${d.lostReason ? ` · ${LOST_REASON_LABEL[d.lostReason]}` : ""}.`}
      action={
        d.canWork && d.allowed.reopen ? (
          <DecisionButtons stage={d.stage} onHold={false} canHold={false} canReopen stageAction={moveStageAction.bind(null, d.id)} holdAction={holdAction.bind(null, d.id)} />
        ) : undefined
      }
    >
      {d.allowed.reopen ? "A manager can reopen it and quote again." : "Ask a manager to reopen it if they come back."}
    </Notice>
  ) : null;

  const order = d.orders.find((o) => o.status !== "cancelled");

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
      {order && d.stage === "won" && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Accepted quotation" />
            <CardBody className="flex flex-col gap-2 text-sm">
              {opt && row("Accepted", `R${rev!.number} · Option ${opt.letter}${opt.supplier ? ` · ${shortName(opt.supplier.name)}` : ""}`)}
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
              {opt?.supplier && (
                <div>
                  <span className="block text-xs text-muted">Purchase order</span>
                  <Link href={`/orders/${order.id}/supplier`} className="text-text hover:underline">
                    {opt.supplier.name}
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

      {/* The request in the boxes of its steps (design rules 18 Nov): Customer · Details, then Items, then Files. */}
      <RequestBoxes d={d} edits={await editsOf("inquiry", id)} />

      <ItemsCard id={id} />
      <FilesCard d={d} />
      {(await searchParams).panel === "edit-request" && <EditRequestWindow d={d} step={(await searchParams).id} />}
    </WithSide>
  );
}
