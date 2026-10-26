import Link from "next/link";
import { Printer, Ship } from "lucide-react";
import { can, SHIPMENT_STATUS_LABEL, type ShipmentStatus } from "@kebo/shared";
import { Badge, buttonClass, Card, CardBody, CardHeader, DetailList, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, qty } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import type { Shipment, ShipmentLineInput, ShipmentsView } from "@/lib/types-orders";
import { ShipmentEditor, ShipmentSteps, type ShipmentHeader } from "@/components/orders/shipment-forms";
import { today } from "@/components/orders/today";
import { createShipmentAction, documentsReleasedAction, shipmentStatusAction, updateShipmentAction } from "./actions";

export const metadata = { title: "Shipments" };

const TONE: Record<ShipmentStatus, "neutral" | "info" | "ok"> = { planned: "neutral", booked: "info", departed: "info", arrived: "ok" };

const headerOf = (s: Shipment): ShipmentHeader => ({
  forwarder: s.forwarder,
  portOfLoading: s.portOfLoading,
  portOfDischarge: s.portOfDischarge,
  finalDestination: s.finalDestination,
  transport: s.transport,
  containerNos: s.containerNos,
  sealNos: s.sealNos,
  blNo: s.blNo,
  etd: s.etd,
  eta: s.eta,
  marks: s.marks,
  notes: s.notes,
});

