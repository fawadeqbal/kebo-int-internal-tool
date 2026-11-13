import { Globe } from "lucide-react";
import { can, dayMonth, FREIGHT_TERMS, FREIGHT_TERMS_LABEL, portsOf, SHIP_MODE_LABEL, SHIP_MODES, shipByVsLc, trackingLink, type FreightTerms, type OrderSection } from "@kebo/shared";
import { Badge, buttonClass, ButtonLink, cn } from "@kebo/ui";
import { date, money } from "@/lib/format";
import { editsOf } from "@/lib/edit-data";
import { orderPapersOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import type { ShipmentView } from "@/lib/types-flow";
import type { DetailField } from "@/components/orders/step-view";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { FieldsWindow } from "@/components/order-sections/fields-window";
import { fieldsAction } from "../../light-actions";
import { packingAction, packingMarksAction } from "../../actions";
import { docHref, goodsOf } from "../shared";
import { PackingCard } from "../goods";
import { stageData } from "../stage-data";

export const metadata = { title: "Order · shipping" };

const SMALL = "h-8 px-2.5 text-[13px]";
const has = (...v: (string | null | undefined)[]) => v.some((x) => x !== null && x !== undefined && x !== "");

/**
 * Shipping (design "the order, final"): each shipment as small sections — booking, container and loading,
 * vessel and bill of lading, freight and insurance, arrival and customs — each with its own window and
 * files; then the packing of the order and the shipping advice to the customer. Every section is open
 * from the first day; a date out of order asks before it is saved.
 */
export default async function OrderShipping({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stageData(id, "shipping");
  const { me, o, flow, now, defaults } = d;
  const [papers, edits] = await Promise.all([optional(() => orderPapersOf(id)), editsOf("order", id)]);
  const shipping = flow?.shipping ?? null;
  const canShip = can(me, "shipping.manage") && d.open;
  const canEdit = can(me, "orders.update") && d.open;
  const lcLatest = flow?.payment.route === "letter_of_credit" ? (flow.payment.bankContract?.latestShipOn ?? null) : null;
  const lateForLc = !!shipByVsLc(o.shipBy, lcLatest)?.late;
  // A new shipment starts from the ports the terms give, and the forwarder of the last order like it.
  const fresh: Partial<ShipmentView> = { mode: "sea", status: "planned", ...portsOf(o), forwarder: defaults.forwarder?.name ?? null };
  const shipments: Partial<ShipmentView>[] = shipping?.shipments.length ? shipping.shipments : [fresh];
  const many = shipments.length > 1;
  const packGoods = goodsOf(o);
  const advice = papers?.papers.find((p) => p.kind === "shipping-advice") ?? null;

  // A company without the shipping module keeps the few values the order itself holds.
  if (!shipping)
    return (
      <OrderPage id={id}>
        <Section
          title="Shipping"
          state={o.shippedOn ? `Shipped ${dayMonth(o.shippedOn)}` : "Not shipped yet"}
          tone={o.shippedOn ? "ok" : "neutral"}
          cols={4}
          rows={[
            { label: "To", value: o.portOfDischarge },
            { label: "Shipped on", value: o.shippedOn ? date(o.shippedOn) : null },
            { label: "B/L no.", value: o.blNo },
            { label: "Container no.", value: o.goods.containerNo },
          ]}
          actions={
            canEdit && (
              <FieldsWindow
                button={{ label: "Edit" }}
                title="Shipping"
                sub={o.refNo}
                action={fieldsAction.bind(null, o.id, "order")}
                fields={[
                  { name: "portOfDischarge", label: "To", value: o.portOfDischarge },
                  { name: "shippedOn", label: "Shipped on", value: o.shippedOn, type: "date", max: now },
                  { name: "blNo", label: "B/L no.", value: o.blNo },
                  { name: "containerNo", label: "Container no.", value: o.goods.containerNo },
                ]}
              />
            )
          }
          files={<SectionFiles orderId={o.id} section="vessel" canAdd={d.canFiles} />}
        />
      </OrderPage>
    );

  return (
    <OrderPage id={id}>
      {shipments.map((s, i) => {
        const air = s.mode === "air";
        // Several shipments: each has its heading; the sections keep their short names.
        const of = "";
        const sub = `${o.refNo}${many ? ` · Shipment ${i + 1}` : ""}`;
        const action = fieldsAction.bind(null, o.id, s.id ? `shipment:${s.id}` : "shipment:new");
        const filesOf = (section: OrderSection, hint: string) => (d.canFiles && i === 0 ? { orderId: o.id, section, hint } : undefined);
        const row = (section: OrderSection) => (i === 0 ? <SectionFiles orderId={o.id} section={section} canAdd={d.canFiles} /> : undefined);
        const win = (title: string, fields: DetailField[], filled: boolean, files?: ReturnType<typeof filesOf>, whats?: string[], main = false) =>
          canShip && (
            <FieldsWindow
              button={filled ? { label: "Edit" } : { label: "Add", kind: main ? "main" : "plain" }}
              title={title}
              sub={sub}
              action={action}
              fields={fields}
              files={files}
              whats={whats}
              size={fields.length > 6 ? "md" : "sm"}
            />
          );
        const track = s.id ? trackingLink(s as ShipmentView) : null;
        const left = !!s.departedOn;

        const booking: DetailField[] = [
          { name: "mode", label: "Way", type: "select", value: s.mode ?? "sea", options: SHIP_MODES.map((m) => ({ value: m, label: SHIP_MODE_LABEL[m] })) },
          { name: "forwarder", label: "Forwarder", value: s.forwarder },
          { name: "forwarderContact", label: "Contact", value: s.forwarderContact },
          { name: "forwarderPhone", label: "Phone", value: s.forwarderPhone },
          { name: "bookingNo", label: "Booking no.", value: s.bookingNo },
          ...(air ? [] : [{ name: "containerType", label: "Container type", value: s.containerType, placeholder: "e.g. 1 × 40 HQ" }]),
          { name: "portOfLoading", label: "From", value: s.portOfLoading, placeholder: air ? "e.g. Shanghai PVG" : "e.g. Ningbo" },
          { name: "portOfDischarge", label: "To", value: s.portOfDischarge, placeholder: air ? "e.g. Lahore LHE" : "e.g. Karachi" },
          { name: "etd", label: "ETD", type: "date", value: s.etd },
          { name: "eta", label: "ETA", type: "date", value: s.eta },
        ];
        const container: DetailField[] = air
          ? [{ name: "loadedOn", label: "Handed over on", type: "date", value: s.loadedOn, max: now }]
          : [
              { name: "containerNo", label: "Container no.", value: s.containerNo, wide: true, placeholder: "e.g. MSKU 7741203" },
              { name: "sealNo", label: "Seal no.", value: s.sealNo, wide: true },
              { name: "loadedOn", label: "Loaded on", type: "date", value: s.loadedOn, max: now },
              { name: "vgmKg", label: "Gross weight (VGM), kg", type: "number", value: s.vgmKg },
            ];
        const vessel: DetailField[] = [
          ...(air ? [] : [{ name: "vessel", label: "Vessel", value: s.vessel, placeholder: "e.g. MSC Aurora" }]),
          { name: "blNo", label: air ? "AWB no." : "B/L no.", value: s.blNo },
          { name: "departedOn", label: air ? "Flown on" : "Sailed on", type: "date", value: s.departedOn, max: now },
          { name: "trackingNo", label: "Tracking no.", value: s.trackingNo },
          { name: "note", label: "Note", type: "textarea", value: s.note, wide: true },
        ];
        const freight: DetailField[] = [
          { name: "freightAmount", label: "Freight", type: "number", value: s.freightAmount },
          { name: "freightCurrency", label: "Currency", value: s.freightCurrency ?? (s.freightAmount ? null : o.currency), placeholder: "e.g. USD" },
          { name: "freightTerms", label: "Paid", type: "select", value: s.freightTerms ?? "", options: [{ value: "", label: "Not said" }, ...FREIGHT_TERMS.map((t) => ({ value: t, label: FREIGHT_TERMS_LABEL[t] }))] },
          { name: "insurer", label: "Insured with", value: s.insurer },
          { name: "insurancePolicyNo", label: "Policy no.", value: s.insurancePolicyNo },
          { name: "insuredValue", label: `Insured value, ${o.currency}`, type: "number", value: s.insuredValue },
        ];
        const arrival: DetailField[] = [
          { name: "arrivedOn", label: "Arrived on", type: "date", value: s.arrivedOn, max: now },
          { name: "customsBroker", label: "Customs broker", value: s.customsBroker },
          { name: "customsDeclarationNo", label: "Declaration no.", value: s.customsDeclarationNo },
          { name: "clearedOn", label: "Cleared on", type: "date", value: s.clearedOn, max: now },
        ];
        const booked = has(s.forwarder, s.bookingNo);
        const loaded = has(s.containerNo, s.sealNo, s.loadedOn, s.vgmKg);
        const sailed = has(s.vessel, s.blNo, s.departedOn, s.trackingNo);
        const paidFreight = has(s.freightAmount, s.insurer, s.insurancePolicyNo, s.insuredValue);
        const arrived = has(s.arrivedOn, s.customsBroker, s.customsDeclarationNo, s.clearedOn);
        const leaves = air ? "Flown" : "Sailed";

        return (
          <div key={i} className="contents">
            {many && <h2 className={cn("text-[13px] font-bold text-text-2", i > 0 && "mt-2")}>Shipment {i + 1}</h2>}
            {booked ? (
              <Section
                title={`Booking${of}`}
                state={s.bookingNo ? "Booked" : "Forwarder chosen"}
                tone={s.bookingNo ? "ok" : "info"}
                cols={3}
                rows={[
                  { label: "Way", value: SHIP_MODE_LABEL[s.mode ?? "sea"] },
                  { label: "Forwarder", value: s.forwarder },
                  { label: "Contact", value: [s.forwarderContact, s.forwarderPhone].filter(Boolean).join(" · ") || null },
                  { label: "Booking no.", value: s.bookingNo },
                  { label: "From", value: s.portOfLoading },
                  { label: "To", value: s.portOfDischarge },
                  { label: "ETD", value: s.etd ? date(s.etd) : null },
                  { label: "ETA", value: s.eta ? date(s.eta) : null },
                  ...(air ? [] : [{ label: "Container type", value: s.containerType }]),
                  ...(o.shipBy
                    ? [
                        {
                          label: lcLatest ? "Ship by · LC latest" : "Ship by",
                          value: (
                            <span className={cn(lateForLc && "text-bad")}>
                              {date(o.shipBy)}
                              {lcLatest ? ` · ${date(lcLatest)}` : ""}
                            </span>
                          ),
                        },
                      ]
                    : []),
                ]}
                actions={win("Booking", booking, true, filesOf("booking", "the booking copy"))}
                files={row("booking")}
              />
            ) : (
              <EmptySection title={`Booking${of}`} text={o.shipBy ? `Not booked yet. Ship by ${date(o.shipBy)}.` : "Not booked yet."} action={win("Booking", booking, false, filesOf("booking", "the booking copy"), undefined, true)} />
            )}

            <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-2">
              {loaded ? (
                <Section
                  title={`${air ? "Handing over" : "Container and loading"}${of}`}
                  state={s.loadedOn ? `${air ? "Handed over" : "Loaded"} ${dayMonth(s.loadedOn)}` : "Not loaded yet"}
                  tone={s.loadedOn ? "ok" : "neutral"}
                  rows={air ? [{ label: "Handed over on", value: s.loadedOn ? date(s.loadedOn) : null }] : [
                    { label: "Container no.", value: s.containerNo },
                    { label: "Seal no.", value: s.sealNo },
                    { label: "Loaded on", value: s.loadedOn ? date(s.loadedOn) : null },
                    { label: "Gross weight (VGM)", value: s.vgmKg ? `${Number(s.vgmKg).toLocaleString("en-US")} kg` : null },
                  ]}
                  actions={win(air ? "Handing over" : "Container and loading", container, true, filesOf("container", "loading photos, the VGM slip"))}
                  files={row("container")}
                />
              ) : (
                <EmptySection title={`${air ? "Handing over" : "Container and loading"}${of}`} text="Not loaded yet." action={win(air ? "Handing over" : "Container and loading", container, false, filesOf("container", "loading photos, the VGM slip"))} />
              )}
              {sailed ? (
                <Section
                  title={`${air ? "Flight and air waybill" : "Vessel and bill of lading"}${of}`}
                  state={s.departedOn ? `${leaves} ${dayMonth(s.departedOn)}` : `Not ${air ? "flown" : "sailed"} yet`}
                  tone={s.departedOn ? "ok" : "neutral"}
                  rows={[
                    ...(air ? [] : [{ label: "Vessel", value: s.vessel }]),
                    { label: air ? "AWB no." : "B/L no.", value: s.blNo },
                    { label: `${leaves} on`, value: s.departedOn ? date(s.departedOn) : null },
                    { label: "Tracking no.", value: s.trackingNo },
                    ...(s.note ? [{ label: "Note", value: s.note }] : []),
                  ]}
                  actions={
                    <>
                      {track && (
                        <a href={track.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm", SMALL)} title={`${track.carrier} · ${track.number}`}>
                          <Globe aria-hidden /> Track
                        </a>
                      )}
                      {win(air ? "Flight and air waybill" : "Vessel and bill of lading", vessel, true, filesOf("vessel", air ? "the AWB copy" : "the B/L copy"), left ? undefined : [`With a date the section says “${leaves} …”.`, "The order becomes “Shipped”."])}
                    </>
                  }
                  files={row("vessel")}
                />
              ) : (
                <EmptySection
                  title={`${air ? "Flight and air waybill" : "Vessel and bill of lading"}${of}`}
                  text={`Not ${air ? "flown" : "sailed"} yet.`}
                  action={win(air ? "Flight and air waybill" : "Vessel and bill of lading", vessel, false, filesOf("vessel", air ? "the AWB copy" : "the B/L copy"), [`With a date the section says “${leaves} …”.`, "The order becomes “Shipped”."])}
                />
              )}
              {paidFreight ? (
                <Section
                  title={`Freight and insurance${of}`}
                  state={s.insurer || s.insurancePolicyNo ? "Insured" : "Not insured yet"}
                  tone={s.insurer || s.insurancePolicyNo ? "ok" : "warn"}
                  rows={[
                    {
                      label: "Freight",
                      value: s.freightAmount ? `${money(s.freightAmount, s.freightCurrency ?? o.currency)}${s.freightTerms ? ` · ${FREIGHT_TERMS_LABEL[s.freightTerms as FreightTerms].toLowerCase()}` : ""}` : null,
                    },
                    { label: "Insured with", value: s.insurer },
                    { label: "Policy no.", value: s.insurancePolicyNo },
                    { label: "Insured value", value: s.insuredValue ? money(s.insuredValue, o.currency) : null },
                  ]}
                  actions={win("Freight and insurance", freight, true, filesOf("freight", "the policy, the freight invoice"))}
                  files={row("freight")}
                />
              ) : (
                <EmptySection title={`Freight and insurance${of}`} text="No freight or insurance yet." action={win("Freight and insurance", freight, false, filesOf("freight", "the policy, the freight invoice"))} />
              )}
              {arrived ? (
                <Section
                  title={`Arrival and customs${of}`}
                  state={s.clearedOn ? `Cleared ${dayMonth(s.clearedOn)}` : s.arrivedOn ? `Arrived ${dayMonth(s.arrivedOn)}` : "Not arrived yet"}
                  tone={s.arrivedOn || s.clearedOn ? "ok" : "neutral"}
                  rows={[
                    { label: "Arrived on", value: s.arrivedOn ? date(s.arrivedOn) : null },
                    { label: "Customs broker", value: s.customsBroker },
                    { label: "Declaration no.", value: s.customsDeclarationNo },
                    { label: "Cleared on", value: s.clearedOn ? date(s.clearedOn) : null },
                  ]}
                  actions={win("Arrival and customs", arrival, true, filesOf("arrival", "the arrival notice, the customs release"))}
                  files={row("arrival")}
                />
              ) : (
                <EmptySection title={`Arrival and customs${of}`} text="Not arrived yet." action={win("Arrival and customs", arrival, false, filesOf("arrival", "the arrival notice, the customs release"))} />
              )}
            </div>
          </div>
        );
      })}

      {/* The order's packing: the lines' packages, weights and volume, and the marks (the packing list paper is on Documents). */}
      {packGoods.length > 0 && (
        <PackingCard
          title="Packing"
          badge={o.goods.totals.packages > 0 ? <Badge tone="ok">{`${o.goods.totals.packages.toLocaleString("en-US")} package${o.goods.totals.packages === 1 ? "" : "s"}`}</Badge> : <Badge tone="neutral">No packing lines yet</Badge>}
          orderId={o.id}
          lines={o.lines.filter((l) => l.type === "goods")}
          goods={packGoods}
          containerNo={o.goods.containerNo}
          containerHref={`/orders/${o.id}/shipping`}
          shippingMarks={o.goods.shippingMarks}
          canEdit={canEdit}
          canUpload={canEdit && (o.stage === "confirmed" || o.stage === "in_production")}
          action={packingAction.bind(null, o.id)}
          marksAction={packingMarksAction.bind(null, o.id)}
          links={o.goods.packed || o.goods.totals.packages > 0 ? docHref(o, { kind: "packing-list", label: "Packing list" }) : undefined}
          today={now}
          toggle
          edits={edits}
        />
      )}

      {advice &&
        (advice.state === "ready" || advice.state === "draft" ? (
          <Section
            title="Shipping advice to the customer"
            state={advice.stateLabel}
            tone={advice.state === "ready" ? "ok" : "info"}
            rows={[{ label: "Number", value: advice.number }, { label: "Version", value: advice.version ? String(advice.version) : null }]}
            actions={
              <ButtonLink href={`/orders/${o.id}/papers/shipping-advice`} size="sm" variant="secondary" className={SMALL}>
                Open
              </ButtonLink>
            }
            files={<SectionFiles orderId={o.id} section="advice" canAdd={d.canFiles} />}
          />
        ) : (
          <EmptySection
            title="Shipping advice to the customer"
            text="Not sent yet."
            action={
              advice.makeable && papers?.canMake ? (
                <ButtonLink href={`/orders/${o.id}/papers/shipping-advice`} size="sm" variant="secondary" className={SMALL}>
                  Make and send
                </ButtonLink>
              ) : undefined
            }
          />
        ))}

      {canShip && shipping.shipments.length > 0 && (
        <div>
          <FieldsWindow
            button={{ label: "+ Add a shipment", kind: "plain" }}
            title={`Shipment ${shipping.shipments.length + 1}`}
            sub={`${o.refNo} · when the goods leave in more than one lot`}
            plain
            action={fieldsAction.bind(null, o.id, "shipment:new")}
            save="Add the shipment"
            whats={["Shipping shows its sections once per shipment."]}
            fields={[
              { name: "mode", label: "Way", type: "select", value: "", options: [{ value: "", label: "Choose" }, ...SHIP_MODES.map((m) => ({ value: m, label: SHIP_MODE_LABEL[m] }))] },
              { name: "forwarder", label: "Forwarder", value: "" },
              { name: "etd", label: "Planned ETD", type: "date", value: "" },
              { name: "note", label: "What goes in it", type: "textarea", value: "", wide: true },
            ]}
          />
        </div>
      )}
    </OrderPage>
  );
}
