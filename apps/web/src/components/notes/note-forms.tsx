"use client";

import { useId } from "react";
import { Check, RotateCcw } from "lucide-react";
import { FOLLOW_UP_KIND_LABEL, FOLLOW_UP_KINDS, NOTE_KIND_LABEL, NOTE_KINDS } from "@kebo/shared";
import { Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelBody, PanelSection, useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { NOTE_ICON } from "./kinds";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Add a note or a call log (the phone's Note sheet): the kind as a row of chips (radio buttons), what
 * happened, who it was with (a customer's contact) and when (empty: now).
 */
export function NoteAddForm({ action, contacts }: { action: Action; contacts?: { id: string; name: string }[] }) {
  const id = useId();
  return (
    <ActionForm action={action} resetOnSuccess showSuccess={false} className="flex flex-col gap-3">
      {(s) => (
        <>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-text-2">Kind</legend>
            <div className="flex flex-wrap gap-1.5">
              {NOTE_KINDS.map((k) => {
                const Icon = NOTE_ICON[k];
                return (
                  <label
                    key={k}
                    className={cn(
                      "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong px-3 text-xs font-medium text-text-2",
                      "has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    )}
                  >
                    <input type="radio" name="kind" value={k} defaultChecked={(s.values?.kind ?? "note") === k} className="sr-only" />
                    <Icon aria-hidden className="size-3.5" />
                    {NOTE_KIND_LABEL[k]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Field label="What happened" htmlFor={`${id}-body`} error={s.errors?.body}>
            <Textarea
              id={`${id}-body`}
              name="body"
              rows={2}
              maxLength={4000}
              className="min-h-0"
              placeholder="e.g. Ali says the bank will pay the balance on Thursday."
              defaultValue={s.values?.body}
              aria-describedby={s.errors?.body ? `${id}-body-error` : undefined}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {contacts && contacts.length > 0 && (
              <Field label="With" optional htmlFor={`${id}-contact`} error={s.errors?.contactId}>
                <Select id={`${id}-contact`} name="contactId" defaultValue={s.values?.contactId ?? ""}>
                  <option value="">Nobody in particular</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="When" optional htmlFor={`${id}-at`} hint="Empty: now" error={s.errors?.at}>
              <Input id={`${id}-at`} name="at" type="datetime-local" defaultValue={s.values?.at} />
            </Field>
          </div>
          <div>
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
              Save the note
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/**
 * New follow-up (side panel): what, kind, when (day and an optional time), where, for whom (default me)
 * and a note. `record`: the record it is on, shown, not chosen.
 */
export function FollowUpForm({
  action,
  people,
  meId,
  today,
  record,
}: {
  action: Action;
  people: { id: string; name: string }[];
  meId: string;
  today: string;
  record?: string;
}) {
  const close = useClosePanel();
  const id = useId();
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
        {(s) => (
          <>
            {record && (
              <p className="text-sm text-text-2">
                On <span className="font-medium text-text">{record}</span>
              </p>
            )}
            <PanelSection first>
              <Field label="What" htmlFor={`${id}-title`} error={s.errors?.title} className="sm:col-span-2">
                <Input
                  id={`${id}-title`}
                  name="title"
                  maxLength={200}
                  required
                  placeholder="e.g. Call Ali about the LC balance"
                  defaultValue={s.values?.title}
                />
              </Field>
              <Field label="Kind" htmlFor={`${id}-kind`} error={s.errors?.kind}>
                <Select id={`${id}-kind`} name="kind" defaultValue={s.values?.kind ?? "call"}>
                  {FOLLOW_UP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {FOLLOW_UP_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="For" htmlFor={`${id}-who`} error={s.errors?.assigneeId}>
                <Select id={`${id}-who`} name="assigneeId" defaultValue={s.values?.assigneeId ?? meId}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === meId ? `Me (${p.name})` : p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="When" htmlFor={`${id}-on`} error={s.errors?.dueOn}>
                <Input id={`${id}-on`} name="dueOn" type="date" required defaultValue={s.values?.dueOn ?? today} />
              </Field>
              <Field label="At" optional htmlFor={`${id}-at`} error={s.errors?.dueAt} hint="A reminder comes 30 minutes before">
                <Input id={`${id}-at`} name="dueAt" type="time" defaultValue={s.values?.dueAt} />
              </Field>
              <Field label="Where" optional htmlFor={`${id}-place`} error={s.errors?.place} className="sm:col-span-2">
                <Input id={`${id}-place`} name="place" maxLength={160} placeholder="e.g. Wenzhou" defaultValue={s.values?.place} />
              </Field>
              <Field label="Note" optional htmlFor={`${id}-note`} error={s.errors?.note} className="sm:col-span-2">
                <Textarea id={`${id}-note`} name="note" rows={3} maxLength={2000} className="min-h-0" defaultValue={s.values?.note} />
              </Field>
            </PanelSection>
            <PanelActions>
              <SubmitButton size="sm" pendingText="Adding…">
                Add the follow-up
              </SubmitButton>
              <Button type="button" size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </PanelActions>
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}

/** "Done" or "Reopen" on a follow-up's row; `what` names it for screen readers. */
export function FollowUpToggle({ action, done, what }: { action: Action; done: boolean; what: string }) {
  return (
    <ActionForm action={action} showSuccess={false}>
      <SubmitButton
        size="sm"
        variant={done ? "ghost" : "secondary"}
        pendingText={done ? "Reopening…" : "Saving…"}
        aria-label={`${done ? "Reopen" : "Mark done:"} ${what}`}
      >
        {done ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
        {done ? "Reopen" : "Done"}
      </SubmitButton>
    </ActionForm>
  );
}

/** A record a follow-up can be about, as the "About" select lists it ("orderId:…" → SO-2026-0033 · Kabul Medical). */
export interface AboutOption {
  value: string;
  label: string;
  group: string;
}

/** The fields a follow-up starts with when edited. */
export interface FollowUpValues {
  title: string;
  assigneeId: string;
  dueOn: string;
  dueAt: string | null;
  place: string | null;
  about?: string;
}

/**
 * A follow-up's fields as the board draws them: What, Who does it, Due, At, Place and (when `about` is given)
 * About. The new one sits in a card beside the list; the same fields edit one in the side panel.
 */
export function FollowUpFields({
  action,
  people,
  meId,
  today,
  about,
  initial,
  submit,
  onDone,
}: {
  action: Action;
  people: { id: string; name: string }[];
  meId: string;
  today: string;
  about?: AboutOption[];
  initial?: FollowUpValues;
  submit: string;
  onDone?: () => void;
}) {
  const id = useId();
  const closePanel = useClosePanel();
  const done = onDone ?? (initial ? (state?: ActionState) => closePanel(state) : undefined);
  const groups = about ? [...new Set(about.map((a) => a.group))] : [];
  return (
    <ActionForm action={action} onDone={done} resetOnSuccess={!initial} className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
      {(s) => (
        <>
          <Field label="What" required htmlFor={`${id}-title`} error={s.errors?.title} className="col-span-2">
            <Input
              id={`${id}-title`}
              name="title"
              maxLength={200}
              required
              placeholder="Call Ahmad about the deposit"
              defaultValue={s.values?.title ?? initial?.title}
            />
          </Field>
          <Field label="Who does it" htmlFor={`${id}-who`} error={s.errors?.assigneeId} className="max-sm:col-span-2">
            <Select id={`${id}-who`} name="assigneeId" defaultValue={s.values?.assigneeId ?? initial?.assigneeId ?? meId}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === meId ? "Me" : p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor={`${id}-on`} error={s.errors?.dueOn}>
            <Input id={`${id}-on`} name="dueOn" type="date" required defaultValue={s.values?.dueOn ?? initial?.dueOn ?? today} />
          </Field>
          <Field label="At" htmlFor={`${id}-at`} error={s.errors?.dueAt}>
            <Input id={`${id}-at`} name="dueAt" type="time" defaultValue={s.values?.dueAt ?? initial?.dueAt ?? undefined} />
          </Field>
          <Field label="Place" htmlFor={`${id}-place`} error={s.errors?.place} className="max-sm:col-span-2">
            <Input
              id={`${id}-place`}
              name="place"
              maxLength={160}
              placeholder="Phone, office, Wenzhou…"
              defaultValue={s.values?.place ?? initial?.place ?? undefined}
            />
          </Field>
          {about && (
            <Field label="About" htmlFor={`${id}-about`} className="col-span-2 sm:col-span-3">
              <Select id={`${id}-about`} name="about" defaultValue={s.values?.about ?? initial?.about ?? ""}>
                <option value="">Nothing in particular</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {about
                      .filter((a) => a.group === g)
                      .map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          )}
          <div className="col-span-2 flex items-center gap-2 sm:col-span-3">
            <SubmitButton pendingText="Saving…">
              <Check aria-hidden />
              {submit}
            </SubmitButton>
            <Button type={initial ? "button" : "reset"} variant="ghost" onClick={initial ? () => done?.() : undefined}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** The list's tick box: ticking marks it done, unticking opens it again. */
export function FollowUpCheck({ action, done, what }: { action: Action; done: boolean; what: string }) {
  return (
    <ActionForm action={action} showSuccess={false}>
      <input
        type="checkbox"
        defaultChecked={done}
        aria-label={`${done ? "Done (untick to reopen)" : "Mark done"}: ${what}`}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="size-[18px] cursor-pointer accent-primary-solid"
      />
    </ActionForm>
  );
}
