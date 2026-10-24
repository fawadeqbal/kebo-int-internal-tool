import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import { ApiError, apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { customerFinancials, findCustomerFor } from "@/modules/customers/repository";
import { customerSchema } from "@/modules/customers/schema";
import { deleteCustomer, updateCustomer } from "@/modules/customers/service";
import { listQueriesForCustomer } from "@/modules/queries/repository";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser();
  const id = await idParam(params);
  const customer = await findCustomerFor(user, id);
  if (!customer) throw new ApiError(404, "Customer not found");
  const money = can(user.role, "invoices.manage");
  const [inquiries, financials, invoiceRows] = await Promise.all([
    listQueriesForCustomer(user, id),
    money ? customerFinancials(id) : null,
    money
      ? db
          .select({ id: invoices.id, invoiceNo: invoices.invoiceNo, status: invoices.status, total: invoices.total, amountPaid: invoices.amountPaid, dueDate: invoices.dueDate, issueDate: invoices.issueDate })
          .from(invoices)
          .where(and(eq(invoices.customerId, id)))
          .orderBy(desc(invoices.issueDate))
      : [],
  ]);
  return json({
    customer,
    inquiries,
    financials,
    invoices: invoiceRows,
    can: { edit: can(user.role, "customers.manage"), delete: can(user.role, "customers.delete"), newInquiry: can(user.role, "queries.create") },
  });
});

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser("customers.manage");
  await updateCustomer(user, await idParam(params), parse(customerSchema, await formBody(request)));
  return json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("customers.delete");
  await deleteCustomer(user, await idParam(params));
  return json({ ok: true });
});
