import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { paymentSchema } from "@/modules/invoices/schema";
import { recordPayment } from "@/modules/invoices/service";
import { getSettings } from "@/modules/settings/service";

export const runtime = "nodejs";

/** { amount, paidAt, method, reference? } */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser("payments.record");
  const data = parse(paymentSchema, await formBody(request));
  await recordPayment(user, await idParam(params), data, (await getSettings()).currency);
  return json({ ok: true, message: "Payment recorded." }, 201);
});
