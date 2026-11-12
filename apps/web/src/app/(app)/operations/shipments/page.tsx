import Link from "next/link";
import { AlertTriangle, Calendar, Check, Download, List, Ship } from "lucide-react";
import { ORDER_DOCUMENT_LABEL, SHIP_MODE_LABEL, SHIPMENT_STATUS_LABEL, type OrderDocumentKind, type ShipMode, type ShipmentStatus } from "@kebo/shared";
import { buildHref, ButtonLink, Card, EmptyState, LinkTabs, PageHeader, Pager, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";

export const metadata = { title: "Shipments" };

type ShipmentRow = {
  id: string;
  what: string;
  papersMissing: OrderDocumentKind[];
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

const MEANING: Record<ShipmentStatus, "neutral" | "info" | "ok" | "warn"> = {
  planned: "neutral",
  booked: "info",
  loaded: "info",
  departed: "ok",
  arrived: "ok",
  cleared: "ok",
};
const CHIPS = [
  { key: "way", label: "On the way", icon: Ship, has: (s: ShipmentStatus) => s === "loaded" || s === "departed" },
  { key: "planned", label: "Planned", icon: Calendar, has: (s: ShipmentStatus) => s === "planned" || s === "booked" },
  { key: "arrived", label: "Arrived", icon: Check, has: (s: ShipmentStatus) => s === "arrived" || s === "cleared" },
  { key: "all", label: "All", icon: List, has: () => true },
] as const;
/** "CO" for a certificate of origin: the paper's initials. */
const shortDoc = (k: OrderDocumentKind) =>
  ORDER_DOCUMENT_LABEL[k]
    .split(/[\s/]+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and)$/i.test(w))
    .map((w) => w[0]!.toUpperCase())
    .join("");
const PAGE = 20;

/** Operations › Shipments (board ShipmentsList): everything on the way, planned or arrived, with its route, container and dates. */
export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; mode?: string; port?: string; page?: string; all?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const all = await api.get<ShipmentRow[]>("/operations/shipments", { all: "true" });
  const view = CHIPS.find((c) => c.key === (sp.view ?? (sp.all === "1" ? "all" : "way"))) ?? CHIPS[0];
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = all
    .filter((r) => view.has(r.status))
    .filter((r) => !q || [r.order.refNo, r.customer.name, r.containerNo, r.blNo, r.vessel, r.what].filter(Boolean).join(" ").toLowerCase().includes(q))
    .filter((r) => !sp.mode || r.mode === sp.mode)
    .filter((r) => !sp.port || r.portOfDischarge === sp.port || r.portOfLoading === sp.port);
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(new Date(today).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const atSea = all.filter((r) => r.status === "departed" || r.status === "loaded");
  const nextEta = atSea.map((r) => r.eta).filter((x): x is string => !!x && x >= today).sort()[0];
  const missing = all.filter((r) => r.status !== "planned" && r.status !== "cleared" && r.papersMissing.length);
  const ports = [...new Set(all.flatMap((r) => [r.portOfDischarge, r.portOfLoading]).filter((x): x is string => !!x))].sort();
  const keep = { view: view.key === "way" ? undefined : view.key, q: sp.q, mode: sp.mode, port: sp.port };
  const href = (p: Record<string, string | undefined>) => buildHref("/operations/shipments", keep, { ...p, page: undefined });

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/operations/shipments")}
        icon={Ship}
        title="Shipments"
        description="Everything on the way"
        actions={
          <ButtonLink href="/sheets/export/shipments?format=csv">
            <Download aria-hidden /> Export CSV
          </ButtonLink>
        }
      />
      <StatRow className="mb-4">
        <StatTile icon={Ship} iconColor={4} label="At sea" value={atSea.length} sub={nextEta ? `next ETA ${date(nextEta)}` : undefined} />
        <StatTile label="Booked" value={all.filter((r) => r.status === "booked").length} />
        <StatTile label="Arriving this week" value={all.filter((r) => r.eta && r.eta >= today && r.eta <= week && !r.arrivedOn).length} />
        <StatTile
          icon={AlertTriangle}
          iconColor={5}
          label="Papers missing"
          value={missing.length}
          tone={missing.length ? "bad" : undefined}
          sub={missing.length ? missing.slice(0, 2).map((r) => `${r.order.refNo} · ${r.papersMissing.map(shortDoc).join(", ")}`).join("; ") : undefined}
        />
      </StatRow>
      <LinkTabs
        label="Which shipments"
        className="mb-4"
        tabs={CHIPS.map((c) => {
          const Icon = c.icon;
          return {
            href: href({ view: c.key === "way" ? undefined : c.key }),
            active: view.key === c.key,
            label: (
              <>
                <Icon aria-hidden /> {c.label}
              </>
            ),
          };
        })}
      />
      <FilterCard
        search="Search container, B/L, SO…"
        value={sp.q}
        keep={{ view: keep.view }}
        clearHref={href({ q: undefined })}
        selects={[
          { name: "mode", label: "Mode", value: sp.mode, options: Object.entries(SHIP_MODE_LABEL).map(([value, label]) => ({ value, label })) },
          { name: "port", label: "Port", value: sp.port, options: ports.map((p) => ({ value: p, label: p })) },
        ]}
      />
      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState title="No shipments" description={all.length ? "Nothing matches. Choose All or clear the search." : "No order has a shipment yet."} />
        ) : (
          <Table className="min-w-[960px]">
            <THead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Mode</Th>
                <Th>Route</Th>
                <Th>Container / AWB</Th>
                <Th>ETD</Th>
                <Th>ETA</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/orders/${r.order.id}/shipping`} className="hover:opacity-80">
                      <RefCode>{r.order.refNo}</RefCode>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/customers/${r.customer.id}`} className="font-semibold hover:text-primary">
                      {r.customer.name}
                    </Link>
                    <span className="block text-xs text-muted">{r.what}</span>
                  </Td>
                  <Td>{SHIP_MODE_LABEL[r.mode]}</Td>
                  <Td className="whitespace-nowrap">{r.portOfLoading || r.portOfDischarge ? `${r.portOfLoading ?? "?"} → ${r.portOfDischarge ?? "?"}` : "—"}</Td>
                  <Td>{r.containerNo ?? (r.mode === "air" ? r.blNo : null) ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{(r.departedOn ?? r.etd) ? date((r.departedOn ?? r.etd)!) : "—"}</Td>
                  <Td className={r.overdue ? "whitespace-nowrap text-bad" : "whitespace-nowrap"}>{(r.arrivedOn ?? r.eta) ? date((r.arrivedOn ?? r.eta)!) : "—"}</Td>
                  <Td>
                    <StatusBadge meaning={r.overdue ? "warn" : MEANING[r.status]}>{SHIPMENT_STATUS_LABEL[r.status]}</StatusBadge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pager base="/operations/shipments" params={keep} page={page} pageSize={PAGE} total={rows.length} bare />
    </div>
  );
}
