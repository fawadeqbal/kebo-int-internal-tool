import { RULES } from "@kebo/ui";
import { can, dayMonth, FAT_RESULT_LABEL, FAT_RESULT_TONE, FAT_RESULTS, REQUEST_CHANNEL_LABEL, REQUEST_CHANNELS } from "@kebo/shared";
import { getPeople } from "@/lib/loaders";
import { orderSectionsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date } from "@/lib/format";
import { editsOf } from "@/lib/edit-data";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { FieldsWindow } from "@/components/order-sections/fields-window";
import { AllReceivedWindow } from "@/components/order-sections/production-windows";
import { OrderLinesEditor, OrderLinesView } from "@/components/orders/order-lines";
import { PanelButton } from "@/components/orders/step-view";
import { supplierTestAction, goodsReceivedAction, readyDateAction } from "../../section-actions";
import { stageData } from "../stage-data";
import { orderTitle } from "@/lib/titles";
import { api } from "@/lib/api";
import type { PurchaseOrderView } from "@/components/orders/purchase-order-card";

export const generateMetadata = orderTitle("Production");

const DAY = 86_400_000;

/**
 * Production (design "the order, final"): when the supplier says the goods will be ready, the supplier
 * test, and what came in from the supplier line by line. Nothing else: no timeline of steps and no
 * inspection. An order made at two suppliers shows the first two sections once per supplier.
 */
