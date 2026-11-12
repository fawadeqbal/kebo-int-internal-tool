import { Plus } from "lucide-react";
import { can, portsOf, SHIP_MODE_LABEL, SHIP_MODES, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUSES, shipByVsLc } from "@kebo/shared";
import { Badge } from "@kebo/ui";
import { date } from "@/lib/format";
import type { ShipmentView } from "@/lib/types-flow";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { StepPage, StepViewDivider } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { DetailsCard, FieldsForm, InlineFieldsCard, PanelButton, StatusBar, type DetailField } from "@/components/orders/step-view";
import { HeaderTap } from "@/components/orders/header-slot";
import { expensePayTools } from "@/components/orders/costs-card";
import { fieldsAction, lightAction } from "../../light-actions";
import { RecordPaymentLink } from "@/components/money/pay-links";
import { goodsOf } from "../shared";
import { stageTool } from "../close-tool";
import { stepData } from "../step-data";

export const metadata = { title: "Order · shipping" };

const LOADED = ["loaded", "departed", "arrived", "cleared"];
const SAILED = ["departed", "arrived", "cleared"];

/** Our ship-by and, on an LC order, the LC's latest shipment date: both shown, ours warned about when it is later. */
interface ShipBy {
  ours: string | null;
  lc: string | null;
  late: boolean;
}

/** The ship-by rows of a card: ours, and the LC's latest shipment date beside it (read-only here). */
function shipByFields(b: ShipBy): DetailField[] {
  return [
    {
      label: b.lc ? "Ship by (ours)" : "Ship by",
      value: b.ours,
      show: b.ours ? (
        b.late ? (
          <span className="flex flex-col">
            {date(b.ours)}
            <span className="text-xs font-medium text-bad">Later than the LC allows</span>
          </span>
        ) : (
          date(b.ours)
        )
      ) : null,
      uncounted: true,
    },
    ...(b.lc ? [{ label: "LC latest shipment", value: b.lc, show: date(b.lc), uncounted: true } satisfies DetailField] : []),
  ];
}

