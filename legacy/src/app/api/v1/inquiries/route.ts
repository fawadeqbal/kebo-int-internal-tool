import { apiUser, formBody, handle, json, page, parse, searchParams } from "@/lib/api/http";
import { parseQueryFilters } from "@/modules/queries/filters";
import { countByStatus, listQueries } from "@/modules/queries/repository";
import { createQuerySchema } from "@/modules/queries/schema";
import { createQuery } from "@/modules/queries/service";

export const runtime = "nodejs";

/** Same filters as the web list: ?q&status=open|overdue|pending…&assignee=me|unassigned|<id>&priority&source&category&from&to&sort&page */
export const GET = handle(async (request: Request) => {
  const user = await apiUser();
  const sp = searchParams(request);
  const filters = parseQueryFilters(sp);
  const [list, counts] = await Promise.all([listQueries(user, { ...filters, page: page(sp.page), pageSize: 25 }), countByStatus(user, { ...filters, status: undefined })]);
  return json({ ...list, counts });
});

/**
 * New inquiry. Existing customer: { customerMode: "existing", customerId, … }.
 * New customer: { customerMode: "new", contactPerson, phone, companyName?, email?, … }.
 * 409 { duplicates } when the customer already exists (resend with allowDuplicate: "on" to add anyway).
 */
export const POST = handle(async (request: Request) => {
  const user = await apiUser();
  const data = parse(createQuerySchema, await formBody(request));
  const created = await createQuery(user, data);
  return json({ id: created.id, refNo: created.refNo }, 201);
});
