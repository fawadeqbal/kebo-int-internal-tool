import { z } from "zod";
import { ApiError, apiUser, formBody, handle, json, parse } from "@/lib/api/http";
import { isUuid } from "@/lib/utils/ids";
import { packingListSchema } from "@/modules/packing/schema";
import { createPackingList } from "@/modules/packing/service";

export const runtime = "nodejs";

/**
 * { invoiceId, packDate, items: [{description, quantity, unit, packages, packageType, netWeight, grossWeight, cbm}],
 *   incoterm?, portOfLoading?, portOfDischarge?, finalDestination?, transport?, containerNo?, sealNo?, marks?, notes? }
 */
export const POST = handle(async (request: Request) => {
  const user = await apiUser("invoices.manage");
  const body = await formBody(request);
  const { invoiceId } = parse(z.object({ invoiceId: z.string() }), body);
  if (!isUuid(invoiceId)) throw new ApiError(404, "Invoice not found");
  const created = await createPackingList(user, invoiceId, parse(packingListSchema, body));
  return json({ id: created.id, plNo: created.plNo }, 201);
});
