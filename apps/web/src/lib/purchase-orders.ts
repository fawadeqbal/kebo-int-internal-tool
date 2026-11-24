/**
 * Purchase orders as their list and their own page read them (GET /operations/purchase-orders): one per
 * supplier on each sales order. A purchase order is made from its sales order and changed there; these
 * pages show it.
 */
export type PurchaseOrderStatus = "not_sent" | "in_production" | "late" | "ready" | "shipped" | "cancelled";

export interface PurchaseOrderRow {
  key: string;
  po: { id: string; number: string } | null;
  status: PurchaseOrderStatus;
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
}

/** GET /operations/purchase-orders/page: one tab's page after the search and filters, with each tab's count. */
export type PurchaseOrderTab = "all" | "not_sent" | "in_production" | "ready" | "shipped" | "cancelled";
export interface PurchaseOrderPage {
  rows: PurchaseOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<PurchaseOrderTab, number>;
  tiles: { open: number; late: number; lateRefs: string[]; readyThisMonth: number; owe: { currency: string; amount: number }[] };
  suppliers: { id: string; name: string }[];
}

export const PURCHASE_ORDER_STATUS: Record<PurchaseOrderStatus, { label: string; meaning: "neutral" | "info" | "warn" | "bad" | "ok" }> = {
  not_sent: { label: "Not sent", meaning: "warn" },
  in_production: { label: "In production", meaning: "info" },
  late: { label: "Ready date passed", meaning: "bad" },
  ready: { label: "Ready", meaning: "ok" },
  // The same colour as the order's "Shipped" (review 24 Nov, X-21: green on one page, blue on another).
  shipped: { label: "Shipped", meaning: "info" },
  cancelled: { label: "Cancelled", meaning: "neutral" },
};

/** The list, and a purchase order's own page: the sales order it is on and the supplier it goes to. */
export const PURCHASE_ORDERS = "/operations/purchase-orders";
export const purchaseOrderHref = (orderId: string, supplierId: string) => `${PURCHASE_ORDERS}/${orderId}/${supplierId}`;
