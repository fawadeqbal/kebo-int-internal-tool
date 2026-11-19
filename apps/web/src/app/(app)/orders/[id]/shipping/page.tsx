import type { ReactNode } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import {
  can,
  dayMonth,
  FREIGHT_TERMS,
  FREIGHT_TERMS_LABEL,
  portsOf,
  SHIP_MODE_LABEL,
  SHIP_MODES,
  shipByVsLc,
  trackingLink,
  type FreightTerms,
  type OrderSection,
} from "@kebo/shared";
import { Badge, buttonClass, ButtonLink, cn } from "@kebo/ui";
import { date, money } from "@/lib/format";
import { editsOf } from "@/lib/edit-data";
import { orderPapersOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import type { ShipmentView } from "@/lib/types-flow";
import type { DetailField } from "@/components/orders/step-view";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { PartsBox, type BoxPart } from "@/components/records/parts-box";
import { SectionFiles } from "@/components/order-sections/section-files";
import { FieldsWindow } from "@/components/order-sections/fields-window";
import { fieldsAction } from "../../light-actions";
import { packingAction, packingMarksAction } from "../../actions";
import { docHref, goodsOf } from "../shared";
import { PackingCard } from "../goods";
import { RemoveButton } from "@/components/orders/flow-forms";
import { removeShipmentAction } from "../../flow-actions";
import { stageData } from "../stage-data";
import { orderTitle } from "@/lib/titles";

export const generateMetadata = orderTitle("Shipping");

/** What saving the freight and the insurance does to the order's costs. */
const COST_WHATS = ["Freight we pay (not “collect”) and the premium become costs of this order by themselves."];

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
  const port = o.agreed?.portOfDischarge ?? o.portOfDischarge;

  // Shipping instructions (design "terms that travel"): who the goods go to and who is told; they print on the
  // B/L instructions and the shipping papers, and each new shipment starts from them. The port is as agreed.
  const instructions = (
    <Section
      title="Shipping instructions"
      cols={4}
      rows={[
        { label: "Consignee", value: <span className="whitespace-pre-line">{o.consignee || o.customer.name}</span> },
        { label: "Notify party", value: <span className="whitespace-pre-line">{o.notifyParty || "Same as the consignee"}</span> },
        { label: "Deliver to", value: o.deliveryAddress ? <span className="whitespace-pre-line">{o.deliveryAddress}</span> : null },
        {
          label: "Port of discharge",
          value: (
            <>
              {port ?? <span className="font-normal text-muted">—</span>} ·{" "}
              <Link href={`/orders/${o.id}#agreed`} className="font-normal text-primary hover:underline">
                as agreed
              </Link>
            </>
          ),
        },
      ]}
      actions={
        canEdit && (
          <FieldsWindow
            button={{ label: "Edit" }}
            title="Shipping instructions"
            sub={`${o.refNo} · ${o.customer.name}`}
            action={fieldsAction.bind(null, o.id, "order")}
            fields={[
              {
                name: "consignee",
                label: "Consignee",
                type: "textarea",
                value: o.consignee ?? null,
                placeholder: o.customer.name,
                wide: true,
              },
              { name: "notifyParty", label: "Notify party", type: "textarea", value: o.notifyParty ?? null, wide: true },
              { name: "deliveryAddress", label: "Deliver to", type: "textarea", value: o.deliveryAddress ?? null, wide: true },
            ]}
          />
        )
      }
    />
  );

  // A company without the shipping module keeps the few values the order itself holds.
  if (!shipping)
    return (
      <OrderPage id={id}>
        {instructions}
        <Section
          title="Shipping"
          state={o.shippedOn ? `Shipped ${dayMonth(o.shippedOn)}` : "Not shipped yet"}
          tone={o.shippedOn ? "ok" : "neutral"}
          cols={4}
          rows={[
            { label: "To", value: port },
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

  // The shipping advice beside the instructions (two short boxes side by side).
  const adviceBox =
    advice &&
    (advice.state === "ready" || advice.state === "draft" ? (
      <Section
        title="Shipping advice to the customer"
        state={advice.stateLabel}
        tone={advice.state === "ready" ? "ok" : "info"}
        rows={[
          { label: "Number", value: advice.number },
          { label: "Version", value: advice.version ? String(advice.version) : null },
        ]}
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
    ));

  return (
    <OrderPage id={id}>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {instructions}
        {adviceBox}
      </div>
      {shipments.map((s, i) => {
        const air = s.mode === "air";
        const sub = `${o.refNo}${many ? ` · Shipment ${i + 1}` : ""}`;
        const action = fieldsAction.bind(null, o.id, s.id ? `shipment:${s.id}` : "shipment:new");
        const filesOf = (section: OrderSection, hint: string) => (d.canFiles && i === 0 ? { orderId: o.id, section, hint } : undefined);
        const row = (section: OrderSection) =>
          // A part shows its files only when it has some: they are added in its window.
          i === 0 ? <SectionFiles orderId={o.id} section={section} canAdd={false} quiet /> : undefined;
        const win = (
          title: string,
          fields: DetailField[],
          filled: boolean,
          files?: ReturnType<typeof filesOf>,
          whats?: string[],
          main = false,
        ) =>
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
          {
            name: "mode",
            label: "Way",
            type: "select",
            value: s.mode ?? "sea",
            options: SHIP_MODES.map((m) => ({ value: m, label: SHIP_MODE_LABEL[m] })),
          },
          { name: "forwarder", label: "Forwarder", value: s.forwarder },
          { name: "forwarderContact", label: "Contact", value: s.forwarderContact },
          { name: "forwarderPhone", label: "Phone", value: s.forwarderPhone },
          { name: "bookingNo", label: "Booking no.", value: s.bookingNo },
          ...(air ? [] : [{ name: "containerType", label: "Container type", value: s.containerType }]),
          { name: "portOfLoading", label: "From", value: s.portOfLoading },
          { name: "portOfDischarge", label: "To", value: s.portOfDischarge },
          { name: "etd", label: "ETD", type: "date", value: s.etd },
          { name: "eta", label: "ETA", type: "date", value: s.eta },
        ];
        const container: DetailField[] = air
          ? [{ name: "loadedOn", label: "Handed over on", type: "date", value: s.loadedOn, max: now }]
          : [
              { name: "containerNo", label: "Container no.", value: s.containerNo, wide: true },
              { name: "sealNo", label: "Seal no.", value: s.sealNo, wide: true },
              { name: "loadedOn", label: "Loaded on", type: "date", value: s.loadedOn, max: now },
              { name: "vgmKg", label: "Gross weight (VGM), kg", type: "number", value: s.vgmKg },
            ];
        const vessel: DetailField[] = [
          ...(air ? [] : [{ name: "vessel", label: "Vessel", value: s.vessel }]),
          { name: "blNo", label: air ? "AWB no." : "B/L no.", value: s.blNo },
          { name: "departedOn", label: air ? "Flown on" : "Sailed on", type: "date", value: s.departedOn, max: now },
          { name: "trackingNo", label: "Tracking no.", value: s.trackingNo },
          { name: "note", label: "Note", type: "textarea", value: s.note, wide: true },
        ];
        const freight: DetailField[] = [
          { name: "freightAmount", label: "Freight", type: "number", value: s.freightAmount },
          { name: "freightCurrency", label: "Currency", value: s.freightCurrency ?? (s.freightAmount ? null : o.currency) },
          {
            name: "freightTerms",
            label: "Paid",
            type: "select",
            value: s.freightTerms ?? "",
            options: [{ value: "", label: "Not said" }, ...FREIGHT_TERMS.map((t) => ({ value: t, label: FREIGHT_TERMS_LABEL[t] }))],
          },
          { name: "insurer", label: "Insured with", value: s.insurer },
          { name: "insurancePolicyNo", label: "Policy no.", value: s.insurancePolicyNo },
          { name: "insuredValue", label: `Insured value, ${o.currency}`, type: "number", value: s.insuredValue },
          { name: "insurancePremium", label: "Premium", type: "number", value: s.insurancePremium },
          { name: "insuranceCurrency", label: "Premium currency", value: s.insuranceCurrency ?? (s.insurancePremium ? null : o.currency) },
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
        const paidFreight = has(s.freightAmount, s.insurer, s.insurancePolicyNo, s.insuredValue, s.insurancePremium);
        const arrived = has(s.arrivedOn, s.customsBroker, s.customsDeclarationNo, s.clearedOn);
        const leaves = air ? "Flown" : "Sailed";

        const vesselTitle = air ? "Flight and air waybill" : "Vessel and bill of lading";
        const loadTitle = air ? "Handing over" : "Container and loading";
        // One box per shipment, a line per part, each with its own button (canvas board "Shipping", PartsBox).
        const parts: BoxPart[] = [
          {
            key: "booking",
            title: "Booking",
            word: booked ? { text: s.bookingNo ? "Booked" : "Forwarder chosen", tone: s.bookingNo ? "ok" : "info" } : null,
            facts: booked
              ? [
                  ["Way", SHIP_MODE_LABEL[s.mode ?? "sea"]],
                  ["Forwarder", s.forwarder],
                  ["Contact", [s.forwarderContact, s.forwarderPhone].filter(Boolean).join(" · ")],
                  ["Booking no.", s.bookingNo],
                  ["From", s.portOfLoading],
                  ["To", s.portOfDischarge],
                  ["ETD", s.etd ? date(s.etd) : null],
                  ["ETA", s.eta ? date(s.eta) : null],
                  ...(air ? [] : ([["Container type", s.containerType]] as [string, ReactNode][])),
                  ...(o.shipBy
                    ? ([
                        [
                          lcLatest ? "Ship by · LC latest" : "Ship by",
                          <span key="sb" className={cn(lateForLc && "text-bad")}>
                            {date(o.shipBy)}
                            {lcLatest ? ` · ${date(lcLatest)}` : ""}
                          </span>,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                ]
              : [],
            empty: o.shipBy ? `Not booked yet. Ship by ${date(o.shipBy)}.` : "Not booked yet.",
            action: win("Booking", booking, booked, filesOf("booking", "the booking copy")),
            files: row("booking"),
          },
          {
            key: "container",
            title: loadTitle,
            word: loaded ? { text: s.loadedOn ? `${air ? "Handed over" : "Loaded"} ${dayMonth(s.loadedOn)}` : "Not loaded yet", tone: s.loadedOn ? "ok" : "neutral" } : null,
            facts: air
              ? [["Handed over on", s.loadedOn ? date(s.loadedOn) : null]]
              : [
                  ["Container no.", s.containerNo],
                  ["Seal no.", s.sealNo],
                  ["Loaded on", s.loadedOn ? date(s.loadedOn) : null],
                  ["Gross weight (VGM)", s.vgmKg ? `${Number(s.vgmKg).toLocaleString("en-US")} kg` : null],
                ],
            empty: "Not loaded yet.",
            action: win(loadTitle, container, loaded, filesOf("container", "loading photos, the VGM slip")),
            files: row("container"),
          },
          {
            key: "vessel",
            title: vesselTitle,
            word: sailed ? { text: s.departedOn ? `${leaves} ${dayMonth(s.departedOn)}` : `Not ${air ? "flown" : "sailed"} yet`, tone: s.departedOn ? "ok" : "neutral" } : null,
            facts: [
              ...(air ? [] : ([["Vessel", s.vessel]] as [string, ReactNode][])),
              [air ? "AWB no." : "B/L no.", s.blNo],
              [`${leaves} on`, s.departedOn ? date(s.departedOn) : null],
              ["Tracking no.", s.trackingNo],
              ["Note", s.note],
            ],
            empty: `Not ${air ? "flown" : "sailed"} yet.`,
            action: (
              <>
                {track && (
                  <a href={track.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm", SMALL)} title={`${track.carrier} · ${track.number}`}>
                    <Globe aria-hidden /> Track
                  </a>
                )}
                {win(vesselTitle, vessel, sailed, filesOf("vessel", "the B/L copy"))}
              </>
            ),
            files: row("vessel"),
          },
          {
            key: "freight",
            title: "Freight and insurance",
            word: paidFreight ? { text: s.insurer || s.insurancePolicyNo ? "Insured" : "Not insured yet", tone: s.insurer || s.insurancePolicyNo ? "ok" : "warn" } : null,
            facts: [
              [
                "Freight",
                s.freightAmount
                  ? `${money(s.freightAmount, s.freightCurrency ?? o.currency)}${s.freightTerms ? ` · ${FREIGHT_TERMS_LABEL[s.freightTerms as FreightTerms].toLowerCase()}` : ""}`
                  : null,
              ],
              ["Insured with", s.insurer],
              ["Policy no.", s.insurancePolicyNo],
              ["Insured value", s.insuredValue ? money(s.insuredValue, o.currency) : null],
              ["Premium", s.insurancePremium ? money(s.insurancePremium, s.insuranceCurrency ?? o.currency) : null],
            ],
            empty: "No freight or insurance yet.",
            action: win("Freight and insurance", freight, paidFreight, filesOf("freight", "the policy, the freight invoice"), COST_WHATS),
            files: row("freight"),
          },
          {
            key: "arrival",
            title: "Arrival and customs",
            word: arrived ? { text: s.clearedOn ? `Cleared ${dayMonth(s.clearedOn)}` : s.arrivedOn ? `Arrived ${dayMonth(s.arrivedOn)}` : "Not arrived yet", tone: s.arrivedOn || s.clearedOn ? "ok" : "neutral" } : null,
            facts: [
              ["Arrived on", s.arrivedOn ? date(s.arrivedOn) : null],
              ["Customs broker", s.customsBroker],
              ["Declaration no.", s.customsDeclarationNo],
              ["Cleared on", s.clearedOn ? date(s.clearedOn) : null],
            ],
            empty: "Not arrived yet.",
            action: win("Arrival and customs", arrival, arrived, filesOf("arrival", "the arrival notice, the customs release")),
            files: row("arrival"),
          },
        ];
        // Where the shipment stands, in a word: the furthest part it has got to.
        const word = s.clearedOn
          ? { text: `Cleared ${dayMonth(s.clearedOn)}`, tone: "ok" as const }
          : s.arrivedOn
            ? { text: `Arrived ${dayMonth(s.arrivedOn)}`, tone: "ok" as const }
            : s.departedOn
              ? { text: `${leaves} ${dayMonth(s.departedOn)}`, tone: "info" as const }
              : s.bookingNo
                ? { text: "Booked", tone: "info" as const }
                : { text: "Not booked yet", tone: "neutral" as const };
        return (
          <PartsBox
            key={s.id ?? i}
            title={many ? `Shipment ${i + 1}` : "Shipment"}
            titleMore={SHIP_MODE_LABEL[s.mode ?? "sea"]}
            word={word}
            actions={canShip && s.id && !left && many ? <RemoveButton action={removeShipmentAction.bind(null, o.id, s.id)} what={`shipment ${i + 1}`} /> : undefined}
            parts={parts}
          />
        );
      })}

      {/* The order's packing: the lines' packages, weights and volume, and the marks (the packing list paper is on Documents). */}
      {packGoods.length > 0 && (
        <PackingCard
          title="Packing"
          badge={
            o.goods.totals.packages > 0 ? (
              <Badge tone="ok">{`${o.goods.totals.packages.toLocaleString("en-US")} package${o.goods.totals.packages === 1 ? "" : "s"}`}</Badge>
            ) : (
              <Badge tone="neutral">No packing list yet</Badge>
            )
          }
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
              {
                name: "mode",
                label: "Way",
                type: "select",
                value: "sea",
                options: SHIP_MODES.map((m) => ({ value: m, label: SHIP_MODE_LABEL[m] })),
              },
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