/** A shipment's values for its card and its Edit panel (board OrderV4ShippingEdit), grouped as the panel shows them. */
function shipmentFields(s: Partial<ShipmentView>, shipBy: ShipBy): DetailField[] {
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
      { name: "containerType", label: "Container type", value: s.containerType, group: "Container", panelOnly: true, placeholder: "e.g. 1 × 40 HQ" },
      { name: "containerNo", label: "Container", panelLabel: "Container no.", value: s.containerNo, show: container, group: "Container" },
      { name: "sealNo", label: "Seal no.", value: s.sealNo, group: "Container", placeholder: "e.g. 0048812" },
      { name: "loadedOn", label: "Loaded on", value: s.loadedOn, type: "date", group: "Container", panelOnly: true },
      { name: "vgmKg", label: "Gross weight (VGM), kg", value: s.vgmKg, type: "number", group: "Container", panelOnly: true, uncounted: true },
      { name: "vessel", label: "Vessel", value: s.vessel, group: "Vessel and B/L", placeholder: "e.g. MSC Aurora" },
    );
  out.push(
    { name: "blNo", label: air ? "AWB no." : "B/L no.", value: s.blNo, group: air ? "Air waybill" : "Vessel and B/L", placeholder: air ? "e.g. 999-12345675" : "e.g. MEDU1234567" },
    { name: "etd", label: "ETD", value: s.etd, type: "date", group: "Dates" },
    { name: "eta", label: "ETA", value: s.eta, type: "date", group: "Dates" },
    ...shipByFields(shipBy).map((f) => ({ ...f, cardOnly: true })),
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

/** The shipment's form on the page, in the board's order (OrderShipping): mode, status, forwarder, booking, B/L, vessel, ports, container, dates, note. */
function formFields(s: Partial<ShipmentView>): DetailField[] {
  const air = s.mode === "air";
  return [
    { name: "mode", label: "Mode", value: s.mode ?? "sea", type: "select", options: SHIP_MODES.map((m) => ({ value: m, label: SHIP_MODE_LABEL[m] })) },
    { name: "status", label: "Status", value: s.status ?? "planned", type: "select", options: SHIPMENT_STATUSES.map((m) => ({ value: m, label: SHIPMENT_STATUS_LABEL[m] })) },
    { name: "forwarder", label: "Forwarder", value: s.forwarder },
    { name: "bookingNo", label: "Booking no.", value: s.bookingNo },
    { name: "blNo", label: air ? "AWB no." : "B/L no.", value: s.blNo, placeholder: air ? "e.g. 999-12345675" : "e.g. MEDU1234567" },
    ...(air ? [] : [{ name: "vessel", label: "Vessel / voyage", value: s.vessel, placeholder: "e.g. MSC Aurora" } satisfies DetailField]),
    { name: "portOfLoading", label: air ? "Airport of departure" : "Port of loading", value: s.portOfLoading },
    { name: "portOfDischarge", label: air ? "Airport of arrival" : "Port of discharge", value: s.portOfDischarge },
    ...(air
      ? []
      : ([
          { name: "containerNo", label: "Container no.", value: s.containerNo },
          { name: "containerType", label: "Container type", value: s.containerType, placeholder: "e.g. 1 × 40 HQ" },
          { name: "sealNo", label: "Seal no.", value: s.sealNo },
          { name: "vgmKg", label: "VGM kg", value: s.vgmKg, type: "number", hint: "container gross mass" },
        ] satisfies DetailField[])),
    { name: "loadedOn", label: air ? "Handed over on" : "Loaded on", value: s.loadedOn, type: "date" },
    { name: "etd", label: "ETD", value: s.etd, type: "date" },
    { name: "eta", label: "ETA", value: s.eta, type: "date" },
    { name: "departedOn", label: air ? "Flown on" : "Departed on", value: s.departedOn, type: "date" },
    { name: "arrivedOn", label: "Arrived on", value: s.arrivedOn, type: "date" },
    { name: "note", label: "Note", value: s.note, type: "textarea" },
  ];
}

const DAY = 86_400_000;
/** "At sea · day 4 of 17", "Booked", "Arrived 8 Jan": where the shipment is, for its card. */
function whereBadge(s: ShipmentView, now: string) {
  if (s.status === "departed" && s.departedOn) {
    const day = Math.max(1, Math.round((Date.parse(now) - Date.parse(s.departedOn)) / DAY) + 1);
    const of = s.eta ? Math.max(day, Math.round((Date.parse(s.eta) - Date.parse(s.departedOn)) / DAY)) : null;
    return <Badge tone="info" dot>{`${s.mode === "air" ? "In the air" : "At sea"} · day ${day}${of ? ` of ${of}` : ""}`}</Badge>;
  }
  if (s.status === "arrived" || s.status === "cleared")
    return <Badge tone="ok" dot>{`${SHIPMENT_STATUS_LABEL[s.status]}${s.arrivedOn ? ` ${date(s.arrivedOn)}` : ""}`}</Badge>;
  return <Badge tone="neutral" dot>{SHIPMENT_STATUS_LABEL[s.status]}</Badge>;
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
  // Our ship-by stays ours; with an LC its latest shipment date is shown beside it (warned about when ours is later).
  const lcLatest = flow?.payment.route === "letter_of_credit" ? (flow.payment.bankContract?.latestShipOn ?? null) : null;
  const shipBy: ShipBy = { ours: o.shipBy, lc: lcLatest, late: !!shipByVsLc(o.shipBy, lcLatest)?.late };
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
        { label: "Container type", field: { name: "containerType", label: "Container type", value: toBook?.containerType, placeholder: "e.g. 1 × 40 HQ" } },
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
            { name: "containerNo", label: "Container no.", value: toLoad?.containerNo, required: true, placeholder: "e.g. MSKU 7741203" },
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
        { name: "blNo", label: sailAir ? "AWB no." : "B/L no.", value: toSail?.blNo, required: true, placeholder: sailAir ? "e.g. 999-12345675" : "e.g. MEDU1234567" },
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
    tools.packing_list = { kind: "link", label: o.goods.packed ? "See it" : canEdit ? "Make it" : "See it", href: `/orders/${o.id}/packing` };
  if (canPay && Number(o.money.due) > 0)
    tools.balance_in = {
      kind: "node",
      node: (
        <RecordPaymentLink kind="in" order={o.id} back={`/orders/${o.id}/shipping`} />
      ),
    };
  const shipped = stageTool(me, o, "shipped", now);
  if (shipped) tools.shipped = { kind: "node", node: shipped };
  const close = stageTool(me, o, "done", now);
  if (close) tools.closed = { kind: "node", node: close };

  // A new shipment starts from the ports the terms give: E/F terms load at the Incoterm place, C/D terms discharge there.
  const fresh: Partial<ShipmentView> = { mode: "sea", status: "planned", ...portsOf(o) };
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

  const going = shipments.filter((s) => s.status !== "arrived" && s.status !== "cleared");
  const lead = shipments.find((s) => s.status !== "cleared") ?? shipments[0];
  const header = (
    <>
      {shipments.length > 0 && addShipment}
      {canShip && going.some((s) => s.status === "departed") && (
        <HeaderTap label="Mark arrived" action={lightAction.bind(null, o.id, `arrived:${going.map((s) => s.id).join(",")}`)} on={now} />
      )}
    </>
  );

  return (
    <StepPage
      steps={d.steps}
      step="shipping"
      base={d.base}
      action={header}
      side={<StepSidePanel id={o.id} step="shipping" changes={d.changes} historyHref={d.historyHref} />}
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
          <>
            {lead && <StatusBar states={SHIPMENT_STATUSES.map((k) => ({ key: k, label: SHIPMENT_STATUS_LABEL[k] }))} at={lead.status} />}
            {shipments.map((s, i) => (
              <InlineFieldsCard
                key={s.id}
                target="shipment"
                id={i === 0 ? "shipments" : undefined}
                title={shipments.length > 1 ? `Shipment ${i + 1}` : "Shipment"}
                badge={whereBadge(s, now)}
                fields={canShip ? formFields(s) : shipmentFields(s, shipBy)}
                action={fieldsAction.bind(null, o.id, `shipment:${s.id}`)}
                canEdit={canShip}
                save="Save shipment"
              />
            ))}
            {shipBy.ours && (
              <p className={shipBy.late ? "text-sm text-bad" : "text-sm text-text-2"}>
                Ship by {date(shipBy.ours)}
                {shipBy.lc && ` · LC latest shipment ${date(shipBy.lc)}`}
                {shipBy.late && " · ours is later than the LC allows"}
              </p>
            )}
          </>
        ) : (
          <DetailsCard
            id="shipments"
            target="shipment"
            title="Shipment"
            description={canShip ? "Not booked yet: + Add any value starts the shipment, its ports from the terms." : "Not booked yet."}
            fields={shipmentFields(fresh, shipBy)}
            action={fieldsAction.bind(null, o.id, "shipment:new")}
            canEdit={canShip}
            panelTitle="The shipment"
          />
        )
      ) : (
        <DetailsCard
          id="shipments"
          target="shipment"
          title="Shipping"
          fields={[
            { name: "portOfDischarge", label: "To", value: o.portOfDischarge },
            { name: "shippedOn", label: "Shipped on", value: o.shippedOn, type: "date", max: now, show: o.shippedOn ? date(o.shippedOn) : null },
            { name: "blNo", label: "B/L no.", value: o.blNo },
            { name: "containerNo", label: "Container no.", value: o.goods.containerNo },
            { name: "shipBy", label: "Ship by", value: o.shipBy, type: "date", show: shipByFields(shipBy)[0]!.show },
            ...shipByFields(shipBy).slice(1),
          ]}
          action={fieldsAction.bind(null, o.id, "order")}
          canEdit={canEdit}
          panelTitle="Edit shipping"
        />
      )}
    </StepPage>
  );
}
