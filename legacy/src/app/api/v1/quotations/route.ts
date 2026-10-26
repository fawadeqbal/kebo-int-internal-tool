import { z } from "zod";
import { ApiError, apiUser, formBody, handle, json, page, parse, searchParams } from "@/lib/api/http";
import { parseQuotationParams } from "@/lib/list-filters";
import { isUuid } from "@/lib/utils/ids";
import { listQuotations } from "@/modules/quotations/repository";
import { quotationSchema } from "@/modules/quotations/schema";
import { createQuotation } from "@/modules/quotations/service";
import { listActiveUsers } from "@/modules/users/repository";

export const runtime = "nodejs";

/** ?q&status=draft|sent|accepted|rejected|expired|expiring&by=<user>&from&to&sort=newest|expiry|value&page */
export const GET = handle(async (request: Request) => {
  const user = await apiUser();
  const sp = searchParams(request);
  const { filters } = parseQuotationParams(sp, await listActiveUsers());
  return json(await listQuotations(user, { ...filters, page: page(sp.page), pageSize: 25 }));
});

/** { queryId, items: [{description, quantity, unitPrice}], discount, dueDate, submittedAt?, terms?, notes? } → draft. VAT comes from Settings (none for a VAT-exempt customer); a taxRate sent is ignored. */
export const POST = handle(async (request: Request) => {
  const user = await apiUser("quotations.manage");
  const body = await formBody(request);
  const { queryId } = parse(z.object({ queryId: z.string() }), body);
  if (!isUuid(queryId)) throw new ApiError(404, "Inquiry not found");
  const created = await createQuotation(user, queryId, parse(quotationSchema, body));
  return json({ id: created.id }, 201);
});
