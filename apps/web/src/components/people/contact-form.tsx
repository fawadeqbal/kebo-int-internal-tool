"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { Button, Checkbox, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { Contact } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A customer's contact (board "Customer — Contacts tab"): Name, Position, Email, Phone, WhatsApp, WeChat and
 * Primary contact. New in the card beside the list; the same fields edit one in the side panel.
 */
export function ContactForm({ action, contact }: { action: Action; contact?: Contact }) {
  const id = useId();
  const close = useClosePanel();
  const f = (k: keyof Contact) => (contact?.[k] as string | null | undefined) ?? undefined;
  return (
    <ActionForm
      action={action}
      resetOnSuccess={!contact}
      onDone={contact ? (s) => close(s) : undefined}
      className="grid grid-cols-2 gap-4 sm:grid-cols-3"
    >
      {(s) => (
        <>
          <Field label="Name" required htmlFor={`${id}-name`} error={s.errors?.name} className="col-span-2">
            <Input id={`${id}-name`} name="name" maxLength={120} required defaultValue={s.values?.name ?? f("name")} />
          </Field>
          <Field label="Position" htmlFor={`${id}-position`} error={s.errors?.position} className="max-sm:col-span-2">
            <Input
              id={`${id}-position`}
              name="position"
              maxLength={80}
              placeholder="Purchasing manager"
              defaultValue={s.values?.position ?? f("position")}
            />
          </Field>
          <Field label="Email" htmlFor={`${id}-email`} error={s.errors?.email}>
            <Input id={`${id}-email`} name="email" type="email" defaultValue={s.values?.email ?? f("email")} />
          </Field>
          <Field label="Phone" htmlFor={`${id}-phone`} error={s.errors?.phone}>
            <Input id={`${id}-phone`} name="phone" inputMode="tel" defaultValue={s.values?.phone ?? f("phone")} />
          </Field>
          <Field label="WhatsApp" htmlFor={`${id}-whatsapp`} error={s.errors?.whatsapp}>
            <Input id={`${id}-whatsapp`} name="whatsapp" inputMode="tel" defaultValue={s.values?.whatsapp ?? f("whatsapp")} />
          </Field>
          <Field label="WeChat" htmlFor={`${id}-wechat`} error={s.errors?.wechat}>
            <Input id={`${id}-wechat`} name="wechat" maxLength={80} defaultValue={s.values?.wechat ?? f("wechat")} />
          </Field>
          <label className="col-span-2 flex items-center gap-2.5 self-end pb-2.5 text-sm">
            <Checkbox name="isPrimary" defaultChecked={contact?.isPrimary} />
            Primary contact
          </label>
          <p className="col-span-2 text-xs text-muted sm:col-span-3">Give at least one way to reach them.</p>
          <div className="col-span-2 flex items-center gap-2 border-t border-surface-2 pt-4 sm:col-span-3">
            <SubmitButton pendingText="Saving…">
              <Check aria-hidden />
              Save contact
            </SubmitButton>
            <Button type={contact ? "button" : "reset"} variant="ghost" onClick={contact ? () => close() : undefined}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
