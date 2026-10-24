import { z } from "zod";
import { ApiError, apiUser, formBody, handle, json, page, parse, searchParams } from "@/lib/api/http";
import { parseInvoiceParams } from "@/lib/list-filters";
import { isUuid } from "@/lib/utils/ids";
import { listInvoices } from "@/modules/invoices/repository";
import { invoiceSchema } from "@/modules/invoices/schema";
import { createInvoice } from "@/modules/invoices/service";

export const runtime = "nodejs";

/** ?q&status=outstanding|overdue|unpaid|partially_paid|paid|cancelled&from&to&sort=newest|due|balance&page */
export const GET = handle(async (request: Request) => {
  const user = await apiUser("invoices.manage");
  const sp = searchParams(request);
  const { filters } = parseInvoiceParams(sp);
  return json(await listInvoices(user, { ...filters, page: page(sp.page), pageSize: 25 }));
});

/** { quotationId, issueDate, dueDate, notes? } — the lines, prices, discount and VAT are the accepted quotation's (anything else sent is ignored). */
export const POST = handle(async (request: Request) => {
  const user = await apiUser("invoices.manage");
  const body = await formBody(request);
  const { quotationId } = parse(z.object({ quotationId: z.string() }), body);
  if (!isUuid(quotationId)) throw new ApiError(404, "Quotation not found");
  const created = await createInvoice(user, quotationId, parse(invoiceSchema, body));
  return json({ id: created.id }, 201);
});
