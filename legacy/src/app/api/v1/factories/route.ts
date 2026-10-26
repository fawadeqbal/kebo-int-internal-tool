import { apiUser, formBody, handle, json, page, parse, searchParams } from "@/lib/api/http";
import { listSuppliers } from "@/modules/sourcing/repository";
import { supplierSchema } from "@/modules/sourcing/schema";
import { createSupplier } from "@/modules/sourcing/service";

export const runtime = "nodejs";

/** ?q&page — the factories (suppliers), A–Z, with how many offers each made. */
export const GET = handle(async (request: Request) => {
  await apiUser("sourcing.manage");
  const sp = searchParams(request);
  return json(await listSuppliers({ q: sp.q, page: page(sp.page) }));
});

export const POST = handle(async (request: Request) => {
  const user = await apiUser("sourcing.manage");
  const created = await createSupplier(user, parse(supplierSchema, await formBody(request)));
  return json({ id: created.id }, 201);
});
