import Link from "next/link";
import { AlertTriangle, Ban, Boxes, Download, Factory, List, Mail, Package, Ship, ShoppingCart } from "lucide-react";
import { buildHref, ButtonLink, Card, EmptyState, LinkTabs, PageHeader, Pager, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money, short } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import { getSettings } from "@/lib/loaders";

export const metadata = { title: "Purchase orders" };

type Status = "not_sent" | "in_production" | "late" | "ready" | "shipped" | "cancelled";

type PurchaseOrderRow = {
  key: string;
  po: { id: string; number: string } | null;
  status: Status;
  sentEarlyReason: string | null;
  order: { id: string; refNo: string; stage: string; closed: boolean };
  customer: { id: string; name: string };
  supplier: { id: string; name: string };
  orderedOn: string | null;
  supplierRef: string | null;
  readyOn: string | null;
  late: boolean;
  currency: string;
  owed: string;
  paid: string;
  toPay: string;
};

const STATUS: Record<Status, { label: string; meaning: "neutral" | "info" | "warn" | "bad" | "ok" }> = {
  not_sent: { label: "Not sent", meaning: "warn" },
  in_production: { label: "In production", meaning: "info" },
  late: { label: "Ready date passed", meaning: "bad" },
  ready: { label: "Ready", meaning: "ok" },
  shipped: { label: "Shipped", meaning: "ok" },
  cancelled: { label: "Cancelled", meaning: "neutral" },
};

const CHIPS = [
  { key: "all", label: "All", icon: List },
  { key: "not_sent", label: "Not sent", icon: Mail },
  { key: "in_production", label: "In production", icon: Factory },
  { key: "ready", label: "Ready", icon: Package },
  { key: "shipped", label: "Shipped", icon: Ship },
  { key: "cancelled", label: "Cancelled", icon: Ban },
] as const;

const PAGE = 20;

