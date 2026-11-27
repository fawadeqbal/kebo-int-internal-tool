import Link from "next/link";
import { AlertTriangle, Boxes, ShoppingCart } from "lucide-react";
import { buildHref, Card, EmptyState, PhoneList, PhoneRow, LinkTabs, PAGE_SIZE, PageHeader, Pager, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, toPage, toPageSize, Tr, Stack } from "@kebo/ui";
import { ExportCsv } from "@/components/sheets/export-link";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money, short, countOf } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import { getSettings } from "@/lib/loaders";
import { PURCHASE_ORDER_STATUS, purchaseOrderHref, type PurchaseOrderPage } from "@/lib/purchase-orders";

export const metadata = { title: "Purchase orders" };

const STATUS = PURCHASE_ORDER_STATUS;

const CHIPS = [
  { key: "all", label: "All" },
  { key: "not_sent", label: "Not sent" },
  { key: "in_production", label: "In production" },
  { key: "ready", label: "Ready" },
  { key: "shipped", label: "Shipped" },
  { key: "cancelled", label: "Cancelled" },
] as const;

const PAGE = PAGE_SIZE;

/**
 * Purchasing › Purchase orders (board PList): one per supplier on each sales order, with its number, what it
 * costs, what was paid, when it is ready, when it was sent and where it stands. A row opens the purchase
 * order's own page; it is changed on the order's Supplier order tab.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; supplier?: string; ready?: string; page?: string; size?: string }>;
}) {
  await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const chip = CHIPS.some((c) => c.key === sp.status) ? (sp.status as (typeof CHIPS)[number]["key"]) : "all";
  const ready = sp.ready === "month" || sp.ready === "late" || sp.ready === "none" ? sp.ready : undefined;
  const page = toPage(sp.page);
  // Only the page shown comes from the server, with each tab's count and the tiles worked out there.
  const [data, settings] = await Promise.all([
    api.get<PurchaseOrderPage>("/operations/purchase-orders/page", { status: chip, q: sp.q?.trim() || undefined, supplier: sp.supplier, ready, page: String(page), pageSize: String(toPageSize(sp.size, PAGE)) }),
    getSettings(),
  ]);
  const main = settings.sales.currency;
  const { tiles } = data;
  const shown = data.rows;
  const keep = { status: chip === "all" ? undefined : chip, q: sp.q, supplier: sp.supplier, ready };
  const href = (p: Record<string, string | undefined>) => buildHref("/operations/purchase-orders", keep, { ...p, page: undefined });

  return (
    <Stack>
      <PageHeader
        kind="list"
        crumbs={crumbsFor("/operations/purchase-orders")}
        title="Purchase orders"
        more={<ExportCsv what="purchase-orders" query={{ status: chip, q: sp.q, supplier: sp.supplier, ready }} />}
      />
      <StatRow facts>
        <StatTile label="Open purchase orders" value={tiles.open} />
        <StatTile
          icon={ShoppingCart}
          iconColor={2}
          label="We owe suppliers"
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
        tabs={CHIPS.map((c) => {
          return {
            href: href({ status: c.key === "all" ? undefined : c.key }),
            label: c.label,
            count: data.counts[c.key],
            active: chip === c.key,
          };
        })}
      />

      <FilterCard
        count={countOf(data.total, "purchase order")}
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
          <>
          {/* Phones: a row per purchase order — supplier, number and order, its status and total (as every list). */}
          <PhoneList label="Purchase orders">
            {shown.map((r) => (
              <PhoneRow
                key={r.key}
                href={purchaseOrderHref(r.order.id, r.supplier.id)}
                title={r.supplier.name}
                line={`${r.po?.number ?? "PO —"} · for ${r.order.refNo}${r.readyOn ? ` · ready ${date(r.readyOn)}` : ""}`}
                status={<StatusBadge meaning={STATUS[r.status].meaning}>{STATUS[r.status].label}</StatusBadge>}
                figure={money(r.owed, r.currency)}
              />
            ))}
          </PhoneList>
          <div className="max-sm:hidden">
          <Table>
            <THead>
              <tr>
                <Th>Purchase order</Th>
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
                <Tr key={r.key} href={purchaseOrderHref(r.order.id, r.supplier.id)}>
                  <Td>
                    <Link href={purchaseOrderHref(r.order.id, r.supplier.id)} className="hover:opacity-80">
                      <RefCode>{r.po?.number ?? "PO —"}</RefCode>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/suppliers/${r.supplier.id}`} className="inline-block py-1 font-semibold hover:text-primary">
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
          </div>
          </>
        )}
      </Card>
      <Pager base="/operations/purchase-orders" params={keep} page={page} pageSize={toPageSize(sp.size, PAGE)} total={data.total} bare />
    </Stack>
  );
}
