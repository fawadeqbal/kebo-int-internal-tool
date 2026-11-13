import { notFound } from "next/navigation";
import { can, dayMonth, DELIVERY_CONDITION_LABEL, SAT_RESULT_LABEL } from "@kebo/shared";
import { Badge } from "@kebo/ui";
import { getPeople } from "@/lib/loaders";
import { date } from "@/lib/format";
import { editsOf } from "@/lib/edit-data";
import { optional } from "@/components/print/data";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { FieldsWindow } from "@/components/order-sections/fields-window";
import { AllDeliveredWindow, ClaimAddWindow, ClaimsTable, SatSignWindow } from "@/components/order-sections/delivery-windows";
import { OrderLines, OrderLinesEditor, PhoneLines } from "@/components/orders/order-lines";
import { PanelButton } from "@/components/orders/step-view";
import { SatEdit } from "@/components/orders/view-panels";
import { addClaimAction, satAction, updateClaimAction } from "../../flow-actions";
import { fieldsAction, lightAction } from "../../light-actions";
import { stageData } from "../stage-data";

export const metadata = { title: "Order · delivery and SAT" };

const SMALL = "h-8 px-2.5 text-[13px]";
const RESULT_TONE = { pending: "neutral", pass: "ok", fail: "bad", not_applicable: "neutral" } as const;

