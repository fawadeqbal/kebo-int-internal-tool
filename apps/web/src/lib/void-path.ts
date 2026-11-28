/**
 * The endpoints that remove a payment (each checks who may). A page passes the one the API named; the old address of
 * supplier payments (`factory-payments`, before rename R1b on 28 Nov 2026) still counts for pages opened before it.
 */
const VOID_PATH =
  /^\/(payments|customer-receipts|customer-credits|supplier-payments|factory-payments|expenses|money\/transfers)\/[0-9a-f-]{36}\/void$/i;

export const isVoidPath = (path: string): boolean => VOID_PATH.test(path);