/**
 * Operations › Purchase orders (board PurchaseOrdersList): one per supplier on each sales order, with its number,
 * what it costs, what was paid, when it is ready, when it was sent and where it stands. Changed on the order's
 * Factory tab.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; supplier?: string; ready?: string; page?: string }>;
}) {
  await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const [all, settings] = await Promise.all([api.get<PurchaseOrderRow[]>("/operations/purchase-orders", { all: "true" }), getSettings()]);
  const main = settings.sales.currency;
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const chip = CHIPS.some((c) => c.key === sp.status) ? (sp.status as (typeof CHIPS)[number]["key"]) : "all";
  const inChip = (r: PurchaseOrderRow, c: string) => c === "all" || r.status === c || (c === "in_production" && r.status === "late");
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = all
    .filter((r) => inChip(r, chip))
    .filter((r) => !q || [r.po?.number, r.supplier.name, r.order.refNo, r.customer.name, r.supplierRef].filter(Boolean).join(" ").toLowerCase().includes(q))
    .filter((r) => !sp.supplier || r.supplier.id === sp.supplier)
    .filter((r) => !sp.ready || (sp.ready === "month" ? r.readyOn?.startsWith(month) : sp.ready === "late" ? r.status === "late" : sp.ready === "none" ? !r.readyOn : true));
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const open = all.filter((r) => r.status !== "cancelled" && r.status !== "shipped");
  const late = all.filter((r) => r.status === "late");
  // What we still owe factories, in each currency (the tile shows the largest, the rest under it).
  const owe = new Map<string, number>();
  for (const r of all) if (r.status !== "cancelled" && Number(r.toPay) > 0) owe.set(r.currency, (owe.get(r.currency) ?? 0) + Number(r.toPay));
  const oweList = [...owe.entries()].sort((a, b) => b[1] - a[1]);
  const suppliers = [...new Map(all.map((r) => [r.supplier.id, r.supplier.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const keep = { status: chip === "all" ? undefined : chip, q: sp.q, supplier: sp.supplier, ready: sp.ready };
  const href = (p: Record<string, string | undefined>) => buildHref("/operations/purchase-orders", keep, { ...p, page: undefined });

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/operations/purchase-orders")}
        icon={ShoppingCart}
        title="Purchase orders"
        description="One per supplier on each sales order"
        actions={
          <ButtonLink href="/sheets/export/purchase-orders?format=csv">
            <Download aria-hidden /> Export CSV
          </ButtonLink>
        }
      />
      <StatRow className="mb-4">
        <StatTile label="Open POs" value={open.length} />
        <StatTile
          icon={ShoppingCart}
          iconColor={2}
          label="We owe factories"
          value={oweList.length ? short(oweList[0]![1], oweList[0]![0]) : money(0, main)}
          sub={oweList.length > 1 ? oweList.slice(1).map(([c, v]) => short(v, c)).join(" · ") : undefined}
        />
        <StatTile icon={Boxes} iconColor={3} label="Ready this month" value={all.filter((r) => r.readyOn?.startsWith(month) && r.status !== "cancelled").length} />
        <StatTile
          icon={AlertTriangle}
          iconColor={5}
          label="Late"
          value={late.length}
          tone={late.length ? "bad" : undefined}
          sub={late.length ? late.map((r) => r.po?.number ?? r.order.refNo).slice(0, 2).join(", ") : undefined}
          href={late.length ? href({ status: "in_production", ready: "late" }) : undefined}
        />
      </StatRow>

      <LinkTabs
        label="Which purchase orders"
        className="mb-4"
        tabs={CHIPS.map((c) => {
          const n = c.key === "all" ? 0 : all.filter((r) => inChip(r, c.key)).length;
          const Icon = c.icon;
          return {
            href: href({ status: c.key === "all" ? undefined : c.key }),
            label: (
              <>
                <Icon aria-hidden />
                {c.label}
                {n && (c.key === "not_sent" || c.key === "in_production") ? ` ${n}` : ""}
              </>
            ),
            active: chip === c.key,
          };
        })}
      />

      <FilterCard
        search="Search PO, supplier, SO…"
        value={sp.q}
        keep={{ status: keep.status }}
        clearHref={href({ q: undefined })}
        selects={[
          { name: "supplier", label: "Supplier", value: sp.supplier, options: suppliers.map(([value, label]) => ({ value, label })) },
          {
            name: "ready",
            label: "Ready",
            value: sp.ready,
            options: [
              { value: "month", label: "This month" },
              { value: "late", label: "Date passed" },
              { value: "none", label: "No date yet" },
            ],
          },
        ]}
      />

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState
            title={all.length ? "No purchase order matches" : "No purchase orders yet"}
            description={all.length ? "Clear the search or choose All." : "Each supplier on a sales order gets one, numbered PO-2026-0001, when the order is made."}
          />
        ) : (
          <Table className="min-w-[900px]">
            <THead>
              <tr>
                <Th>PO</Th>
                <Th>Supplier · for</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Paid</Th>
                <Th>Ready</Th>
                <Th>Sent</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <tbody>
              {shown.map((r) => (
                <Tr key={r.key}>
                  <Td>
                    <Link href={`/orders/${r.order.id}/factory`} className="hover:opacity-80">
                      <RefCode>{r.po?.number ?? "PO —"}</RefCode>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/factories/${r.supplier.id}`} className="font-semibold hover:text-primary">
                      {r.supplier.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      for{" "}
                      <Link href={`/orders/${r.order.id}`} className="hover:underline">
                        {r.order.refNo}
                      </Link>{" "}
                      · {r.customer.name}
                    </span>
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(r.owed, r.currency)}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{Number(r.paid) > 0 ? money(r.paid, r.currency) : "—"}</Td>
                  <Td className="whitespace-nowrap">{r.readyOn ? date(r.readyOn) : "—"}</Td>
                  <Td className="whitespace-nowrap">
                    {r.orderedOn ? date(r.orderedOn) : "—"}
                    {r.sentEarlyReason && <span className="block text-xs text-warn">before deposit</span>}
                  </Td>
                  <Td>
                    <StatusBadge meaning={STATUS[r.status].meaning}>{STATUS[r.status].label}</StatusBadge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pager base="/operations/purchase-orders" params={keep} page={page} pageSize={PAGE} total={rows.length} bare />
    </div>
  );
}
