"use server";

import { revalidatePath } from "next/cache";
import { platformApi } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/actions";

/** Save the draft (the live page does not change). */
export async function saveSiteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let draft: unknown;
  try {
    draft = JSON.parse(String(form.get("draft") ?? ""));
  } catch {
    return { ok: false, message: "Could not read the page. Reload and try again." };
  }
  const r = await attempt(null, () => platformApi.put("/site", { draft }), "Draft saved. Publish it when it is ready.");
  revalidatePath("/platform/website");
  return r;
}

/** The draft goes live. */
export async function publishSiteAction(): Promise<ActionState> {
  const r = await attempt(null, () => platformApi.post("/site/publish"), "Published. The page shows the new words now.");
  revalidatePath("/platform/website");
  return r;
}

/** Throw the draft away: back to what visitors see. */
export async function discardSiteAction(): Promise<ActionState> {
  const r = await attempt(null, () => platformApi.post("/site/discard"), "Draft thrown away: back to the live page.");
  revalidatePath("/platform/website");
  return r;
}
