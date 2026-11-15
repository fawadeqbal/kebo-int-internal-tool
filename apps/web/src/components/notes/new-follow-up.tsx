"use client";

import { PanelBody, useClosePanel } from "@/components/common/panel";
import { FollowUpFields, type AboutOption } from "./note-forms";

type Action = Parameters<typeof FollowUpFields>[0]["action"];

/** "Add follow-up" from the Follow-ups page: the same fields as before, now in the window; saving closes it. */
export function NewFollowUpBody({
  action,
  people,
  meId,
  today,
  about,
}: {
  action: Action;
  people: { id: string; name: string }[];
  meId: string;
  today: string;
  about?: AboutOption[];
}) {
  const close = useClosePanel();
  return (
    <PanelBody>
      <FollowUpFields action={action} people={people} meId={meId} today={today} about={about} submit="Save follow-up" onDone={() => close({ ok: true })} />
    </PanelBody>
  );
}
