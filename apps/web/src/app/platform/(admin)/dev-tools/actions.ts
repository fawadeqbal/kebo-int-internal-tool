"use server";

import type { DevLogs } from "@kebo/shared";
import { platformApi } from "@/lib/api";

/** A service's live log: its end, or (after) only what was written since. */
export async function readLogAction(service: string, after: number | null): Promise<DevLogs> {
  return platformApi.get<DevLogs>("/dev-tools/logs", { service, after: after === null ? undefined : after });
}
