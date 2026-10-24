import { twoStepRequired } from "@/lib/auth/permissions";
import { ApiError, apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { findUserById } from "@/modules/users/repository";
import { updateUserSchema } from "@/modules/users/schema";
import { updateUser } from "@/modules/users/service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const actor = await apiUser("users.manage");
  const id = await idParam(params);
  const user = await findUserById(id);
  if (!user) throw new ApiError(404, "User not found");
  return json({ user, twoStepRequired: twoStepRequired(user.role), isSelf: actor.id === id });
});

/** { name, email, role } */
export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const actor = await apiUser("users.manage");
  await updateUser(actor, await idParam(params), parse(updateUserSchema, await formBody(request)));
  return json({ ok: true });
});
