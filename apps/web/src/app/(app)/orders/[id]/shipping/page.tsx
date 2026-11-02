import { Plus } from "lucide-react";
import { can, SHIP_MODE_LABEL, SHIP_MODES, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUSES } from "@kebo/shared";
import { Badge, Card, CardHeader } from "@kebo/ui";
import { date } from "@/lib/format";
import type { ShipmentView } from "@/lib/types-flow";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { StepChanges, StepFiles, StepPage, StepViewDivider, ViewPair } from "@/components/orders/step-page";
import { DetailsCard, FieldsForm, PanelButton, type DetailField } from "@/components/orders/step-view";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { packingAction, packingMarksAction, paymentAction } from "../../actions";
import { fieldsAction, lightAction } from "../../light-actions";
import { PaymentForm } from "../forms";
import { PackingCard } from "../goods";
import { docHref, goodsOf } from "../shared";
import { stageTool } from "../close-tool";
import { stepData } from "../step-data";
import { StepPapers } from "../papers";

export const metadata = { title: "Order · shipping" };

const LOADED = ["loaded", "departed", "arrived", "cleared"];
const SAILED = ["departed", "arrived", "cleared"];

/** A shipment's values for its card and its Edit panel (board OrderV4ShippingEdit), grouped as the panel shows them. */
function shipmentFields(s: Partial<ShipmentView>, shipBy: string | null): DetailField[] {
  const air = s.mode === "air";
  const ports = s.portOfLoading || s.portOfDischarge ? `${s.portOfLoading ?? "?"} → ${s.portOfDischarge ?? "?"}` : null;
  const container = [s.containerType, s.containerNo].filter(Boolean).join(" · ") || null;
  const out: DetailField[] = [
    {
      name: "mode",
      label: "Way",
      value: s.mode ?? "sea",
      show: SHIP_MODE_LABEL[s.mode ?? "sea"],
      type: "select",
      options: SHIP_MODES.map((m) => ({ value: m, label: SHIP_MODE_LABEL[m] })),
      group: "Way and ports",
    },
    {
      name: "status",
      label: "Status",
      value: s.status ?? "planned",
      type: "select",
      options: SHIPMENT_STATUSES.map((m) => ({ value: m, label: SHIPMENT_STATUS_LABEL[m] })),
      group: "Way and ports",
      panelOnly: true,
      hint: "Moves on by itself as the dates come in",
    },
    { label: "From → to", value: ports, cardOnly: true },
    { name: "portOfLoading", label: "From", value: s.portOfLoading, group: "Way and ports", panelOnly: true, placeholder: air ? "e.g. Shanghai PVG" : "e.g. Ningbo" },
    { name: "portOfDischarge", label: "To", value: s.portOfDischarge, group: "Way and ports", panelOnly: true, placeholder: air ? "e.g. Lahore LHE" : "e.g. Karachi" },
    { name: "forwarder", label: "Forwarder", value: s.forwarder, group: "Forwarder and booking" },
    { name: "bookingNo", label: "Booking no.", value: s.bookingNo, group: "Forwarder and booking" },
  ];
  if (!air)
    out.push(
      { name: "containerType", label: "Container", value: s.containerType, group: "Container", panelOnly: true, placeholder: "e.g. 1 × 40 HQ" },
      { name: "containerNo", label: air ? "Container" : "Container", value: s.containerNo, show: container, group: "Container", cardOnly: false },
      { name: "sealNo", label: "Seal no.", value: s.sealNo, group: "Container", placeholder: "e.g. 0048812" },
      { name: "loadedOn", label: "Loaded on", value: s.loadedOn, type: "date", group: "Container", panelOnly: true },
      { name: "vgmKg", label: "Gross weight (VGM), kg", value: s.vgmKg, type: "number", group: "Container", panelOnly: true, uncounted: true },
      { name: "vessel", label: "Vessel", value: s.vessel, group: "Vessel and B/L", placeholder: "e.g. MSC Aurora" },
    );
  out.push(
    { name: "blNo", label: air ? "AWB no." : "B/L no.", value: s.blNo, group: air ? "Air waybill" : "Vessel and B/L", placeholder: air ? "e.g. 999-12345675" : "e.g. MEDU1234567" },
    { name: "etd", label: "ETD", value: s.etd, type: "date", group: "Dates" },
    { name: "eta", label: "ETA", value: s.eta, type: "date", group: "Dates" },
    { label: "Ship by (LC)", value: shipBy, show: shipBy ? date(shipBy) : null },
  );
  if (!air) out.push({ label: "Loaded on", value: s.loadedOn, show: s.loadedOn ? date(s.loadedOn) : null, name: "loadedOn", type: "date", cardOnly: true });
  out.push(
    { name: "departedOn", label: air ? "Flown on" : "Sailed on", value: s.departedOn, type: "date", group: "Dates" },
    { name: "arrivedOn", label: "Arrived on", value: s.arrivedOn, type: "date", group: "Dates", uncounted: !SAILED.includes(s.status ?? "") , panelOnly: !SAILED.includes(s.status ?? "") },
    { name: "note", label: "Note", value: s.note, type: "textarea", group: "Note", panelOnly: true, uncounted: true, wide: true },
  );
  // Dates show as people read them.
  return out.map((f) => (f.type === "date" && f.value && !f.show ? { ...f, show: date(f.value) } : f));
}

