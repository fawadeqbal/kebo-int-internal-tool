"use server";

import { revalidatePath } from "next/cache";
import type { DevLogs } from "@kebo/shared";
import { platformApi } from "@/lib/api";

/** A service's live log: its end, or (after) only what was written since. */
export async function readLogAction(service: string, after: number | null): Promise<DevLogs> {
  return platformApi.get<DevLogs>("/dev-tools/logs", { service, after: after === null ? undefined : after });
}

/** Marks an error fixed (it opens again if it comes back), or open again. */
export async function markErrorAction(id: string, status: "open" | "fixed") {
  await platformApi.post(`/dev-tools/errors/${encodeURIComponent(id)}/${status === "fixed" ? "fixed" : "open"}`);
  revalidatePath("/platform/dev-tools");
}
