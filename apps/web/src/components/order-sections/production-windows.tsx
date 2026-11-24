"use client";

import { useState } from "react";
import { daysBetween } from "@kebo/utils";
import { Field, Input } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { useTime } from "@/lib/time-client";
import { FieldRow, SectionWindow } from "./section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "All received": one window that marks every goods line as received in full on a day, and says where.
 * A line that came short or damaged is changed in "Edit lines".
 */
export function AllReceivedWindow({
  sub,
  action,
  today,
  place,
  lines,
  readyOn,
}: {
  sub: string;
  action: Action;
  today: string;
  place: string | null;
  lines: number;
  /** The supplier's ready date: goods in well before it are asked about (e2e 24 Nov: in 26 days early, no word). */
  readyOn?: string | null;
}) {
  const { dayMonth } = useTime();
  const [on, setOn] = useState(today);
  const early = readyOn && on ? daysBetween(on, readyOn) : 0;
  return (
    <SectionWindow
      button={{ label: "All received", kind: "plain" }}
      name="all-received"
      title="Goods from the supplier"
      sub={sub}
      action={action}
      submit="Mark all received"
      whats={[`${lines === 1 ? "The item is" : `All ${lines} items are`} marked received in full on that day.`, "An item that came short or damaged is changed in “Edit items”."]}
    >
      {(s) => (
        <FieldRow>
          <Field
            label="Received on"
            htmlFor="gr-on"
            error={s.errors?.receivedOn ?? s.errors?.on}
            hint={
              early > 7 ? (
                <span className="font-medium text-action">
                  {early} days before the supplier&apos;s ready date ({dayMonth(readyOn!)}): is the date right?
                </span>
              ) : undefined
            }
          >
            <Input id="gr-on" name="receivedOn" type="date" max={today} defaultValue={s.values?.receivedOn ?? today} onChange={(e) => setOn(e.target.value)} />
          </Field>
          <Field label="Received at" htmlFor="gr-at" optional error={s.errors?.goodsReceivedAt}>
            <Input id="gr-at" name="goodsReceivedAt" maxLength={160} defaultValue={s.values?.goodsReceivedAt ?? place ?? ""} />
          </Field>
        </FieldRow>
      )}
    </SectionWindow>
  );
}
