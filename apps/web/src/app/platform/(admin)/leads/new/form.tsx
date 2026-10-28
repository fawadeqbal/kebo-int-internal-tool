"use client";

import { Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { createLeadAction } from "@/app/platform/actions";

export function NewLeadForm() {
  return (
    <ActionForm action={createLeadAction} className="flex flex-col gap-4">
      {(s) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" htmlFor="companyName" error={s.errors?.companyName}>
              <Input id="companyName" name="companyName" required defaultValue={s.values?.companyName} />
            </Field>
            <Field label="Name" htmlFor="name" error={s.errors?.name}>
              <Input id="name" name="name" required defaultValue={s.values?.name} />
            </Field>
            <Field label="Email" htmlFor="email" error={s.errors?.email}>
              <Input id="email" name="email" type="email" required defaultValue={s.values?.email} />
            </Field>
            <Field label="Phone / WhatsApp" htmlFor="phone" optional>
              <Input id="phone" name="phone" defaultValue={s.values?.phone} />
            </Field>
            <Field label="Country" htmlFor="country" optional>
              <Input id="country" name="country" defaultValue={s.values?.country} />
            </Field>
            <Field label="Team size" htmlFor="teamSize" optional>
              <Select id="teamSize" name="teamSize" defaultValue={s.values?.teamSize ?? ""}>
                <option value="">—</option>
                <option value="1-5">1 to 5</option>
                <option value="6-20">6 to 20</option>
                <option value="21-50">21 to 50</option>
                <option value="51+">More than 50</option>
              </Select>
            </Field>
          </div>
          <Field label="What they need" htmlFor="message" optional>
            <Textarea id="message" name="message" rows={4} defaultValue={s.values?.message} />
          </Field>
          <div>
            <SubmitButton>Add</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
