"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertCan, requireUser } from "@/lib/auth/session";
import { handleForm } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { diff, recordAudit } from "@/modules/audit/service";
import { loadSettings, saveSettings, settingsSchema } from "./service";

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const result = await handleForm(formData, settingsSchema, async (data) => {
    assertCan(actor, "settings.manage");
    await db.transaction(async (tx) => {
      const before = await loadSettings(tx);
      await saveSettings(tx, data);
      const changes = diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      if (changes.changed)
        await recordAudit(tx, { userId: actor.id, action: "update", entityType: "settings", summary: "Updated settings", ...changes });
    });
  });
  if (result.ok) {
    revalidatePath("/", "layout");
    return { ok: true, message: "Settings saved." };
  }
  return result;
}
