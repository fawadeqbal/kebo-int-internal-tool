"use client";

import { useActionState, useState } from "react";
import { Alert, Button, ButtonLink, DetailList, Field, Input, Select } from "@/components/ui";
import { EditableCard } from "@/components/ui/editable-card";
import { SubmitButton } from "@/components/ui/client";
import type { ActionState } from "@/lib/utils/result";
import { ROLE_LABELS } from "@/lib/auth/permissions";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function UserForm({
  action,
  initial,
  withPassword,
  onDone,
}: {
  action: Action;
  initial?: { name: string; email: string; role: string };
  withPassword?: boolean;
  /** In a read-then-edit card: close after saving, and Cancel closes. */
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, {});
  const v = (key: string, fallback = "") => (state.values?.[key] as string | undefined) ?? fallback;
  const e = state.errors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name" required error={e.name}>
          <Input id="name" name="name" defaultValue={v("name", initial?.name)} aria-invalid={!!e.name} />
        </Field>
        <Field label="Email" htmlFor="email" required error={e.email} hint="Used to sign in">
          <Input id="email" name="email" type="email" defaultValue={v("email", initial?.email)} aria-invalid={!!e.email} />
        </Field>
        <Field label="Role" htmlFor="role" required error={e.role} hint="Controls what this person can see and do">
          <Select id="role" name="role" defaultValue={v("role", initial?.role ?? "staff")}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {withPassword && (
          <Field label="Temporary password" htmlFor="password" required error={e.password} hint="At least 8 characters, with a letter and a number">
            <Input id="password" name="password" type="text" autoComplete="new-password" aria-invalid={!!e.password} />
          </Field>
        )}
      </div>
      <div className="flex gap-2 border-t border-line pt-4">
        <SubmitButton>{initial ? "Save changes" : "Create user"}</SubmitButton>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : (
          <ButtonLink href="/users" variant="secondary">
            Cancel
          </ButtonLink>
        )}
      </div>
    </form>
  );
}

export function PasswordForm({ action, own, onCancel }: { action: Action; own?: boolean; onCancel?: () => void }) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4" noValidate key={state.ok ? "done" : "form"}>
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      {own && (
        <Field label="Current password" htmlFor="currentPassword" required error={e.currentPassword}>
          <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" />
        </Field>
      )}
      <Field label="New password" htmlFor="password" required error={e.password} hint="At least 8 characters, with a letter and a number">
        <Input id="password" name="password" type={own ? "password" : "text"} autoComplete="new-password" />
      </Field>
      {own && (
        <Field label="Confirm new password" htmlFor="confirm" required error={e.confirm}>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" />
        </Field>
      )}
      <div className="flex gap-2">
        <SubmitButton variant="secondary">{own ? "Change password" : "Set new password"}</SubmitButton>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
        )}
      </div>
    </form>
  );
}

/** A person's profile: shown first, "Edit" opens the form in place. */
export function UserProfileCard({ action, user, roleLabel }: { action: Action; user: { name: string; email: string; role: string }; roleLabel: string }) {
  return (
    <EditableCard
      title="Profile & role"
      read={<DetailList items={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Role", value: roleLabel }]} />}
      edit={(done) => <UserForm action={action} initial={user} onDone={done} />}
    />
  );
}

/** Password: a button first, the form only when asked for. */
export function PasswordCard({ action, own, title, description }: { action: Action; own?: boolean; title: string; description?: string }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <PasswordForm action={action} own={own} onCancel={() => setOpen(false)} />
  ) : (
    <div className="flex flex-col items-start gap-2">
      {description && <p className="text-sm text-muted">{description}</p>}
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {title}
      </Button>
    </div>
  );
}
