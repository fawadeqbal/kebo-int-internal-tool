import { apiUser, formBody, handle, json, parse } from "@/lib/api/http";
import { listUsers } from "@/modules/users/repository";
import { createUserSchema } from "@/modules/users/schema";
import { createUser } from "@/modules/users/service";

export const runtime = "nodejs";

export const GET = handle(async () => {
  await apiUser("users.manage");
  return json({ users: await listUsers() });
});

/** { name, email, role: admin|manager|staff, password } */
export const POST = handle(async (request: Request) => {
  const actor = await apiUser("users.manage");
  const created = await createUser(actor, parse(createUserSchema, await formBody(request)));
  return json({ id: created.id }, 201);
});
