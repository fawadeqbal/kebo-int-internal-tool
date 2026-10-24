import { can } from "@/lib/auth/permissions";
import { ApiError, apiUser, handle, idParam, json } from "@/lib/api/http";
import { todayISO } from "@/lib/utils/dates";
import { fromCents, toCents } from "@/lib/utils/money";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { listPackingListsForQuery } from "@/modules/packing/repository";

export const runtime = "nodejs";

export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser("invoices.manage");
  const id = await idParam(params);
  const detail = await getInvoiceDetail(id);
  if (!detail) throw new ApiError(404, "Invoice not found");
  const inv = detail.invoice;
  const open = inv.status === "unpaid" || inv.status === "partially_paid";
  const packing = (await listPackingListsForQuery(detail.query.id)).filter((p) => p.invoiceId === id);
  return json({
    ...detail,
    displayStatus: invoiceDisplayStatus(inv, todayISO()),
    balance: fromCents(toCents(inv.total) - toCents(inv.amountPaid)),
    packingLists: packing,
    pdf: `/api/invoices/${id}/pdf`,
    can: {
      recordPayment: open && can(user.role, "payments.record"),
      cancel: open && toCents(inv.amountPaid) === 0,
      packingList: inv.status !== "cancelled",
    },
  });
});
