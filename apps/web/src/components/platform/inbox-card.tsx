"use client";

import type { PlatformMailView } from "@kebo/shared";
import { Card, CardBody, CardHeader, Field, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { FormButtons } from "@/components/common/route-window";
import type { ActionState } from "@/lib/actions";

/**
 * Platform settings › Emails: where the platform's own emails go (new client inquiries, sign-ups, demos ending,
 * server warnings). Empty: the server's PLATFORM_EMAIL, else every platform admin.
 */
export function InboxCard({
  view,
  action,
}: {
  view: PlatformMailView;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Where platform emails go" description="New client inquiries, sign-ups, demos ending, server warnings" />
      <CardBody>
        <ActionForm action={action} keepFields className="flex flex-col gap-4">
          {(st) => (
            <>
              <Field
                label="Send them to"
                htmlFor="inbox-emails"
                optional
                error={st.errors?.emails ?? Object.entries(st.errors ?? {}).find(([k]) => k.startsWith("emails."))?.[1]}
                hint="One address a line, or separated by commas. At most 10. Leave empty for the default."
              >
                <Textarea
                  id="inbox-emails"
                  name="emails"
                  rows={3}
                  defaultValue={st.values?.emails ?? view.inbox.join("\n")}
                  placeholder="you@example.com"
                />
              </Field>
              <p className="text-sm text-text-2">
                Now:{" "}
                <span className="font-medium text-text">
                  {view.inboxFrom === "admins" ? `every platform admin (${view.inboxNow.length})` : view.inboxNow.join(", ") || "nobody"}
                </span>
                {view.inboxFrom === "server" && " · from the server's PLATFORM_EMAIL"}
              </p>
              <FormButtons>
                <SubmitButton>Save</SubmitButton>
              </FormButtons>
            </>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}
