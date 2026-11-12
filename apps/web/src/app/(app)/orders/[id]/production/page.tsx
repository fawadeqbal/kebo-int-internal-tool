import { can } from "@kebo/shared";
import { Check } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, cn, StatRow, StatTile } from "@kebo/ui";
import { ProductionSteps } from "@/components/orders/production-steps";
import { productionStepsAction } from "../../flow-actions";
import { orderMoneyOf } from "@/lib/order-data";
import { date } from "@/lib/format";
import type { ChecklistItem } from "@/lib/types-checklist";
import { optional } from "@/components/print/data";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { StepPage, StepViewDivider } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { DetailsCard, LinesCard, type DetailField } from "@/components/orders/step-view";
import { expensePayTools } from "@/components/orders/costs-card";
import { RecordPaymentLink } from "@/components/money/pay-links";
import { OrderLines, OrderLinesEditor, PhoneLines } from "@/components/orders/order-lines";
import { editsOf } from "@/lib/edit-data";
import { fieldsAction, lightAction } from "../../light-actions";
import { GoodsExcel } from "../goods";
import { goodsOf } from "../shared";
import { stepData } from "../step-data";

export const metadata = { title: "Order · production" };

const DAY = 86_400_000;

/** What an own item (the factory test, the inspection) collected, as one plain line: "02 Jan · passed". */
function itemLine(item: ChecklistItem | undefined) {
  if (!item) return null;
  if (item.skipped) return `Skipped${item.skipReason ? `: ${item.skipReason}` : ""}`;
  const parts = item.data.map(([, v]) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? date(v) : v));
  return parts.length ? parts.join(" · ") : item.done ? "Done" : null;
}

/**
 * Step 3, Production: the checklist (the factory's milestones, the ready date,
 * paying the factory, goods in), then the view: production, the lines as they
 * come in from the factory, the papers and the costs.
 */