export default async function ShipmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  const [o, view, draft] = await Promise.all([
    api.get<OrderView>(`/orders/${id}`),
    api.get<ShipmentsView>(`/orders/${id}/shipments`),
    api.get<{ lines: ShipmentLineInput[] }>(`/orders/${id}/shipments/draft`),
  ]);
  // Shipments can still be updated (arrived, documents) after the order closes; not once it is cancelled.
  const canManage = can(me.role, "shipments.manage") && o.status !== "cancelled";
  const canOverride = can(me.role, "milestones.override");
  const t = today();
  const left = view.remaining.reduce((sum, r) => sum + r.left, 0);
  const step = (key: string) => o.plan.steps.find((s) => s.key === key && s.status === "todo");
  const shipGate = step("shipped")?.blockedBy?.message ?? null;
  const releaseGate = step("documents_released")?.blockedBy?.message ?? null;
  const last = view.shipments.at(-1);
  // A first shipment carries the usual marks: the customer, the order and the destination.
  const marks = [o.customer.name.toUpperCase(), o.refNo, "MADE IN CHINA"].join("\n");

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Goods to ship"
          description={
            left > 0
              ? "What is still to be packed. Plan one shipment for everything, or several smaller ones."
              : "Everything ordered is on a shipment."
          }
        />
        {view.remaining.length === 0 ? (
          <EmptyState icon={Ship} title="No goods lines" description="This order has no goods to ship." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Goods</Th>
                <Th className="text-right">Ordered</Th>
                <Th className="text-right">On shipments</Th>
                <Th className="text-right">Left to ship</Th>
              </tr>
            </THead>
            <tbody>
              {view.remaining.map((r) => (
                <Tr key={r.orderLineId}>
                  <Td className="whitespace-pre-line">{r.description}</Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {qty(r.ordered)} {r.unit}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {qty(r.packed)} {r.unit}
                  </Td>
                  <Td className="text-right font-medium whitespace-nowrap tabular">
                    {r.left > 0 ? `${qty(r.left)} ${r.unit}` : <Badge tone="ok">All packed</Badge>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {canManage && draft.lines.length > 0 && (
          <CardBody className="border-t border-line">
            <ShipmentEditor
              action={createShipmentAction.bind(null, o.id)}
              header={{
                forwarder: last?.forwarder ?? null,
                portOfLoading: last?.portOfLoading ?? (o.incoterm === "FOB" ? o.incotermPlace : null),
                portOfDischarge: last?.portOfDischarge ?? null,
                finalDestination: last?.finalDestination ?? null,
                transport: null,
                containerNos: null,
                sealNos: null,
                blNo: null,
                etd: null,
                eta: null,
                marks: last?.marks ?? marks,
                notes: null,
              }}
              lines={draft.lines.map((l) => ({
                ...l,
                unit: view.remaining.find((r) => r.orderLineId === l.orderLineId)?.unit ?? "pcs",
                max: l.quantity,
              }))}
              trigger="Plan a shipment"
              title="New shipment"
              submitLabel="Save the shipment"
              defaultOpen={sp.new === "1"}
              triggerVariant="primary"
            />
          </CardBody>
        )}
      </Card>

      {view.shipments.length === 0 ? (
        <Card>
          <EmptyState
            icon={Ship}
            title="No shipments yet"
            description="Plan a shipment when the goods are nearly ready. The packing list prints from it."
          />
        </Card>
      ) : (
        view.shipments.map((s) => {
          const others = view.shipments.filter((x) => x.id !== s.id);
          // Gates only bite on the shipment that completes the step.
          const isLastToLeave = left === 0 && others.every((x) => x.status === "departed" || x.status === "arrived");
          const isLastReleased = others.every((x) => !!x.documentsReleasedOn);
          const remainingFor = (orderLineId: string) => view.remaining.find((r) => r.orderLineId === orderLineId);
          const editLines =
            s.status === "planned" || s.status === "booked"
              ? [
                  ...s.lines.map((l) => ({
                    orderLineId: l.orderLineId ?? "",
                    description: l.description,
                    unit: l.unit,
                    max: Number(l.quantity) + (remainingFor(l.orderLineId ?? "")?.left ?? 0),
                    quantity: Number(l.quantity),
                    packages: l.packages,
                    packageType: l.packageType,
                    netWeightKg: Number(l.netWeightKg),
                    grossWeightKg: Number(l.grossWeightKg),
                    cbm: Number(l.cbm),
                  })),
                  // Lines still to ship that are not on it yet can be added.
                  ...view.remaining
                    .filter((r) => r.left > 0 && !s.lines.some((l) => l.orderLineId === r.orderLineId))
                    .map((r) => ({
                      orderLineId: r.orderLineId,
                      description: r.description,
                      unit: r.unit,
                      max: r.left,
                      quantity: 0,
                      packages: 0,
                      packageType: "Carton",
                      netWeightKg: 0,
                      grossWeightKg: 0,
                      cbm: 0,
                    })),
                ]
              : s.lines.map((l) => ({
                  orderLineId: l.orderLineId ?? "",
                  description: l.description,
                  unit: l.unit,
                  max: Number(l.quantity),
                  quantity: Number(l.quantity),
                  packages: l.packages,
                  packageType: l.packageType,
                  netWeightKg: Number(l.netWeightKg),
                  grossWeightKg: Number(l.grossWeightKg),
                  cbm: Number(l.cbm),
                }));
          return (
            <Card key={s.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    Shipment {s.refNo}
                    <Badge tone={TONE[s.status]} dot>
                      {SHIPMENT_STATUS_LABEL[s.status]}
                    </Badge>
                    {s.documentsReleasedOn && <Badge tone="ok">Documents released</Badge>}
                  </span>
                }
                description={[
                  s.departedOn ? `Left ${date(s.departedOn)}` : s.etd ? `ETD ${date(s.etd)}` : "Not left yet",
                  s.eta ? `ETA ${date(s.eta)}` : null,
                  s.documentsReleasedOn ? `documents released ${date(s.documentsReleasedOn)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                actions={
                  <Link href={`/print/shipments/${s.id}`} className={buttonClass("ghost", "sm")}>
                    <Printer aria-hidden /> Packing list
                  </Link>
                }
              />
              <CardBody className="flex flex-col gap-4">
                <DetailList
                  columns={3}
                  items={[
                    { label: "B/L number", value: s.blNo ?? "—" },
                    { label: "Forwarder", value: s.forwarder ?? "—" },
                    { label: "Transport", value: s.transport ?? "—" },
                    {
                      label: "From → to",
                      value:
                        s.portOfLoading || s.portOfDischarge
                          ? `${s.portOfLoading ?? "?"} → ${s.portOfDischarge ?? "?"}${s.finalDestination ? ` (${s.finalDestination})` : ""}`
                          : "—",
                    },
                    {
                      label: "Containers / seals",
                      value: s.containerNos || s.sealNos ? `${s.containerNos ?? "—"} / ${s.sealNos ?? "—"}` : "—",
                    },
                    {
                      label: "Commercial invoice",
                      value: s.invoices.filter((i) => i.status !== "void").length
                        ? s.invoices
                            .filter((i) => i.status !== "void")
                            .map((i) => i.number ?? "draft")
                            .join(", ")
                        : "Not made yet",
                    },
                  ]}
                />
                <Table className="rounded-lg border border-line">
                  <THead>
                    <tr>
                      <Th>Goods</Th>
                      <Th className="text-right">Quantity</Th>
                      <Th className="text-right">Packages</Th>
                      <Th className="text-right">Net kg</Th>
                      <Th className="text-right">Gross kg</Th>
                      <Th className="text-right">CBM</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {s.lines.map((l) => (
                      <Tr key={l.id}>
                        <Td className="whitespace-pre-line">{l.description}</Td>
                        <Td className="text-right whitespace-nowrap tabular">
                          {qty(l.quantity)} {l.unit}
                        </Td>
                        <Td className="text-right whitespace-nowrap tabular">
                          {l.packages} {l.packageType}
                        </Td>
                        <Td className="text-right tabular">{qty(l.netWeightKg)}</Td>
                        <Td className="text-right tabular">{qty(l.grossWeightKg)}</Td>
                        <Td className="text-right tabular">{Number(l.cbm).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Td>
                      </Tr>
                    ))}
                    <Tr className="bg-surface-2/40 font-semibold">
                      <Td>Total</Td>
                      <Td />
                      <Td className="text-right tabular">{s.totals.packages}</Td>
                      <Td className="text-right tabular">{qty(s.totals.netKg)}</Td>
                      <Td className="text-right tabular">{qty(s.totals.grossKg)}</Td>
                      <Td className="text-right tabular">{s.totals.cbm.toLocaleString("en-US", { maximumFractionDigits: 3 })}</Td>
                    </Tr>
                  </tbody>
                </Table>
                {canManage && (
                  <div className="flex flex-wrap items-start gap-2">
                    <ShipmentSteps
                      uid={`sh-${s.refNo}`}
                      status={s.status}
                      released={!!s.documentsReleasedOn}
                      today={t}
                      setStatus={shipmentStatusAction.bind(null, o.id, s.id)}
                      release={documentsReleasedAction.bind(null, o.id, s.id)}
                      canOverride={canOverride}
                      shipGate={isLastToLeave ? shipGate : null}
                      releaseGate={isLastReleased ? releaseGate : null}
                      checklistHref={`/orders/${o.id}`}
                    />
                    <ShipmentEditor
                      action={updateShipmentAction.bind(null, o.id, s.id)}
                      header={headerOf(s)}
                      lines={editLines}
                      linesLocked={s.status === "departed" || s.status === "arrived"}
                      trigger="Edit details"
                      title={`Edit shipment ${s.refNo}`}
                      submitLabel="Save changes"
                      triggerVariant="secondary"
                      triggerSize="xs"
                    />
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