/** Step 4, Shipping: booking, loading, sailing and arrival of each shipment, the packing list, and the balance when it is paid before or against the B/L. */
export default async function OrderShipping({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "shipping");
  const { me, o, flow, now, defaults } = d;
  const shipping = flow?.shipping ?? null;
  const shipments = shipping?.shipments ?? [];
  const canShip = can(me, "shipping.manage") && d.open;
  const canEdit = can(me, "orders.update") && d.open;
  const canPay = can(me, "payments.record") && d.open;
  const goods = goodsOf(o);
  const shipBy = flow?.payment.bankContract?.latestShipOn ?? o.shipBy;
  const totals = o.goods.totals;

  // Each light row works on the first shipment not past it (a new one when there is none).
  const tools: Record<string, AutoTool> = {};
  if (shipping && canShip) {
    const first = shipments[0];
    const at = (pred: (s: ShipmentView) => boolean) => shipments.find(pred) ?? first;
    const toBook = at((s) => s.status === "planned");
    const toLoad = at((s) => !LOADED.includes(s.status));
    const toSail = at((s) => !SAILED.includes(s.status));
    const fwd = toBook?.forwarder ?? defaults.forwarder?.name ?? "";
    tools.booked = {
      kind: "light",
      label: "Add the booking",
      action: lightAction.bind(null, o.id, `booked:${toBook?.id ?? "new"}`),
      fields: [
        {
          name: "forwarder",
          label: "Forwarder",
          value: fwd,
          required: true,
          hint: !toBook?.forwarder && defaults.forwarder ? `As on ${defaults.forwarder.refNo} (same ${defaults.forwarder.why})` : undefined,
        },
        { name: "bookingNo", label: "Booking no.", value: toBook?.bookingNo, required: true, placeholder: "e.g. NGB-77812" },
        { name: "etd", label: "ETD", type: "date", value: toBook?.etd, required: true },
      ],
      chips: [
        { label: "Container type", field: { name: "containerType", label: "Container", value: toBook?.containerType, placeholder: "e.g. 1 × 40 HQ" } },
        { label: "ETA", field: { name: "eta", label: "ETA", type: "date", value: toBook?.eta } },
        { label: "Booking copy", field: { name: "attachmentId", label: "Booking copy (PDF or photo)", type: "file" } },
        { label: "Note", field: { name: "itemNote", label: "Note", type: "textarea" } },
      ],
    };
    const air = toLoad?.mode === "air";
    tools.loaded = {
      kind: "light",
      label: air ? "Handed over today" : "Add the container",
      action: lightAction.bind(null, o.id, `loaded:${toLoad?.id ?? "new"}`),
      fields: air
        ? [{ name: "loadedOn", label: "Handed over on", type: "date", value: toLoad?.loadedOn ?? now, max: now, required: true }]
        : [
            { name: "containerNo", label: "Container no.", value: toLoad?.containerNo ?? o.goods.containerNo, required: true, placeholder: "e.g. MSKU 7741203" },
            { name: "loadedOn", label: "Loaded on", type: "date", value: toLoad?.loadedOn ?? now, max: now, required: true },
            { name: "sealNo", label: "Seal no.", value: toLoad?.sealNo, placeholder: "e.g. 0048812" },
          ],
      chips: [
        { label: "Loading photos", field: { name: "attachmentId", label: "Loading photos", type: "file" } },
        ...(air
          ? []
          : [
              {
                label: "Gross weight (VGM)",
                field: { name: "vgmKg", label: "VGM, kg", type: "number" as const, value: toLoad?.vgmKg ?? (Number(totals.grossWeightKg) > 0 ? totals.grossWeightKg : "") },
              },
            ]),
        { label: "Note", field: { name: "itemNote", label: "Note", type: "textarea" } },
      ],
      hint: air ? undefined : "Only the first two are needed to tick it.",
    };
    const sailAir = toSail?.mode === "air";
    tools.sailed = {
      kind: "light",
      label: sailAir ? "Add the AWB" : "Add B/L",
      action: lightAction.bind(null, o.id, `sailed:${toSail?.id ?? "new"}${sailAir ? ":air" : ""}`),
      fields: [
        { name: "blNo", label: sailAir ? "AWB no." : "B/L no.", value: toSail?.blNo ?? o.blNo, required: true, placeholder: sailAir ? "e.g. 999-12345675" : "e.g. MEDU1234567" },
        ...(sailAir ? [] : [{ name: "vessel", label: "Vessel", value: toSail?.vessel, required: true, placeholder: "e.g. MSC Aurora" }]),
        { name: "departedOn", label: sailAir ? "Flown on" : "Sailed on", type: "date" as const, value: toSail?.departedOn ?? now, max: now, required: true },
      ],
      chips: [
        { label: sailAir ? "AWB copy (PDF or photo)" : "B/L copy (PDF or photo)", field: { name: "attachmentId", label: sailAir ? "AWB copy" : "B/L copy", type: "file" } },
        { label: "Note", field: { name: "itemNote", label: "Note", type: "textarea" } },
      ],
      hint: "The copy is kept with the item and the paper set.",
    };
    const going = shipments.filter((s) => s.status !== "arrived" && s.status !== "cleared");
    if (going.length)
      tools.arrived = { kind: "tap", tap: { label: "Arrived today", action: lightAction.bind(null, o.id, `arrived:${going.map((s) => s.id).join(",")}`), on: now } };
  }
  if (goods.length)
    tools.packing_list = { kind: "link", label: o.goods.packed ? "See it" : canEdit ? "Make it" : "See it", href: canEdit ? "#edit-lines" : "#lines" };
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

  const showPacking = o.goods.allReceived || o.stage !== "confirmed";
  // A new shipment starts from the order's ports.
  const fresh: Partial<ShipmentView> = { mode: "sea", status: "planned", portOfLoading: o.incotermPlace, portOfDischarge: o.portOfDischarge };
  const addShipment =
    shipping && canShip ? (
      <PanelButton
        label={shipments.length === 1 ? "Split into two shipments" : "Add a shipment"}
        icon={shipments.length === 1 ? undefined : <Plus aria-hidden />}
        variant="ghost"
        title={shipments.length ? `Shipment ${shipments.length + 1}` : "The shipment"}
        description="A shipment of its own: its way, booking, container and dates. Saving adds it to the checklist."
        body={<FieldsForm action={fieldsAction.bind(null, o.id, "shipment:new")} fields={shipmentFields(fresh, shipBy)} save="Add the shipment" />}
      />
    ) : undefined;

  return (
    <StepPage
      steps={d.steps}
      step="shipping"
      base={d.base}
      action={shipments.length ? addShipment : undefined}
      side={
        <>
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
        me={me.name}
        today={now}
      />
      <StepViewDivider />
      {shipping ? (
        shipments.length ? (
          shipments.map((s, i) => (
            <DetailsCard
              key={s.id}
              id={i === 0 ? "shipments" : undefined}
              title={shipments.length > 1 ? `Shipment ${i + 1}` : "Shipment"}
              fields={shipmentFields(s, shipBy)}
              action={fieldsAction.bind(null, o.id, `shipment:${s.id}`)}
              canEdit={canShip}
              panelTitle={shipments.length > 1 ? `Edit shipment ${i + 1}` : "Edit the shipment"}
            />
          ))
        ) : (
          <DetailsCard
            id="shipments"
            title="Shipment"
            description={canShip ? "Not booked yet: + Add any value starts the shipment, from the order's ports." : "Not booked yet."}
            fields={shipmentFields(fresh, shipBy)}
            action={fieldsAction.bind(null, o.id, "shipment:new")}
            canEdit={canShip}
            panelTitle="The shipment"
          />
        )
      ) : (
        <DetailsCard
          id="shipments"
          title="Shipping"
          fields={[
            { name: "portOfDischarge", label: "To", value: o.portOfDischarge },
            { name: "shippedOn", label: "Shipped on", value: o.shippedOn, type: "date", max: now, show: o.shippedOn ? date(o.shippedOn) : null },
            { name: "blNo", label: "B/L no.", value: o.blNo },
            { name: "containerNo", label: "Container no.", value: o.goods.containerNo },
            { name: "shipBy", label: "Ship by", value: o.shipBy, type: "date", show: o.shipBy ? date(o.shipBy) : null },
          ]}
          action={fieldsAction.bind(null, o.id, "order")}
          canEdit={canEdit}
          panelTitle="Edit shipping"
        />
      )}
      {goods.length > 0 &&
        (showPacking ? (
          <div id="lines" className="scroll-mt-24">
            <PackingCard
              toggle
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
          </div>
        ) : (
          <Card id="lines" className="scroll-mt-24">
            <CardHeader
              title="Lines · packing"
              description="Opens once production has started, for the packages, weights and volume of each line."
              actions={<Badge tone="warn">Not made yet</Badge>}
            />
          </Card>
        ))}
      <ViewPair>
        <StepPapers id={o.id} dealId={o.inquiry.id} step="shipping" />
        <StepCosts id={o.id} step="shipping" />
      </ViewPair>
    </StepPage>
  );
}