export default async function OrderProduction({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "production");
  const { me, o, flow, now, defaults } = d;
  const canEdit = can(me, "orders.update") && d.open;
  const m = await optional(() => orderMoneyOf(id));
  const owing = m?.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  // "Balance paid to the factory": Record payment with the plan's next part filled in.
  const nextPart = m?.factories?.plans.find((p) => p.next && Number(p.next.open) > 0) ?? null;
  // Money out is recorded on Treasury › Payments (one form); here it is a link, with the plan's part filled in.
  const payFactory = (label: string, prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance" }) =>
    m?.factories?.canRecord && owing.length && d.open ? (
      <RecordPaymentLink
        kind="out"
        order={o.id}
        factory={prefill?.factoryId}
        amount={prefill?.amount}
        part={prefill?.kind}
        back={`/orders/${o.id}/production`}
        label={label}
      />
    ) : null;
  const goods = goodsOf(o);
  const goodsLines = o.lines.filter((l) => l.type === "goods");

  const tools: Record<string, AutoTool> = {};
  if (canEdit)
    tools.ready_date = {
      kind: "light",
      label: "Set the date",
      action: lightAction.bind(null, o.id, "ready"),
      fields: [
        {
          name: "readyOn",
          label: "Ready on (the factory says)",
          type: "date",
          value: o.readyOn ?? defaults.leadTime?.readyOn ?? "",
          required: true,
          hint: !o.readyOn && defaults.leadTime?.readyOn ? `${defaults.leadTime.text} on the quote, from ${date(defaults.leadTime.from)}` : undefined,
        },
      ],
      save: "Save and tick",
      hint: "Change it when the factory gives another date.",
    };
  if (goods.length && canEdit && !o.goods.allReceived)
    tools.goods_received = {
      kind: "tap",
      tap: { label: "All received", action: lightAction.bind(null, o.id, "received_all"), on: now },
      also: { label: "Partly in? Open the lines", href: "#edit-lines" },
    };
  const balance = payFactory(
    nextPart ? `Pay ${nextPart.next!.label.toLowerCase()}` : "Pay the factory",
    nextPart ? { factoryId: nextPart.factory.id, amount: nextPart.next!.open, kind: "balance" } : undefined,
  );
  if (balance) tools.factory_paid = { kind: "node", node: balance };

  const left = o.readyOn ? Math.round((Date.parse(`${o.readyOn}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / DAY) : null;
  const factories = flow?.factory.factories ?? [];
  const plan = flow?.production ?? null;
  const own = d.items.filter((i) => !i.auto);
  const fat = own.find((i) => /\bFAT\b|test run/i.test(i.title));
  const inspection = own.find((i) => /inspection/i.test(i.title));
  const fields: DetailField[] = [
    { label: factories.length > 1 ? "Factories" : "Factory", value: factories.map((f) => f.name).join(", ") || null },
    {
      name: "readyOn",
      label: "Ready date",
      value: o.readyOn,
      type: "date",
      show: o.readyOn ? date(o.readyOn) : null,
      hint: defaults.leadTime ? `Lead time on the quote: ${defaults.leadTime.text}` : undefined,
    },
    {
      label: "Days left",
      value: left === null ? null : String(left),
      show: left === null ? null : left < 0 ? <span className="text-bad">{-left} late</span> : left,
      uncounted: true,
    },
    { name: "shipBy", label: "Ship by", value: o.shipBy, type: "date", show: o.shipBy ? date(o.shipBy) : null },
    ...(fat ? [{ label: "Factory test (FAT)", value: itemLine(fat) }] : []),
    ...(inspection ? [{ label: "Inspection", value: itemLine(inspection) }] : []),
  ];
  const edits = await editsOf("order", o.id);
  const ref = (card: string) => ({ type: "order" as const, id: o.id, card });

  return (
    <StepPage
      steps={d.steps}
      step="production"
      base={d.base}
      side={
        <>
          {plan && plan.steps.length > 0 && (
            <Card>
              <CardHeader title="Timeline" />
              <CardBody>
                <ol className="flex flex-col gap-3">
                  {plan.steps.map((st, i) => {
                    const current = !st.doneOn && plan.steps.findIndex((x) => !x.doneOn) === i;
                    return (
                      <li key={st.id} className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                            st.doneOn ? "bg-ok text-white" : current ? (st.late ? "bg-bad" : "bg-action-solid") : "bg-surface-3",
                          )}
                        >
                          {st.doneOn && <Check className="size-3.5" strokeWidth={3} />}
                        </span>
                        <span className="text-[13px]">
                          <strong className="block">{st.title}</strong>
                          <span className={cn("text-xs", st.late && !st.doneOn ? "text-bad" : "text-muted")}>
                            {st.doneOn ? `done ${date(st.doneOn)}` : st.plannedOn ? `${st.late ? "was planned" : "planned"} ${date(st.plannedOn)}` : "no date yet"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </CardBody>
            </Card>
          )}
          <StepSidePanel id={o.id} step="production" changes={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <StatRow>
        <StatTile label="Ready by" value={o.readyOn ? date(o.readyOn) : "—"} sub={o.readyOn ? "from the factory" : "not known yet"} />
        <StatTile label="Steps done" value={plan ? `${plan.steps.filter((x) => x.doneOn).length} of ${plan.steps.length}` : "—"} />
        <StatTile label="Days left" value={left === null ? "—" : left < 0 ? `${-left} late` : left} tone={left !== null && left < 0 ? "bad" : undefined} />
        <StatTile label="Late steps" value={plan ? plan.steps.filter((x) => x.late && !x.doneOn).length : 0} tone={plan?.steps.some((x) => x.late && !x.doneOn) ? "bad" : undefined} />
      </StatRow>
      {plan && (
        <ProductionSteps
          steps={plan.steps.map((st) => ({ id: st.id, title: st.title, factoryId: st.factory?.id ?? "", plannedOn: st.plannedOn ?? "", doneOn: st.doneOn ?? "", note: st.note ?? "" }))}
          suggested={plan.suggested}
          factories={factories}
          action={productionStepsAction.bind(null, o.id)}
          canEdit={canEdit}
          edit={ref("production.steps")}
          card={edits.cards["production.steps"]}
        />
      )}
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="production"
        label="Production"
        items={d.items}
        current={d.current}
        nowKey={d.nowKey}
        waits={d.waits}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        payNode={payFactory("Pay")}
        listHref={d.listHref}
        me={me.name}
        today={now}
      />
      <StepViewDivider />
      <DetailsCard
        target="production"
        title="Production"
        fields={fields}
        action={fieldsAction.bind(null, o.id, "factory")}
        canEdit={canEdit}
        panelTitle="Edit production"
        panelDescription="The ready date the factory gave and the ship date we promised. The test and the inspection are ticked in the checklist."
        edits={{ ref: ref("production"), card: edits.cards.production }}
      />
      {goods.length > 0 && (
        <LinesCard
          target="lines.received"
          title="Lines · from the factory"
          description={o.goods.allReceived ? "Everything has come in." : "What has come in so far on each line; the status follows."}
          canEdit={canEdit}
          view={<OrderLines set="received" orderId={o.id} lines={goodsLines} canEdit={false} today={now} />}
          edit={<OrderLinesEditor set="received" orderId={o.id} lines={goodsLines} today={now} edit={ref("lines.received")} card={edits.cards["lines.received"]} />}
          panelTitle="Edit lines · from the factory"
          panelDescription="What has come in on each line, and when. Nothing is saved until Save changes."
          edits={edits.cards["lines.received"]}
          phone={<PhoneLines set="received" lines={goodsLines} />}
          actions={
            <>
              {o.goods.allReceived && <Badge tone="ok">All in</Badge>}
              <GoodsExcel lines={goods} />
            </>
          }
        />
      )}
    </StepPage>
  );
}
