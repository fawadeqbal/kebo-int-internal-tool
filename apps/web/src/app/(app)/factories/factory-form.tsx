"use client";

import Link from "next/link";
import { buttonClass, Card, CardBody, CardFooter, CardHeader, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { Person } from "@/lib/types";
import type { Factory } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A factory's details. After an error the typed values stay (s.values), otherwise the saved ones show. */
export function FactoryForm({
  action,
  factory,
  cancelHref,
  people,
  meId,
}: {
  action: Action;
  factory: Factory | null;
  cancelHref: string;
  people: Person[];
  meId: string;
}) {
  return (
    <ActionForm action={action}>
      {(s) => {
        const val = (k: keyof Factory) => s.values?.[k] ?? (factory?.[k] === null || factory?.[k] === undefined ? "" : String(factory[k]));
        return (
          <Card>
            <CardHeader title="Factory" description="Shared by the whole team; never shown to customers" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Factory name"
                htmlFor="name"
                error={s.errors?.name}
                className="sm:col-span-2"
                hint="As it appears on their quotations and contracts"
              >
                <Input id="name" name="name" defaultValue={val("name")} autoFocus={!factory} aria-invalid={!!s.errors?.name} />
              </Field>
              <Field
                label="Looked after by"
                htmlFor="ownerId"
                optional
                error={s.errors?.ownerId}
                className="sm:col-span-2"
                hint="The person in our team who talks to this factory and pays it"
              >
                <Select
                  id="ownerId"
                  name="ownerId"
                  defaultValue={s.values?.ownerId ?? (factory ? (factory.ownerId ?? "") : meId)}
                  className="sm:max-w-80"
                >
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === meId ? `${p.name} (me)` : p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Contact person" htmlFor="contactPerson" optional error={s.errors?.contactPerson}>
                <Input id="contactPerson" name="contactPerson" defaultValue={val("contactPerson")} />
              </Field>
              <Field label="Phone" htmlFor="phone" optional error={s.errors?.phone}>
                <Input id="phone" name="phone" type="tel" defaultValue={val("phone")} />
              </Field>
              <Field label="WeChat" htmlFor="wechat" optional error={s.errors?.wechat}>
                <Input id="wechat" name="wechat" defaultValue={val("wechat")} />
              </Field>
              <Field label="Email" htmlFor="email" optional error={s.errors?.email}>
                <Input id="email" name="email" type="email" defaultValue={val("email")} aria-invalid={!!s.errors?.email} />
              </Field>
              <Field label="Address" htmlFor="address" optional error={s.errors?.address} className="sm:col-span-2">
                <Textarea id="address" name="address" rows={2} className="min-h-0" defaultValue={val("address")} />
              </Field>
              <Field
                label="Bank details"
                htmlFor="bankDetails"
                optional
                error={s.errors?.bankDetails}
                className="sm:col-span-2"
                hint="Account name, bank, account number, for paying them"
              >
                <Textarea id="bankDetails" name="bankDetails" rows={3} defaultValue={val("bankDetails")} />
              </Field>
              <Field
                label="Notes"
                htmlFor="notes"
                optional
                error={s.errors?.notes}
                className="sm:col-span-2"
                hint="What they are good at, lead times, minimum orders…"
              >
                <Textarea id="notes" name="notes" rows={3} defaultValue={val("notes")} />
              </Field>
            </CardBody>
            <CardFooter>
              <Link href={cancelHref} className={buttonClass("ghost")}>
                Cancel
              </Link>
              <SubmitButton pendingText="Saving…">{factory ? "Save changes" : "Add the factory"}</SubmitButton>
            </CardFooter>
          </Card>
        );
      }}
    </ActionForm>
  );
}