/** A day some months later (YYYY-MM-DD), kept inside the month it lands in. */
function addMonths(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/**
 * Delivery & SAT (design "the order, final"): the delivery to the customer with its lines, the
 * installation and the site acceptance test with its points, the warranty, and the claims. Open from
 * the first day: the engineer's visit can be planned before the goods arrive.
 */
export default async function OrderDelivery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stageData(id, "delivery");
  const { me, o, flow, now } = d;
  if (!flow?.delivery) notFound();
  const dv = flow.delivery;
  const [people, edits] = await Promise.all([optional(() => getPeople()), editsOf("order", id)]);
  const canEdit = can(me, "delivery.manage") && d.open;
  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const delivered = goodsLines.filter((l) => Number(l.delivered?.qty) >= Number(l.quantity)).length;
  const open = dv.claims.filter((c) => c.status === "open" || c.status === "with_factory").length;
  const from = dv.satDoneOn ?? dv.deliveredOn;
  const until = from && dv.warrantyMonths ? addMonths(from, dv.warrantyMonths) : null;
  const passed = dv.sat.filter((c) => c.result === "pass" || c.result === "not_applicable").length;
  const action = fieldsAction.bind(null, o.id, "delivery");
  const sub = `${o.refNo} · ${o.customer.name}`;
  const hasDelivery = !!(dv.deliveredOn || dv.receivedBy || dv.note || delivered > 0);
  const hasSat = !!(dv.satEngineer || dv.satPlannedOn || dv.installedOn || dv.satDoneOn || dv.satSignedBy || dv.sat.length);

  const deliveryWindow = (filled: boolean) =>
    canEdit && (
      <FieldsWindow
        button={filled ? { label: "Edit" } : { label: "Add", kind: "plain" }}
        title="Delivery"
        sub={sub}
        action={action}
        files={d.canFiles ? { orderId: o.id, section: "delivery", hint: "the signed delivery note, photos" } : undefined}
        fields={[
          { name: "deliveredOn", label: "Delivered on", type: "date", value: dv.deliveredOn, max: now },
          { name: "deliveryReceivedBy", label: "Received by", value: dv.receivedBy, placeholder: "e.g. Mr. Imran, stores" },
          { name: "deliveryNote", label: "Note on the delivery", type: "textarea", value: dv.note, wide: true },
        ]}
      />
    );
  const linesButton = canEdit && goodsLines.length > 0 && (
    <PanelButton
      size="sm"
      className={SMALL}
      label="Edit lines"
      title="Delivery"
      description="How many of each line reached the customer, and in what condition. Nothing is saved until Save changes."
      panelClassName="md:w-[1180px]"
      body={<OrderLinesEditor set="delivered" orderId={o.id} lines={goodsLines} today={now} edit={{ type: "order", id: o.id, card: "lines.delivered" }} card={edits.cards["lines.delivered"]} />}
    />
  );
  const allOk = canEdit && goodsLines.length > 0 && delivered < goodsLines.length && (
    <AllDeliveredWindow sub={sub} action={lightAction.bind(null, o.id, "delivered_all")} today={now} lines={goodsLines.length} />
  );
  const satWindow = (filled: boolean) =>
    canEdit && (
      <FieldsWindow
        button={filled ? { label: "Edit" } : { label: "Add", kind: "plain" }}
        title="Installation and SAT"
        sub={sub}
        action={action}
        files={d.canFiles ? { orderId: o.id, section: "sat", hint: "the signed SAT" } : undefined}
        fields={[
          { name: "satEngineerId", label: "Our engineer", type: "select", value: dv.satEngineer?.id ?? "", options: [{ value: "", label: "Nobody yet" }, ...(people ?? []).map((p) => ({ value: p.id, label: p.name }))] },
          { name: "satPlannedOn", label: "SAT planned on", type: "date", value: dv.satPlannedOn },
          { name: "installedOn", label: "Installed on", type: "date", value: dv.installedOn ?? null, max: now },
          { name: "satDoneOn", label: "SAT done on", type: "date", value: dv.satDoneOn, max: now },
          { name: "satSignedBy", label: "Signed for the customer by", value: dv.satSignedBy, wide: true },
        ]}
      />
    );

  return (
    <OrderPage id={id}>
      {hasDelivery ? (
        <Section
          title="Delivery"
          state={dv.deliveredOn ? `Delivered ${dayMonth(dv.deliveredOn)}` : `${delivered} of ${goodsLines.length} delivered`}
          tone={dv.deliveredOn ? (dv.condition && dv.condition !== "good" ? "warn" : "ok") : "info"}
          cols={4}
          rows={[
            { label: "Delivered on", value: dv.deliveredOn ? date(dv.deliveredOn) : null },
            { label: "Received by", value: dv.receivedBy },
            { label: "Condition", value: dv.condition ? DELIVERY_CONDITION_LABEL[dv.condition] : null },
            { label: "Lines", value: goodsLines.length ? `${delivered} of ${goodsLines.length} in full` : null },
            ...(dv.note ? [{ label: "Note", value: dv.note }] : []),
          ]}
          actions={
            <>
              {deliveryWindow(true)}
              {linesButton}
              {allOk}
            </>
          }
          files={<SectionFiles orderId={o.id} section="delivery" canAdd={d.canFiles} />}
        >
          {goodsLines.length > 0 && (
            <div className="px-[18px] pb-3.5">
              <div className="max-md:hidden">
                <OrderLines set="delivered" orderId={o.id} lines={goodsLines} canEdit={false} today={now} />
              </div>
              <div className="md:hidden">
                <PhoneLines set="delivered" lines={goodsLines} />
              </div>
            </div>
          )}
        </Section>
      ) : (
        <EmptySection
          title="Delivery"
          text="Not delivered yet."
          action={
            <>
              {deliveryWindow(false)}
              {allOk}
            </>
          }
        />
      )}

      <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-2">
        {hasSat ? (
          <Section
            title="Installation and SAT"
            state={dv.satDoneOn ? `Signed ${dayMonth(dv.satDoneOn)}` : dv.satPlannedOn ? `Planned ${dayMonth(dv.satPlannedOn)}` : dv.installedOn ? `Installed ${dayMonth(dv.installedOn)}` : "Not planned"}
            tone={dv.satDoneOn ? "ok" : dv.satPlannedOn && dv.satPlannedOn < now ? "bad" : "info"}
            rows={[
              { label: "Our engineer", value: dv.satEngineer?.name ?? null },
              { label: "SAT planned on", value: dv.satPlannedOn ? date(dv.satPlannedOn) : null },
              { label: "Installed on", value: dv.installedOn ? date(dv.installedOn) : null },
              { label: "SAT done on", value: dv.satDoneOn ? date(dv.satDoneOn) : null },
              { label: "Signed for the customer by", value: dv.satSignedBy },
              { label: "Points", value: dv.sat.length ? `${passed} of ${dv.sat.length} passed` : null },
            ]}
            actions={
              <>
                {satWindow(true)}
                {canEdit && (
                  <PanelButton
                    size="sm"
                    className={SMALL}
                    label="Points"
                    title="The SAT points"
                    description="Each point: Pass, Fail or N/A, and a note."
                    body={<SatEdit action={satAction.bind(null, o.id)} checks={dv.sat} suggested={dv.suggestedSat} locked={!!dv.satDoneOn} />}
                  />
                )}
                {canEdit && !dv.satDoneOn && <SatSignWindow sub={sub} action={lightAction.bind(null, o.id, "sat_all")} today={now} signedBy={dv.satSignedBy} points={dv.sat.length} />}
              </>
            }
            files={<SectionFiles orderId={o.id} section="sat" canAdd={d.canFiles} />}
          >
            {dv.sat.length > 0 && (
              <ul className="flex flex-col divide-y divide-line border-t border-line px-[18px]">
                {dv.sat.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <span className="min-w-0 text-[13px]">
                      <span className="block font-semibold">{c.item}</span>
                      {c.note && <span className="block text-xs text-text-2">{c.note}</span>}
                    </span>
                    <Badge tone={RESULT_TONE[c.result]}>{SAT_RESULT_LABEL[c.result]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : (
          <EmptySection title="Installation and SAT" text="Not planned yet." action={satWindow(false)} />
        )}

        {dv.warrantyMonths ? (
          <Section
            title="Warranty"
            state={until ? `To ${date(until)}` : "Not started"}
            tone={until ? "ok" : "neutral"}
            cols={3}
            rows={[
              { label: "Starts on", value: from ? date(from) : null },
              { label: "Months", value: String(dv.warrantyMonths) },
              { label: "Ends on", value: until ? date(until) : null },
            ]}
            actions={
              canEdit && (
                <FieldsWindow button={{ label: "Edit" }} title="Warranty" sub={sub} action={action} fields={[{ name: "warrantyMonths", label: "Months", type: "number", value: String(dv.warrantyMonths), hint: "It starts on the SAT day; without a SAT, on the delivery day." }]} />
              )
            }
          />
        ) : (
          <EmptySection
            title="Warranty"
            text="Starts on the SAT day."
            action={canEdit && <FieldsWindow button={{ label: "Add", kind: "plain" }} title="Warranty" sub={sub} plain action={action} fields={[{ name: "warrantyMonths", label: "Months", type: "number", value: "" }]} />}
          />
        )}
      </div>

      {dv.claims.length > 0 ? (
        <Section
          title="Claims"
          state={open ? `${open} open` : `${dv.claims.length} settled`}
          tone={open ? "warn" : "ok"}
          actions={canEdit && <ClaimAddWindow sub={sub} action={addClaimAction.bind(null, o.id)} today={now} />}
          files={<SectionFiles orderId={o.id} section="claims" canAdd={d.canFiles} />}
        >
          <ClaimsTable claims={dv.claims} currency={o.currency} sub={o.refNo} actions={canEdit ? Object.fromEntries(dv.claims.map((c) => [c.id, updateClaimAction.bind(null, o.id, c.id)])) : null} />
        </Section>
      ) : (
        <EmptySection title="Claims" text="No claim." action={canEdit && <ClaimAddWindow sub={sub} action={addClaimAction.bind(null, o.id)} today={now} />} />
      )}
    </OrderPage>
  );
}
