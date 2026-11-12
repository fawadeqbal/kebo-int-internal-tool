import { notFound } from "next/navigation";
import { can, DELIVERY_CONDITION_LABEL, SAT_RESULT_LABEL } from "@kebo/shared";
import { Badge, CardBody } from "@kebo/ui";
import { date } from "@/lib/format";
import { ClaimsPanel } from "@/components/orders/flow-panels";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { StepPage, StepViewDivider } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { DetailsCard, LinesCard, ViewCard, type DetailField } from "@/components/orders/step-view";
import { SatEdit } from "@/components/orders/view-panels";
import { expensePayTools } from "@/components/orders/costs-card";
import { addClaimAction, satAction, updateClaimAction } from "../../flow-actions";
import { fieldsAction, lightAction } from "../../light-actions";
import { OrderLines, OrderLinesEditor, PhoneLines } from "@/components/orders/order-lines";
import { editsOf } from "@/lib/edit-data";
import { DeliveredExcel } from "../goods";
import { stageTool } from "../close-tool";
import { stepData } from "../step-data";

export const metadata = { title: "Order · delivery and SAT" };

const RESULT_TONE = { pending: "neutral", pass: "ok", fail: "bad", not_applicable: "neutral" } as const;

/**
 * Step 6, Delivery & SAT: the checklist (delivered, SAT, claims, closing),
 * then the view: the delivery, the lines as delivered, the SAT results, the
 * claims, the papers and the costs.
 */
