import { notFound } from "next/navigation";
import { can, DELIVERY_CONDITION_LABEL } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { date } from "@/lib/format";
import { ClaimsPanel, DeliveryPanel, SatPanel } from "@/components/orders/flow-panels";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { KeyFacts, StepChanges, StepFiles, StepPage } from "@/components/orders/step-page";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { addClaimAction, deliveryAction, satAction, updateClaimAction } from "../../flow-actions";
import { stageTool } from "../close-tool";
import { stepData } from "../step-data";

export const metadata = { title: "Order · delivery and SAT" };

/** Step 6, Delivery & SAT: delivery and its condition, the site acceptance test by our engineer, any claims, and closing the order. */
export default async function OrderDelivery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "delivery");
  const { me, o, flow, now } = d;
  if (!flow?.delivery) notFound();
  const dv = flow.delivery;
  const canEdit = can(me, "delivery.manage") && d.open;
  const arrived =
    flow.shipping?.shipments
      .map((s) => s.arrivedOn)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;

  const tools: Record<string, AutoTool> = {};
  if (canEdit)
    tools.delivered = {
      kind: "delivery",
      label: "Record the delivery",
      action: deliveryAction.bind(null, o.id),
      d: dv,
      people: d.people,
      today: now,
    };
  tools.sat_done = { kind: "link", label: canEdit ? "Open the SAT" : "See the SAT", href: "#sat" };
  tools.claims_closed = { kind: "link", label: "Claims", href: "#claims" };
  const close = stageTool(me, o, "done", now);
  if (close) tools.closed = { kind: "node", node: close };

  return (
    <StepPage
      steps={d.steps}
      step="delivery"
      base={d.base}
      side={
        <>
          <KeyFacts
            facts={[
              { label: "Delivered", value: dv.deliveredOn ? date(dv.deliveredOn) : "Not yet" },
              { label: "Condition", value: dv.condition ? DELIVERY_CONDITION_LABEL[dv.condition] : null },
              { label: "Our engineer", value: dv.satEngineer?.name ?? null },
              { label: "SAT planned", value: dv.satPlannedOn ? date(dv.satPlannedOn) : null },
              { label: "SAT signed off", value: dv.satDoneOn ? date(dv.satDoneOn) : null },
              { label: "Open claims", value: String(dv.claims.filter((c) => c.status === "open" || c.status === "with_factory").length) },
            ]}
          />
          <StepCosts id={o.id} step="delivery" />
          <StepFiles items={d.items} addHref={d.steps.canEdit ? `${d.base}/documents#files` : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="delivery"
        label="Delivery & SAT"
        items={d.items}
        current={d.current}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        listHref={d.listHref}
      />
      <Card>
        <CardHeader title="Delivery and site acceptance" description={o.customer.name} />
        <CardBody>
          <DeliveryPanel
            action={deliveryAction.bind(null, o.id)}
            d={dv}
            people={d.people}
            arrivedOn={arrived}
            today={now}
            canEdit={canEdit}
          />
        </CardBody>
      </Card>
      <Card id="sat" className="scroll-mt-24">
        <CardHeader
          title="SAT checklist"
          description={
            dv.satDoneOn ? "Signed off; reopen the SAT to change it." : "What our engineer checks on site, from the customer's URS."
          }
        />
        <CardBody>
          <SatPanel
            action={satAction.bind(null, o.id)}
            checks={dv.sat}
            suggested={dv.suggestedSat}
            locked={!!dv.satDoneOn}
            canEdit={canEdit}
          />
        </CardBody>
      </Card>
      <Card id="claims" className="scroll-mt-24">
        <CardHeader title="Claims" description="Damage, missing parts or faults after delivery, and how each was settled." />
        <CardBody>
          <ClaimsPanel
            addAction={addClaimAction.bind(null, o.id)}
            updateActions={Object.fromEntries(dv.claims.map((c) => [c.id, updateClaimAction.bind(null, o.id, c.id)]))}
            claims={dv.claims}
            today={now}
            canEdit={canEdit}
          />
        </CardBody>
      </Card>
    </StepPage>
  );
}
