import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import type { ChecklistSettings } from "@/lib/types-checklist";
import { saveChecklistAction } from "./actions";
import { ChecklistEditor } from "./editor";

/** Settings › Order checklist: the items every new order starts with, per step, and the automatic ones the company hides. */
export async function OrderChecklistCard() {
  const v = await api.get<ChecklistSettings>("/settings/checklist");
  return (
    <Card>
      <CardHeader
        title="Order checklist"
        description="The items every new order starts with, step by step, and the tool each one has. Orders already started keep their own list."
      />
      <CardBody>
        <ChecklistEditor initial={v} action={saveChecklistAction} />
      </CardBody>
    </Card>
  );
}
