"use client";

import { useState } from "react";
import Link from "next/link";
import { ROLE_LABEL, ROLES, type Role } from "@kebo/shared";
import { buttonClass, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const ROLE_HINT: Record<Role, string> = {
  staff: "Works the deals and orders they handle; sees only their own customers.",
  manager: "Sees and changes everything, assigns work, sees money and reports.",
  admin: "Everything a manager does, plus people and settings.",
};

const PASSWORD_HINT = "At least 10 characters, with letters and at least one number.";

function RoleField({ value, error, disabled }: { value: string; error?: string[]; disabled?: boolean }) {
  const [picked, setPicked] = useState(value);
  return (
    <Field label="Role" htmlFor="role" error={error} hint={disabled ? "You cannot change your own role." : ROLE_HINT[picked as Role]}>
      {/* Keyed by the value: a select's default only applies when it mounts, and React resets the form after each submit. */}
      <Select key={value} id="role" name="role" defaultValue={value} disabled={disabled} onChange={(e) => setPicked(e.target.value)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function NewUserForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {(s) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={s.errors?.name}>
              <Input id="name" name="name" defaultValue={s.values?.name} autoFocus aria-invalid={!!s.errors?.name} />
            </Field>
            <Field label="Email" htmlFor="email" error={s.errors?.email} hint="They sign in with this">
              <Input id="email" name="email" type="email" autoComplete="off" defaultValue={s.values?.email} aria-invalid={!!s.errors?.email} />
            </Field>
            <RoleField value={s.values?.role ?? "staff"} error={s.errors?.role} />
            <Field label="First password" htmlFor="password" error={s.errors?.password} hint={`${PASSWORD_HINT} Give it to them privately; they can change it under My account.`}>
              <Input id="password" name="password" type="text" autoComplete="new-password" spellCheck={false} defaultValue={s.values?.password} aria-invalid={!!s.errors?.password} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Link href="/users" className={buttonClass("ghost")}>
              Cancel
            </Link>
            <SubmitButton pendingText="Adding…">Add the person</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function EditUserForm({ action, user, isMe }: { action: Action; user: { name: string; email: string; role: Role }; isMe: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {(s) => (
        <>
          <Field label="Name" htmlFor="name" error={s.errors?.name}>
            <Input id="name" name="name" defaultValue={s.values?.name ?? user.name} aria-invalid={!!s.errors?.name} />
          </Field>
          <Field label="Email" htmlFor="email" error={s.errors?.email} hint="They sign in with this">
            <Input id="email" name="email" type="email" defaultValue={s.values?.email ?? user.email} aria-invalid={!!s.errors?.email} />
          </Field>
          {/* A disabled select sends nothing, so the current role goes along hidden. */}
          {isMe && <input type="hidden" name="role" value={user.role} />}
          <RoleField value={s.values?.role ?? user.role} error={s.errors?.role} disabled={isMe} />
          <div>
            <SubmitButton size="sm" pendingText="Saving…">
              Save details
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function SetPasswordForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-3">
      {(s) => (
        <>
          <Field label="New password" htmlFor="new-password" error={s.errors?.password} hint={PASSWORD_HINT}>
            <Input id="new-password" name="password" type="text" autoComplete="new-password" spellCheck={false} aria-invalid={!!s.errors?.password} />
          </Field>
          <div>
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
              Set the new password
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
