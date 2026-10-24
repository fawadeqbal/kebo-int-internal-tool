import { getSessionUser } from "@/lib/auth/session";
import { can, PERMISSIONS, ROLE_LABELS } from "@/lib/auth/permissions";
import { ApiError, handle, json } from "@/lib/api/http";
import { unreadCount } from "@/modules/notifications/repository";
import { twoStepStatus } from "@/modules/users/two-step";

export const runtime = "nodejs";

/** Who is signed in, what they may do, and whether two-step setup must come first. */
export const GET = handle(async () => {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Please sign in again.");
  const [twoStep, unread] = await Promise.all([twoStepStatus(user.id), user.twoStepSetupRequired ? 0 : unreadCount(user.id)]);
  return json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: ROLE_LABELS[user.role] },
    permissions: PERMISSIONS.filter((p) => can(user.role, p)),
    twoStepSetupRequired: user.twoStepSetupRequired,
    twoStep,
    unreadNotifications: unread,
  });
});
