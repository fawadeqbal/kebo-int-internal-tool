/**
 * Purchasing's interface (architecture review §7.2): the only module that writes `purchase_orders`. It asks
 * nobody. Orders makes an order's purchase orders when the order is made; Flow places them with the
 * suppliers; Cancellation cancels them; ready dates are set here.
 */
export { cancelPurchaseOrders, openPurchaseOrdersNow, placePurchaseOrders } from "./purchase-orders";
export { readyWords, setReadyAll, setReadyDates } from "./ready-dates";
