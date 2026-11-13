"use client";

import { Field, Input } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { FieldRow, SectionWindow } from "./section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "All received": one window that marks every goods line as received in full on a day, and says where.
 * A line that came short or damaged is changed in "Edit lines".
 */
export function AllReceivedWindow({ sub, action, today, place, lines }: { sub: string; action: Action; today: string; place: string | null; lines: number }) {
  return (
    <SectionWindow
      button={{ label: "All received", kind: "plain" }}
      title="Goods from the factory"
      sub={sub}
      action={action}
      submit="Mark all received"
      whats={[`${lines === 1 ? "The line is" : `All ${lines} lines are`} marked received in full on that day.`, "A line that came short or damaged is changed in “Edit lines”."]}
    >
      {(s) => (
        <FieldRow>
          <Field label="Received on" htmlFor="gr-on" error={s.errors?.receivedOn ?? s.errors?.on}>
            <Input id="gr-on" name="receivedOn" type="date" max={today} defaultValue={s.values?.receivedOn ?? today} />
          </Field>
          <Field label="Received at" htmlFor="gr-at" optional error={s.errors?.goodsReceivedAt}>
            <Input id="gr-at" name="goodsReceivedAt" maxLength={160} placeholder="e.g. the forwarder’s warehouse" defaultValue={s.values?.goodsReceivedAt ?? place ?? ""} />
          </Field>
        </FieldRow>
      )}
    </SectionWindow>
  );
}
