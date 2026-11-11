import type { Prisma } from "@kebo/database";
import { can } from "@kebo/shared";
import type { SessionUser } from "./session-user";

/** The orders a person may see: every order with "see all inquiries", else those of the deals they handle or made. */
export function orderAccess(user: SessionUser): Prisma.OrderWhereInput {
  if (can(user, "inquiries.viewAll")) return {};
  return { inquiry: { OR: [{ assigneeId: user.id }, { createdById: user.id }] } };
}
