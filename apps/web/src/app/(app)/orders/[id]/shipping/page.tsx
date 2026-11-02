import { can, SHIP_MODE_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader } from "@kebo/ui";
import { date } from "@/lib/format";
import { ShipmentsPanel } from "@/components/orders/flow-panels";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { KeyFacts, StepChanges, StepFiles, StepPage } from "@/components/orders/step-page";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { addShipmentAction, removeShipmentAction, updateShipmentAction } from "../../flow-actions";
import { packingAction, packingMarksAction, paymentAction } from "../../actions";
import { PaymentForm } from "../forms";
import { PackingCard } from "../goods";
import { docHref, goodsOf } from "../shared";
import { stageTool } from "../close-tool";
import { stepData } from "../step-data";
import { StepPapers } from "../papers";

export const metadata = { title: "Order · shipping" };

/** Step 4, Shipping: booking, loading, sailing and arrival of each shipment, the packing list, and the balance when it is paid before or against the B/L. */
export default async function OrderShipping({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "shipping");
  const { me, o, flow, now } = d;
  const shipping = flow?.shipping ?? null;
  const shipments = shipping?.shipments ?? [];
  const canShip = can(me, "shipping.manage") && d.open;
  const canEdit = can(me, "orders.update") && d.open;
  const canPay = can(me, "payments.record") && d.open;
  const goods = goodsOf(o);
  const defaults = {
    mode: "sea" as const,
    status: "planned" as const,
    portOfLoading: o.incotermPlace,
    portOfDischarge: o.portOfDischarge,
    blNo: o.blNo,
    containerNo: o.goods.containerNo,
  };

  const tools: Record<string, AutoTool> = {};
  if (shipping && canShip) {
    const first = shipments[0];
    const ship = (label: string): AutoTool =>
      first
        ? { kind: "shipment", label, action: updateShipmentAction.bind(null, o.id, first.id), shipment: first, today: now }
        : { kind: "shipment", label: "Add the shipment", action: addShipmentAction.bind(null, o.id), defaults, today: now };
    tools.booked = ship("Add the booking");
    tools.loaded = ship("Add the container");
    tools.sailed = ship(first?.mode === "air" ? "Add the AWB" : "Add the B/L");
    tools.arrived = ship("Mark arrived");
  }
  if (goods.length)
    tools.packing_list = { kind: "link", label: o.goods.packed ? "Edit" : canEdit ? "Make it" : "See it", href: "#lines" };
  if (canPay && Number(o.money.due) > 0)
    tools.balance_in = {
      kind: "node",
      node: (
        <PaymentForm
          quiet
          label="Record payment"
          action={paymentAction.bind(null, o.id, o.currency)}
          currency={o.currency}
          depositDue={o.money.depositDue}
          due={o.money.due}
          today={now}
        />
      ),
    };
  const shipped = stageTool(me, o, "shipped", now);
  if (shipped) tools.shipped = { kind: "node", node: shipped };
  const close = stageTool(me, o, "done", now);
  if (close) tools.closed = { kind: "node", node: close };

  const s = shipments[0];
  const showPacking = o.goods.allReceived || o.stage !== "confirmed";
  return (
    <StepPage
      steps={d.steps}
      step="shipping"
      base={d.base}
      side={
        <>
          <KeyFacts
            editHref={canEdit ? `${d.base}#details` : undefined}
            facts={[
              {
                label: "Way",
                value: s
                  ? `${SHIP_MODE_LABEL[s.mode]}${s.portOfLoading || s.portOfDischarge ? `, ${s.portOfLoading ?? "?"} → ${s.portOfDischarge ?? "?"}` : ""}`
                  : (o.portOfDischarge ?? null),
              },
              ...(shipping
                ? [
                    { label: "Forwarder", value: s?.forwarder ?? null },
                    { label: "Booking no.", value: s?.bookingNo ?? null },
                    { label: "Container", value: s?.containerNo ?? o.goods.containerNo },
                  ]
                : []),
              { label: "ETD / ETA", value: s && (s.etd || s.eta) ? `${s.etd ? date(s.etd) : "?"} / ${s.eta ? date(s.eta) : "?"}` : null },
              { label: "Ship by", value: o.shipBy ? date(o.shipBy) : null },
              { label: "B/L", value: s?.blNo ?? o.blNo },
            ]}
          />
          <StepCosts id={o.id} step="shipping" />
          <StepPapers id={o.id} dealId={o.inquiry.id} step="shipping" />
          <StepFiles items={d.items} addHref={d.steps.canEdit ? `${d.base}/documents#files` : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="shipping"
        label="Shipping"
        items={d.items}
        current={d.current}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        listHref={d.listHref}
      />
      {shipping && (
        <Card id="shipments" className="scroll-mt-24">
          <CardHeader
            title={shipments.length ? `Shipments · ${shipments.length}` : "Shipments"}
            description="The way, the ports, the container and the dates from booked to arrived."
          />
          <CardBody>
            <ShipmentsPanel
              addAction={addShipmentAction.bind(null, o.id)}
              updateActions={Object.fromEntries(shipments.map((x) => [x.id, updateShipmentAction.bind(null, o.id, x.id)]))}
              removeActions={Object.fromEntries(shipments.map((x) => [x.id, removeShipmentAction.bind(null, o.id, x.id)]))}
              shipments={shipments}
              defaults={defaults}
              today={now}
              canEdit={canShip}
            />
          </CardBody>
        </Card>
      )}
      {goods.length > 0 && (
        <div id="lines" className="scroll-mt-24">
          {showPacking ? (
            <PackingCard
              title="Lines · packing"
              description={o.goods.packed ? "The packing list paper is made from these lines." : "Packages, weights and volume for each line, before shipping."}
              badge={o.goods.packed ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">Not made yet</Badge>}
              orderId={o.id}
              lines={o.lines.filter((l) => l.type === "goods")}
              goods={goods}
              containerNo={o.goods.containerNo}
              shippingMarks={o.goods.shippingMarks}
              canEdit={canEdit}
              canUpload={canEdit && (o.stage === "confirmed" || o.stage === "in_production")}
              action={packingAction.bind(null, o.id)}
              marksAction={packingMarksAction.bind(null, o.id)}
              links={o.goods.packed || o.goods.totals.packages > 0 ? docHref(o, { kind: "packing-list", label: "Packing list" }) : undefined}
              today={now}
            />
          ) : (
            <Card>
              <CardHeader
                title="Lines · packing"
                description="Opens once production has started, for the packages, weights and volume of each line."
                actions={<Badge tone="warn">Not made yet</Badge>}
              />
            </Card>
          )}
        </div>
      )}
    </StepPage>
  );
}
