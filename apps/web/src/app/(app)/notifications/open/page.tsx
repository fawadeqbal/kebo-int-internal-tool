import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { localPath } from "@/lib/paths";

export const metadata = { title: "Notification" };

/**
 * Opens a notification from the list (a row is a link, so a click anywhere on
 * it works): marks it read, then goes where it points (only inside the app).
 * The list's links to here are never prefetched.
 */
export default async function OpenNotification({ searchParams }: { searchParams: Promise<{ id?: string; to?: string }> }) {
  await requireUser();
  const { id, to } = await searchParams;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) await api.post("/notifications/read", { ids: [id] }).catch(() => undefined);
  redirect(localPath(to, "/notifications"));
}
