import { api } from "@/lib/api";
import type { ChecklistSettings } from "@/lib/types-checklist";
import { saveChecklistAction } from "./actions";
import { ChecklistCards } from "./cards";

/** Settings › Order checklist: the items every new order starts with, per step, and the automatic ones the company hides. */
export async function OrderChecklistCard() {
  const v = await api.get<ChecklistSettings>("/settings/checklist");
  return <ChecklistCards value={v} action={saveChecklistAction} />;
}