export default async function OrderProduction({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stageData(id, "production");
  const { me, o, now, defaults } = d;
  const [sections, people, edits, pos] = await Promise.all([
    orderSectionsOf(id),
    optional(() => getPeople()),
    editsOf("order", id),
    // The supplier's own lead time and the ready date it works out to (the PO tab shows the same date).
    optional(() => api.get<{ items: PurchaseOrderView[] }>(`/orders/${id}/purchase-orders`)),
  ]);
  const canEdit = can(me, "orders.update") && d.open;
  const rows = sections.production;
  const many = rows.length > 1;
  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const place = rows.map((r) => r.goodsReceivedAt).find(Boolean) ?? null;
  const lastIn =
    goodsLines
      .map((l) => l.receivedOn)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  const first = rows[0]?.factory?.id ?? null;

  return (
    <OrderPage id={id}>
      {rows.map((r) => {
        const fid = r.factory?.id ?? null;
        const of = many && r.factory ? ` · ${r.factory.name}` : "";
        const sub = `${o.refNo} · ${r.factory?.name ?? "the supplier"}`;
        const left = r.readyOn ? Math.round((Date.parse(r.readyOn) - Date.parse(now)) / DAY) : null;
        // What the supplier's lead time works out to (their offer or the PO), until they give a date of their own.
        const agreed = pos?.items.find((x) => x.supplier.id === fid)?.agreed;
        const expected = agreed?.readyBy && "readyOn" in agreed.readyBy ? agreed.readyBy.readyOn : null;
        const leadHint = agreed?.leadDays
          ? `The supplier's lead time: ${agreed.leadDays} days${expected ? `, which works out to ${date(expected)}` : ""}.`
          : defaults.leadTime
            ? `Lead time we promised the customer: ${defaults.leadTime.text}.`
            : undefined;
        const allIn = o.goods.allReceived;
        const readyWindow = (kind: "edit" | "main") =>
          canEdit && (
            <FieldsWindow
              button={{ label: kind === "main" ? "Add" : "Edit", kind }}
              name={kind === "main" ? "ready-date" : undefined}
              title="Ready date"
              sub={sub}
              action={readyDateAction.bind(null, o.id, fid, r.readyOn)}
              files={d.canFiles ? { orderId: o.id, section: "ready_date" } : undefined}
              fields={[
                {
                  name: "readyOn",
                  label: "Supplier says ready on",
                  type: "date",
                  value: r.readyOn ?? expected,
                  suggested: !r.readyOn && !!expected,
                  hint: leadHint,
                },
                { name: "readyToldOn", label: "Told on", type: "date", value: r.readyToldOn, max: now },
                {
                  name: "readyToldVia",
                  label: "How",
                  type: "select",
                  value: r.readyToldVia ?? "",
                  options: [
                    { value: "", label: "Not said" },
                    ...REQUEST_CHANNELS.map((c) => ({ value: c, label: REQUEST_CHANNEL_LABEL[c] })),
                  ],
                },
                { name: "readyNote", label: "Note", type: "textarea", value: r.readyNote, wide: true },
              ]}
            />
          );
        const fatWindow = (kind: "edit" | "main") =>
          canEdit && (
            <FieldsWindow
              button={{ label: kind === "main" ? "Add" : "Edit", kind: kind === "main" ? "plain" : "edit" }}
              title="Factory test (FAT)"
              sub={sub}
              plain
              action={supplierTestAction.bind(null, o.id, fid)}
              files={d.canFiles ? { orderId: o.id, section: "fat" } : undefined}
              fields={[
                { name: "fatPlannedOn", label: "Planned on", type: "date", value: r.fat.plannedOn },
                {
                  name: "fatAttendedById",
                  label: "Attended by",
                  type: "select",
                  value: r.fat.attendedBy?.id ?? "",
                  options: [{ value: "", label: "Nobody of ours" }, ...(people ?? []).map((p) => ({ value: p.id, label: p.name }))],
                },
                { name: "fatDoneOn", label: "Done on", type: "date", value: r.fat.doneOn, max: now },
                {
                  name: "fatResult",
                  label: "Result",
                  type: "select",
                  value: r.fat.result ?? "",
                  options: [{ value: "", label: "No result yet" }, ...FAT_RESULTS.map((x) => ({ value: x, label: FAT_RESULT_LABEL[x] }))],
                },
                { name: "fatRemarks", label: "Remarks", type: "textarea", value: r.fat.remarks, wide: true },
              ]}
            />
          );
        const hasFat = !!(r.fat.plannedOn || r.fat.doneOn || r.fat.result);
        return (
          // The ready date beside the factory test (two short boxes side by side), per supplier.
          <div key={fid ?? "goods"} className="grid items-start gap-4 lg:grid-cols-2">
            {r.readyOn || r.readyToldOn ? (
              <Section
                title={`Ready date${of}`}
                state={
                  !r.readyOn
                    ? "No date yet"
                    : allIn
                      ? `Ready ${dayMonth(r.readyOn)}`
                      : left! < 0
                        ? `${-left!} day${left === -1 ? "" : "s"} late`
                        : "On time"
                }
                tone={!r.readyOn ? "neutral" : allIn ? "ok" : left! < 0 ? "bad" : "ok"}
                cols={4}
                rows={[
                  { label: "Supplier says ready", value: r.readyOn ? date(r.readyOn) : null },
                  {
                    label: allIn ? "Goods in" : "Days left",
                    value: allIn ? (lastIn ? date(lastIn) : "Yes") : left === null ? null : left < 0 ? `${-left} late` : String(left),
                  },
                  { label: "Ship by", value: o.shipBy ? date(o.shipBy) : null },
                  {
                    label: "Told on",
                    value: r.readyToldOn
                      ? `${date(r.readyToldOn)}${r.readyToldVia ? ` · ${REQUEST_CHANNEL_LABEL[r.readyToldVia]}` : ""}`
                      : r.readyToldVia
                        ? REQUEST_CHANNEL_LABEL[r.readyToldVia]
                        : null,
                  },
                  ...(r.readyNote ? [{ label: "Note", value: r.readyNote }] : []),
                ]}
                actions={readyWindow("edit")}
                files={fid === first ? <SectionFiles orderId={o.id} section="ready_date" canAdd={d.canFiles} /> : undefined}
              />
            ) : (
              <EmptySection
                title={`Ready date${of}`}
                text={
                  expected
                    ? `No date from the supplier yet. Their lead time works out to ${date(expected)}.`
                    : "No ready date from the supplier yet."
                }
                action={readyWindow("main")}
              />
            )}
            {hasFat ? (
              <Section
                title={`Factory test (FAT)${of}`}
                state={
                  r.fat.doneOn
                    ? `${r.fat.result ? FAT_RESULT_LABEL[r.fat.result] : "Done"} ${dayMonth(r.fat.doneOn)}`
                    : r.fat.plannedOn
                      ? `Planned ${dayMonth(r.fat.plannedOn)}`
                      : "Not planned"
                }
                tone={
                  r.fat.doneOn
                    ? r.fat.result
                      ? FAT_RESULT_TONE[r.fat.result]
                      : "ok"
                    : r.fat.plannedOn && r.fat.plannedOn < now
                      ? "bad"
                      : "info"
                }
                cols={4}
                rows={[
                  { label: "Planned on", value: r.fat.plannedOn ? date(r.fat.plannedOn) : null },
                  { label: "Attended by", value: r.fat.attendedBy?.name ?? null },
                  { label: "Done on", value: r.fat.doneOn ? date(r.fat.doneOn) : null },
                  { label: "Result", value: r.fat.result ? FAT_RESULT_LABEL[r.fat.result] : null },
                  ...(r.fat.remarks ? [{ label: "Remarks", value: r.fat.remarks }] : []),
                ]}
                actions={fatWindow("edit")}
                files={fid === first ? <SectionFiles orderId={o.id} section="fat" canAdd={d.canFiles} /> : undefined}
              />
            ) : (
              <EmptySection title={`Factory test (FAT)${of}`} text="Not planned yet." action={fatWindow("main")} />
            )}
          </div>
        );
      })}

      {goodsLines.length > 0 && (
        <Section
          title="Goods from the supplier"
          state={
            o.goods.allReceived
              ? `${o.goods.received} of ${o.goods.lines} received`
              : o.goods.received > 0 || (o.goods.started ?? 0) > 0
                ? [`${o.goods.received} of ${o.goods.lines} received`, o.goods.started ? `${o.goods.started} in part` : null].filter(Boolean).join(" · ")
                : "Not received yet"
          }
          tone={o.goods.allReceived ? "ok" : o.goods.received > 0 || (o.goods.started ?? 0) > 0 ? "warn" : "neutral"}
          rows={
            o.goods.received > 0 || place
              ? [
                  { label: "Received on", value: lastIn ? date(lastIn) : null },
                  { label: "Received at", value: place },
                ]
              : undefined
          }
          actions={
            canEdit && (
              <>
                <PanelButton
                  edit
                  label="Edit items"
                  title="Goods from the supplier"
                  description="What has come in on each item, and when. Nothing is saved until Save changes."
                  panelClassName={RULES.window.items}
                  body={
                    <OrderLinesEditor
                      set="received"
                      orderId={o.id}
                      lines={goodsLines}
                      today={now}
                      edit={{ type: "order", id: o.id, card: "lines.received" }}
                      card={edits.cards["lines.received"]}
                    />
                  }
                />
                {!o.goods.allReceived && (
                  <AllReceivedWindow
                    sub={`${o.refNo} · ${o.goods.lines} item${o.goods.lines === 1 ? "" : "s"}`}
                    action={goodsReceivedAction.bind(null, o.id, first, true)}
                    today={now}
                    place={place}
                    lines={o.goods.lines}
                    readyOn={o.readyOn}
                  />
                )}
                {o.goods.allReceived && (
                  <FieldsWindow
                    button={{ label: "Edit" }}
                    title="Goods from the supplier"
                    sub={`${o.refNo} · where they were received`}
                    plain
                    action={goodsReceivedAction.bind(null, o.id, first, false)}
                    fields={[{ name: "goodsReceivedAt", label: "Received at", value: place, wide: true }]}
                  />
                )}
              </>
            )
          }
          files={<SectionFiles orderId={o.id} section="goods" canAdd={d.canFiles} />}
        >
          <OrderLinesView set="received" lines={goodsLines} label={`${o.refNo} · goods from the supplier`} />
        </Section>
      )}
    </OrderPage>
  );
}
