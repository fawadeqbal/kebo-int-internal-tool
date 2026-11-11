import Link from "next/link";
import { SHIP_MODE_LABEL, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE, type ShipMode, type ShipmentStatus } from "@kebo/shared";
import { Badge, Card, cn, EmptyState, PageHeader, Segmented, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { crumbsFor, labelFor } from "@/lib/nav";
import { date } from "@/lib/format";

export const metadata = { title: "Fulfillment & logistics" };

type ShipmentRow = {
  id: string;
  order: { id: string; refNo: string };
  customer: { id: string; name: string };
  mode: ShipMode;
  status: ShipmentStatus;
  forwarder: string | null;
  vessel: string | null;
  blNo: string | null;
  containerNo: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  etd: string | null;
  eta: string | null;
  departedOn: string | null;
  arrivedOn: string | null;
  overdue: boolean;
};

/** Operations & trading › Fulfillment & logistics: every shipment of the orders I see, the next to arrive first. */
export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireUser();
  const all = (await searchParams).all === "1";
  const rows = await api.get<ShipmentRow[]>("/operations/shipments", { all: all ? "true" : undefined });
  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/operations/shipments")}
        title={labelFor("/operations/shipments")}
        description="Every shipment, the next to arrive first."
      />
      <Segmented
        label="Which shipments"
        className="mb-4"
        options={[
          { href: "/operations/shipments", label: "Under way", active: !all },
          { href: "/operations/shipments?all=1", label: "All", active: all },
        ]}
      />
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No shipments" description={all ? "No order has a shipment yet." : "Nothing is on the way right now."} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th>Route</Th>
                  <Th className="hidden md:table-cell">Vessel · B/L · container</Th>
                  <Th>Dates</Th>
                  <Th>Status</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/orders/${s.order.id}/shipping`} className="font-medium hover:text-primary">
                        {s.order.refNo}
                      </Link>
                      <span className="block text-xs text-muted">{s.customer.name}</span>
                    </Td>
                    <Td className="text-sm">
                      {SHIP_MODE_LABEL[s.mode]} ·{" "}
                      {[s.portOfLoading, s.portOfDischarge].filter(Boolean).join(" → ") || (
                        <span className="text-muted">ports not set</span>
                      )}
                      {s.forwarder && <span className="block text-xs text-muted">{s.forwarder}</span>}
                    </Td>
                    <Td className="hidden text-sm md:table-cell">
                      {[s.vessel, s.blNo, s.containerNo].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}
                    </Td>
                    <Td className="text-sm whitespace-nowrap">
                      <span className="block">
                        {s.departedOn ? `Left ${date(s.departedOn)}` : s.etd ? `ETD ${date(s.etd)}` : "ETD not set"}
                      </span>
                      <span className={cn("block text-xs", s.overdue ? "font-medium text-bad" : "text-muted")}>
                        {s.arrivedOn
                          ? `Arrived ${date(s.arrivedOn)}`
                          : s.eta
                            ? `ETA ${date(s.eta)}${s.overdue ? " · overdue" : ""}`
                            : "ETA not set"}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
