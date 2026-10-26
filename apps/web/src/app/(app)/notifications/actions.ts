"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/actions";

/** Only paths inside the app (no open redirects). */
const safeLink = (link: string | null) => (link && link.startsWith("/") && !link.startsWith("//") ? link : "/notifications");

export async function markAllReadAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.post("/notifications/read", { ids: "all" }), "All caught up.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Open a notification: mark it read, then go where it points. */
export async function openNotificationAction(id: string, link: string | null): Promise<void> {
  await api.post("/notifications/read", { ids: [id] }).catch(() => undefined);
  revalidatePath("/", "layout");
  redirect(safeLink(link));
}
