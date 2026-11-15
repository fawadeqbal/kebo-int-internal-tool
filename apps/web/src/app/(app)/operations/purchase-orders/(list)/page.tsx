import Link from "next/link";
import { AlertTriangle, Ban, Boxes, Download, Factory, List, Mail, Package, Ship, ShoppingCart } from "lucide-react";
import { buildHref, ButtonLink, Card, EmptyState, LinkTabs, PAGE_SIZE, PageHeader, Pager, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money, short } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import { getSettings } from "@/lib/loaders";
import { PURCHASE_ORDER_STATUS, purchaseOrderHref, type PurchaseOrderPage } from "@/lib/purchase-orders";

export const metadata = { title: "Purchase orders" };

const STATUS = PURCHASE_ORDER_STATUS;

const CHIPS = [
  { key: "all", label: "All", icon: List },
  { key: "not_sent", label: "Not sent", icon: Mail },
  { key: "in_production", label: "In production", icon: Factory },
  { key: "ready", label: "Ready", icon: Package },
  { key: "shipped", label: "Shipped", icon: Ship },
  { key: "cancelled", label: "Cancelled", icon: Ban },
] as const;

const PAGE = PAGE_SIZE;

/**
 * Purchasing › Purchase orders (board PList): one per supplier on each sales order, with its number, what it
 * costs, what was paid, when it is ready, when it was sent and where it stands. A row opens the purchase
 * order's own page; it is changed on the order's Factory order tab.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; supplier?: string; ready?: string; page?: string }>;
}) {
  await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const chip = CHIPS.some((c) => c.key === sp.status) ? (sp.status as (typeof CHIPS)[number]["key"]) : "all";
  const ready = sp.ready === "month" || sp.ready === "late" || sp.ready === "none" ? sp.ready : undefined;
  const page = toPage(sp.page);
  // Only the page shown comes from the server, with each tab's count and the tiles worked out there.
  const [data, settings] = await Promise.all([
    api.get<PurchaseOrderPage>("/operations/purchase-orders/page", { status: chip, q: sp.q?.trim() || undefined, supplier: sp.supplier, ready, page: String(page), pageSize: String(PAGE) }),
    getSettings(),
  ]);
  const main = settings.sales.currency;
  const { tiles } = data;
  const shown = data.rows;
  const keep = { status: chip === "all" ? undefined : chip, q: sp.q, supplier: sp.supplier, ready };
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
        <StatTile label="Open POs" value={tiles.open} />
        <StatTile
          icon={ShoppingCart}
          iconColor={2}
          label="We owe factories"
          value={tiles.owe.length ? short(tiles.owe[0]!.amount, tiles.owe[0]!.currency) : money(0, main)}
          sub={tiles.owe.length > 1 ? tiles.owe.slice(1).map((o) => short(o.amount, o.currency)).join(" · ") : undefined}
        />
        <StatTile icon={Boxes} iconColor={3} label="Ready this month" value={tiles.readyThisMonth} />
        <StatTile
          icon={AlertTriangle}
          iconColor={5}
          label="Late"
          value={tiles.late}
          tone={tiles.late ? "bad" : undefined}
          sub={tiles.late ? tiles.lateRefs.join(", ") : undefined}
          href={tiles.late ? href({ status: "in_production", ready: "late" }) : undefined}
        />
      </StatRow>

      <LinkTabs
        label="Which purchase orders"
        className="mb-4"
        tabs={CHIPS.map((c) => {
          const Icon = c.icon;
          return {
            href: href({ status: c.key === "all" ? undefined : c.key }),
            label: (
              <>
                <Icon aria-hidden />
                {c.label}
              </>
            ),
            count: data.counts[c.key],
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
          { name: "supplier", label: "Supplier", value: sp.supplier, options: data.suppliers.map((x) => ({ value: x.id, label: x.name })) },
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
            title={data.suppliers.length ? "No purchase order matches" : "No purchase orders yet"}
            description={data.suppliers.length ? "Clear the search or choose All." : "Each supplier on a sales order gets one, numbered PO-2026-0001, when the order is made."}
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
                    <Link href={purchaseOrderHref(r.order.id, r.supplier.id)} className="hover:opacity-80">
                      <RefCode>{r.po?.number ?? "PO —"}</RefCode>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/factories/${r.supplier.id}`} className="inline-block py-1 font-semibold hover:text-primary">
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
      <Pager base="/operations/purchase-orders" params={keep} page={page} pageSize={PAGE} total={data.total} bare />
    </div>
  );
}
