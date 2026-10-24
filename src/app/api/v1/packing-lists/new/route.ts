import { ApiError, apiUser, handle, json, searchParams } from "@/lib/api/http";
import { todayISO } from "@/lib/utils/dates";
import { isUuid } from "@/lib/utils/ids";
import { getInvoiceDetail } from "@/modules/invoices/repository";

export const runtime = "nodejs";

/** ?invoice=<id> → starting values (lines copied from the invoice). */
export const GET = handle(async (request: Request) => {
  await apiUser("invoices.manage");
  const id = searchParams(request).invoice;
  const detail = isUuid(id) ? await getInvoiceDetail(id) : null;
  if (!detail) throw new ApiError(404, "Invoice not found");
  if (detail.invoice.status === "cancelled") throw new ApiError(400, "This invoice is cancelled, so it cannot be shipped.");
  return json({
    invoice: { id: detail.invoice.id, invoiceNo: detail.invoice.invoiceNo },
    query: { id: detail.query.id, refNo: detail.query.refNo, title: detail.query.title },
    customer: detail.customer,
    initial: {
      items: detail.items.map((i) => ({ description: i.description, quantity: String(Number(i.quantity)), unit: "pcs", packages: "1", packageType: "Wooden case", netWeight: "", grossWeight: "", cbm: "" })),
      packDate: todayISO(),
      incoterm: "",
      portOfLoading: "",
      portOfDischarge: "",
      finalDestination: "",
      transport: "",
      containerNo: "",
      sealNo: "",
      marks: "",
      notes: "",
    },
  });
});
