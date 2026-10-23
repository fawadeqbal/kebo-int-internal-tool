"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { markRead } from "./repository";

export async function markAllReadAction() {
  const user = await requireUser();
  await markRead(user.id);
  revalidatePath("/", "layout");
}

/** Mark one notification as read and open what it points to. */
export async function openNotificationAction(id: string, link: string | null) {
  const user = await requireUser();
  if (isUuid(id)) await markRead(user.id, [id]);
  revalidatePath("/", "layout");
  redirect(link && link.startsWith("/") ? link : "/notifications");
}