export default async function OrderDelivery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "delivery");
  const { me, o, flow, now } = d;
  if (!flow?.delivery) notFound();
  const dv = flow.delivery;
  const canEdit = can(me, "delivery.manage") && d.open;

  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const delivered = goodsLines.filter((l) => Number(l.delivered?.qty) >= Number(l.quantity)).length;
  const openClaims = dv.claims.filter((c) => c.status === "open" || c.status === "with_factory").length;

  const tools: Record<string, AutoTool> = {};
  if (canEdit) {
    tools.delivered = {
      kind: "tap",
      tap: { label: "All delivered OK", action: lightAction.bind(null, o.id, "delivered_all"), on: now },
      also: goodsLines.length ? { label: "Short or damaged? Open the lines", href: "#edit-lines" } : undefined,
    };
    tools.sat_done = {
      kind: "light",
      label: "Sign it off",
      action: lightAction.bind(null, o.id, "sat_all"),
      fields: [
        { name: "satSignedBy", label: "Signed for the customer by", value: dv.satSignedBy, required: true, placeholder: "e.g. Mr. Imran, QA head" },
        { name: "satDoneOn", label: "Passed on", type: "date", value: now, max: now, required: true },
      ],
      save: "All passed",
      hint: "Every open point passes. A point failed? Edit the SAT results below.",
      also: { label: "A point failed? Open the SAT", href: "#sat" },
    };
  } else tools.sat_done = { kind: "link", label: "See the SAT", href: "#sat" };
  tools.claims_closed = { kind: "link", label: "Claims", href: "#claims" };
  const close = stageTool(me, o, "done", now);
  if (close) tools.closed = { kind: "node", node: close };

  const day = (v: string | null) => (v ? date(v) : null);
  const fields: DetailField[] = [
    { name: "deliveredOn", label: "Delivered on", value: dv.deliveredOn, type: "date", max: now, show: day(dv.deliveredOn), group: "Delivery" },
    // Worked out from the goods lines (the worst of them): set on the lines below, or "All delivered OK".
    {
      label: "Condition",
      value: dv.condition,
      show: dv.condition ? `${DELIVERY_CONDITION_LABEL[dv.condition]} · from the lines` : null,
      hint: "From the goods lines (the worst of them): set it on the lines, or with All delivered OK.",
      group: "Delivery",
    },
    { name: "deliveryReceivedBy", label: "Received by", value: dv.receivedBy, group: "Delivery", placeholder: "e.g. Mr. Imran, stores" },
    { name: "satPlannedOn", label: "SAT planned", value: dv.satPlannedOn, type: "date", show: day(dv.satPlannedOn), group: "Site acceptance test" },
    { name: "satDoneOn", label: "SAT done", value: dv.satDoneOn, type: "date", max: now, show: day(dv.satDoneOn), group: "Site acceptance test" },
    {
      name: "satEngineerId",
      label: "Our engineer",
      value: dv.satEngineer?.id ?? null,
      type: "select",
      options: [{ value: "", label: "—" }, ...d.people.map((p) => ({ value: p.id, label: p.name }))],
      show: dv.satEngineer?.name ?? null,
      group: "Site acceptance test",
    },
    { name: "satSignedBy", label: "Signed by", value: dv.satSignedBy, group: "Site acceptance test", placeholder: "e.g. Mr. Ali, QA head" },
    { label: "Claims open", value: String(openClaims), uncounted: true },
    { name: "deliveryNote", label: "Note on the delivery", value: dv.note, type: "textarea", panelOnly: true, uncounted: true, wide: true, group: "Note" },
  ];
  const edits = await editsOf("order", o.id);
  const ref = (card: string) => ({ type: "order" as const, id: o.id, card });

  return (
    <StepPage
      steps={d.steps}
      step="delivery"
      base={d.base}
      side={<StepSidePanel id={o.id} step="delivery" changes={d.changes} historyHref={d.historyHref} />}
    >
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="delivery"
        label="Delivery & SAT"
        items={d.items}
        current={d.current}
        nowKey={d.nowKey}
        waits={d.waits}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        listHref={d.listHref}
        me={me.name}
        today={now}
      />
      <StepViewDivider />
      <DetailsCard
        target="delivery"
        title="Delivery"
        fields={fields}
        action={fieldsAction.bind(null, o.id, "delivery")}
        canEdit={canEdit}
        panelTitle="Edit the delivery"
        panelDescription="When it reached the customer, who received it, and the site acceptance test. Saving updates the checklist."
        actions={dv.condition ? <Badge tone={dv.condition === "good" ? "ok" : "warn"} dot>{`${DELIVERY_CONDITION_LABEL[dv.condition]} · from the lines`}</Badge> : undefined}
        edits={{ ref: ref("delivery"), card: edits.cards.delivery }}
      />
      {goodsLines.length > 0 && (
        <LinesCard
          target="lines.delivered"
          title="Lines · delivered"
          description={delivered === goodsLines.length ? "Everything reached the customer." : "How many of each line reached the customer, and in what condition."}
          canEdit={canEdit}
          view={<OrderLines set="delivered" orderId={o.id} lines={goodsLines} canEdit={false} today={now} />}
          edit={<OrderLinesEditor set="delivered" orderId={o.id} lines={goodsLines} today={now} edit={ref("lines.delivered")} card={edits.cards["lines.delivered"]} />}
          phone={<PhoneLines set="delivered" lines={goodsLines} />}
          actions={<DeliveredExcel lines={goodsLines} />}
          panelTitle="Edit lines · delivered"
          panelDescription="How many of each line reached the customer, and in what condition. Nothing is saved until Save changes."
          edits={edits.cards["lines.delivered"]}
        />
      )}
      <ViewCard
        id="sat"
        target="sat"
        title="SAT results"
        description={dv.satDoneOn ? `Signed off ${date(dv.satDoneOn)}${dv.satSignedBy ? ` by ${dv.satSignedBy}` : ""}.` : "What our engineer checks on site, from the customer's URS."}
        meter={dv.sat.length ? { n: dv.sat.filter((c) => c.result === "pass" || c.result === "not_applicable").length, of: dv.sat.length, word: "passed" } : undefined}
        canEdit={canEdit}
        panel={{
          title: "Edit the SAT points",
          description: "Each point: Pass, Fail or N/A, and a note. Saving updates the checklist.",
          body: <SatEdit action={satAction.bind(null, o.id)} checks={dv.sat} suggested={dv.suggestedSat} locked={!!dv.satDoneOn} />,
        }}
      >
        {dv.sat.length ? (
          <ul className="flex flex-col divide-y divide-line px-4">
            {dv.sat.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm">{c.item}</span>
                  {c.note && <span className="block text-xs text-muted">{c.note}</span>}
                </span>
                <Badge tone={RESULT_TONE[c.result]}>{SAT_RESULT_LABEL[c.result]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3.5 text-xs text-muted">
            No points yet. {dv.suggestedSat.length} usual points are ready to start from{canEdit ? " (Edit)" : ""}; &ldquo;All passed&rdquo; uses them.
          </p>
        )}
      </ViewCard>
      <ViewCard id="claims" target="claims" title="Claims" description="Damage, missing parts or faults after delivery, and how each was settled." canEdit={false}>
        <CardBody>
          <ClaimsPanel
            addAction={addClaimAction.bind(null, o.id)}
            updateActions={Object.fromEntries(dv.claims.map((c) => [c.id, updateClaimAction.bind(null, o.id, c.id)]))}
            claims={dv.claims}
            today={now}
            canEdit={canEdit}
          />
        </CardBody>
      </ViewCard>
    </StepPage>
  );
}
