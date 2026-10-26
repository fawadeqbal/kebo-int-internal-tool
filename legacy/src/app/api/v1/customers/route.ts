import { apiUser, formBody, handle, json, page, parse, searchParams } from "@/lib/api/http";
import { parseCustomerParams } from "@/lib/list-filters";
import { countCustomersByStatus, listCustomers } from "@/modules/customers/repository";
import { customerSchema } from "@/modules/customers/schema";
import { createCustomer } from "@/modules/customers/service";

export const runtime = "nodejs";

/**
 * ?q&status=active|inactive&has=open|unpaid|none&sort=company|recent&page — Staff get only their own customers.
 * Each row says whether the customer is `active`; `counts` gives { all, active, inactive } for the Status tabs.
 * Quick search: /api/customers/search?q=
 */
export const GET = handle(async (request: Request) => {
  const user = await apiUser();
  const sp = searchParams(request);
  const { filters } = parseCustomerParams(sp);
  const [list, counts] = await Promise.all([listCustomers(user, { ...filters, page: page(sp.page), pageSize: 25 }), countCustomersByStatus(user, filters)]);
  return json({ ...list, counts });
});

/** 409 { duplicates } when the phone or email exists; resend with allowDuplicate: "on" to add anyway. */
export const POST = handle(async (request: Request) => {
  const user = await apiUser("customers.manage");
  const created = await createCustomer(user, parse(customerSchema, await formBody(request)));
  return json({ id: created.id }, 201);
});
