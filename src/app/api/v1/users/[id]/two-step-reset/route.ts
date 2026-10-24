import { apiUser, handle, idParam, json } from "@/lib/api/http";
import { adminResetTwoStep } from "@/modules/users/two-step";

export const runtime = "nodejs";

/** For a lost phone: two-step sign-in is cleared and they are signed out; they set it up again at next sign-in. */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await apiUser("users.manage");
  await adminResetTwoStep(actor, await idParam(params));
  return json({ ok: true });
});
